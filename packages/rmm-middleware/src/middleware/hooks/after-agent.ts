import type { BaseMessage } from "@langchain/core/messages";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { extractMemories } from "../../algorithms/memory-extraction";
import { findSimilarMemories } from "../../algorithms/similarity-search";
import { decideUpdateAction, type UpdateAction } from "../../algorithms/memory-update";
import { addMemory, mergeMemory } from "../../algorithms/memory-actions";

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
    // Extract dependencies with defaults
    const vectorStore = deps?.vectorStore;
    const extractSpeaker1 = deps?.extractSpeaker1;
    const updateMemoryPrompt = deps?.updateMemory;

    // Validate required dependencies
    if (!vectorStore || !extractSpeaker1) {
      console.warn(
        "[after-agent] Missing required dependencies, skipping memory extraction"
      );
      return {};
    }

    // Handle empty messages - nothing to extract
    if (!state.messages || state.messages.length === 0) {
      return {};
    }

    // Step 1: Extract memories from the session
    const memories = await extractMemories(
      state.messages,
      runtime.context.summarizationModel,
      runtime.context.embeddings,
      extractSpeaker1
    );

    // If no memories extracted, nothing to update
    if (!memories || memories.length === 0) {
      return {};
    }

    // Step 2-4: Process each memory
    for (const memory of memories) {
      // Step 2: Find similar existing memories
      const similarMemories = await findSimilarMemories(
        memory,
        vectorStore,
        5 // topK
      );

      // Step 3: Decide Add vs Merge
      let actions: UpdateAction[];

      if (similarMemories.length > 0 && updateMemoryPrompt) {
        // Use custom updateMemory prompt if provided
        actions = await decideUpdateAction(
          memory,
          similarMemories,
          runtime.context.summarizationModel,
          updateMemoryPrompt
        );
      } else if (similarMemories.length > 0) {
        // Use default updateMemory prompt from update-memory.ts
        try {
          const prompts = await import("../../middleware/prompts/update-memory");
          const updateMemory = prompts.updateMemory;

          actions = await decideUpdateAction(
            memory,
            similarMemories,
            runtime.context.summarizationModel,
            updateMemory
          );
        } catch (importError) {
          // If import fails, default to Add action
          console.warn(
            "[after-agent] Failed to load update-memory prompt, defaulting to Add:",
            importError instanceof Error ? importError.message : String(importError)
          );
          actions = [{ action: "Add" }];
        }
      } else {
        // No similar memories, always Add
        actions = [{ action: "Add" }];
      }

      // Step 4: Execute actions
      for (const action of actions) {
        if (action.action === "Add") {
          await addMemory(memory, vectorStore);
        } else if (
          action.action === "Merge" &&
          action.index !== undefined &&
          action.merged_summary !== undefined
        ) {
          // Merge with the memory at the specified index
          const existingMemory = similarMemories[action.index];
          if (existingMemory) {
            await mergeMemory(
              existingMemory.id,
              action.merged_summary,
              vectorStore
            );
          } else {
            console.warn(
              `[after-agent] Merge action has invalid index ${action.index}, skipping`
            );
          }
        }
      }
    }

    // Return empty object - Prospective Reflection doesn't modify agent state
    return {};
  } catch (error) {
    // Graceful degradation - don't let memory extraction crash the agent
    console.warn(
      "[after-agent] Error during Prospective Reflection, continuing:",
      error instanceof Error ? error.message : String(error)
    );
    return {};
  }
}
