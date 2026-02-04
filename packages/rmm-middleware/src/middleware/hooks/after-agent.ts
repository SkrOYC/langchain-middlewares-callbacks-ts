import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import { addMemory, mergeMemory } from "@/algorithms/memory-actions";
import { extractMemories } from "@/algorithms/memory-extraction";
import {
  decideUpdateAction,
  type UpdateAction,
} from "@/algorithms/memory-update";
import { findSimilarMemories } from "@/algorithms/similarity-search";

// ============================================================================
// Constants
// ============================================================================

/**
 * Default number of similar memories to retrieve for merge decisions
 */
const DEFAULT_TOP_K = 5;

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Interface for the afterAgent runtime context
 */
interface AfterAgentRuntimeContext {
  summarizationModel: BaseChatModel;
  embeddings: Embeddings;
}

/**
 * Interface for the afterAgent dependencies (injected for testing)
 */
interface AfterAgentDependencies {
  vectorStore: VectorStoreInterface;
  extractSpeaker1: (dialogueSession: string) => string;
  updateMemory?: (historySummaries: string[], newSummary: string) => string;
}

/**
 * State interface for the afterAgent hook
 */
interface AfterAgentState {
  messages: BaseMessage[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validates that required dependencies are present
 */
function validateDependencies(deps: AfterAgentDependencies | undefined): {
  vectorStore: VectorStoreInterface;
  extractSpeaker1: (dialogueSession: string) => string;
} | null {
  const vectorStore = deps?.vectorStore;
  const extractSpeaker1 = deps?.extractSpeaker1;

  if (!(vectorStore && extractSpeaker1)) {
    console.warn(
      "[after-agent] Missing required dependencies, skipping memory extraction"
    );
    return null;
  }

  return { vectorStore, extractSpeaker1 };
}

/**
 * Processes a single memory: finds similar memories and decides actions
 */
async function processMemory(
  memory: ExtractedMemory,
  vectorStore: VectorStoreInterface,
  summarizationModel: BaseChatModel,
  updateMemoryPrompt: AfterAgentDependencies["updateMemory"]
): Promise<UpdateAction[]> {
  const similarMemories = await findSimilarMemories(
    memory,
    vectorStore,
    DEFAULT_TOP_K
  );

  if (similarMemories.length === 0) {
    return [{ action: "Add" }];
  }

  if (updateMemoryPrompt) {
    return decideUpdateAction(
      memory,
      similarMemories,
      summarizationModel,
      updateMemoryPrompt
    );
  }

  try {
    const prompts = await import("../../middleware/prompts/update-memory");
    return decideUpdateAction(
      memory,
      similarMemories,
      summarizationModel,
      prompts.updateMemory
    );
  } catch (importError) {
    console.warn(
      "[after-agent] Failed to load update-memory prompt, defaulting to Add:",
      importError instanceof Error ? importError.message : String(importError)
    );
    return [{ action: "Add" }];
  }
}

/**
 * Executes a single update action
 */
async function executeAction(
  action: UpdateAction,
  memory: ExtractedMemory,
  similarMemories: RetrievedMemory[],
  vectorStore: VectorStoreInterface
): Promise<void> {
  if (action.action === "Add") {
    await addMemory(memory, vectorStore);
    return;
  }

  if (action.action !== "Merge") {
    return;
  }

  if (action.index === undefined || action.merged_summary === undefined) {
    console.warn(
      "[after-agent] Merge action missing index or merged_summary, skipping"
    );
    return;
  }

  const existingMemory = similarMemories[action.index];
  if (!existingMemory) {
    console.warn(
      `[after-agent] Merge action has invalid index ${action.index}, skipping`
    );
    return;
  }

  await mergeMemory(existingMemory, action.merged_summary, vectorStore);
}

/**
 * Type for extracted memory from memory-extraction
 */
type ExtractedMemory = NonNullable<
  Awaited<ReturnType<typeof extractMemories>>
>[number];

/**
 * Prospective Reflection: afterAgent hook implementation.
 *
 * This hook orchestrates the full Prospective Reflection pipeline:
 * 1. Extract memories from the session using LLM summarization
 * 2. Find similar existing memories for each extracted memory
 * 3. Decide whether to Add or Merge each new memory
 * 4. Execute the appropriate action
 *
 * @param state - The current agent state containing messages
 * @param runtime - The runtime context with model and embeddings
 * @param deps - Optional dependencies for testing (vectorStore, prompts)
 * @returns Empty object (no state changes from Prospective Reflection)
 *
 * @example
 * ```typescript
 * const result = await afterAgent(state, runtime, {
 *   vectorStore,
 *   extractSpeaker1
 * });
 * ```
 */
export async function afterAgent(
  state: AfterAgentState,
  runtime: { context: AfterAgentRuntimeContext },
  deps?: AfterAgentDependencies
): Promise<Record<string, unknown>> {
  try {
    const depsResult = validateDependencies(deps);
    if (!depsResult) {
      return {};
    }

    const { vectorStore, extractSpeaker1 } = depsResult;

    if (!state.messages || state.messages.length === 0) {
      return {};
    }

    const memories = await extractMemories(
      state.messages,
      runtime.context.summarizationModel,
      runtime.context.embeddings,
      extractSpeaker1
    );

    if (!memories || memories.length === 0) {
      return {};
    }

    for (const memory of memories) {
      const actions = await processMemory(
        memory,
        vectorStore,
        runtime.context.summarizationModel,
        deps?.updateMemory
      );

      const similarMemories = await findSimilarMemories(
        memory,
        vectorStore,
        DEFAULT_TOP_K
      );

      for (const action of actions) {
        await executeAction(action, memory, similarMemories, vectorStore);
      }
    }

    return {};
  } catch (error) {
    console.warn(
      "[after-agent] Error during Prospective Reflection, continuing:",
      error instanceof Error ? error.message : String(error)
    );
    return {};
  }
}
