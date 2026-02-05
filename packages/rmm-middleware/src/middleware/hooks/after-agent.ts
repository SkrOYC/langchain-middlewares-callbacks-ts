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
import type { RetrievedMemory } from "@/schemas";
import {
  createEmptyMessageBuffer,
  DEFAULT_REFLECTION_CONFIG,
  type MessageBuffer,
  type ReflectionConfig,
} from "@/schemas";
import { createMessageBufferStorage } from "@/storage/message-buffer-storage";
import { countHumanMessages } from "@/utils/message-helpers";

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
  userId?: string;
  store?: {
    get: (
      namespace: string[],
      key: string
    ) => Promise<{ value: unknown } | null>;
    put: (namespace: string[], key: string, value: unknown) => Promise<void>;
  };
  reflectionConfig?: ReflectionConfig;
}

/**
 * State interface for the afterAgent hook
 */
interface AfterAgentState {
  messages: BaseMessage[];
}

// ============================================================================
// Trigger Logic
// ============================================================================

/**
 * Checks if reflection should be triggered based on configured min/max thresholds.
 *
 * Max thresholds act as "force" triggers - reflection happens regardless of mode.
 * Min thresholds follow the configured mode:
 * - "strict": BOTH minTurns AND minInactivityMs must be met
 * - "relaxed": EITHER minTurns OR minInactivityMs must be met
 *
 * @param humanMessageCount - Count of human messages in buffer
 * @param previousLastMessageTimestamp - Timestamp of the message BEFORE current turn
 * @param config - Reflection configuration
 * @param now - Current timestamp
 * @returns true if reflection should be triggered
 */
function shouldTriggerReflection(
  humanMessageCount: number,
  previousLastMessageTimestamp: number,
  config: ReflectionConfig,
  now: number
): boolean {
  const timeSinceLastMessage = now - previousLastMessageTimestamp;

  // Max thresholds: force reflection regardless of mode
  if (humanMessageCount >= config.maxTurns) {
    return true;
  }

  if (timeSinceLastMessage >= config.maxInactivityMs) {
    return true;
  }

  // Min thresholds: follow mode logic
  const minTurnsMet = humanMessageCount >= config.minTurns;
  const minInactivityMet = timeSinceLastMessage >= config.minInactivityMs;

  if (config.mode === "strict") {
    return minTurnsMet && minInactivityMet;
  }

  return minTurnsMet || minInactivityMet;
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
  userId?: string;
  store?: AfterAgentDependencies["store"];
} | null {
  const vectorStore = deps?.vectorStore;
  const extractSpeaker1 = deps?.extractSpeaker1;

  if (!(vectorStore && extractSpeaker1)) {
    console.warn(
      "[after-agent] Missing required dependencies, skipping memory extraction"
    );
    return null;
  }

  // Both userId and store must be provided together for persistence
  const hasUserId = deps?.userId !== undefined;
  const hasStore = deps?.store !== undefined;

  if (hasUserId !== hasStore) {
    console.warn(
      "[after-agent] Both userId and store must be provided together for message buffer persistence"
    );
    return null;
  }

  return {
    vectorStore,
    extractSpeaker1,
    userId: deps?.userId,
    store: deps?.store,
  };
}

/**
 * Result of processing a memory: actions and similar memories found
 */
interface ProcessMemoryResult {
  actions: UpdateAction[];
  similarMemories: RetrievedMemory[];
}

/**
 * Processes a single memory: finds similar memories and decides actions
 */
async function processMemory(
  memory: ExtractedMemory,
  vectorStore: VectorStoreInterface,
  summarizationModel: BaseChatModel,
  updateMemoryPrompt: AfterAgentDependencies["updateMemory"]
): Promise<ProcessMemoryResult> {
  const similarMemories = await findSimilarMemories(
    memory,
    vectorStore,
    DEFAULT_TOP_K
  );

  if (similarMemories.length === 0) {
    return { actions: [{ action: "Add" }], similarMemories };
  }

  if (updateMemoryPrompt) {
    const actions = await decideUpdateAction(
      memory,
      similarMemories,
      summarizationModel,
      updateMemoryPrompt
    );
    return { actions, similarMemories };
  }

  try {
    const prompts = await import("../../middleware/prompts/update-memory");
    const actions = await decideUpdateAction(
      memory,
      similarMemories,
      summarizationModel,
      prompts.updateMemory
    );
    return { actions, similarMemories };
  } catch (importError) {
    console.warn(
      "[after-agent] Failed to load update-memory prompt, defaulting to Add:",
      importError instanceof Error ? importError.message : String(importError)
    );
    return { actions: [{ action: "Add" }], similarMemories };
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
 * Appends current session messages to the buffer.
 * Returns updated buffer with new messages and counts.
 */
function appendMessagesToBuffer(
  buffer: MessageBuffer,
  messages: BaseMessage[],
  now: number
): MessageBuffer {
  const newMessages = [...buffer.messages, ...messages];
  const newHumanCount = countHumanMessages(newMessages);

  return {
    messages: newMessages,
    humanMessageCount: newHumanCount,
    lastMessageTimestamp: now,
    createdAt: buffer.createdAt,
  };
}

/**
 * Loads message buffer from storage or creates empty buffer.
 */
async function loadMessageBuffer(
  userId: string | undefined,
  store: AfterAgentDependencies["store"],
  now: number
): Promise<MessageBuffer> {
  if (userId && store) {
    const bufferStorage = createMessageBufferStorage(
      store as Parameters<typeof createMessageBufferStorage>[0]
    );
    return await bufferStorage.loadBuffer(userId);
  }

  return {
    messages: [],
    humanMessageCount: 0,
    lastMessageTimestamp: now,
    createdAt: now,
  };
}

/**
 * Enforces max buffer size by trimming oldest messages.
 */
function enforceBufferSize(
  buffer: MessageBuffer,
  maxBufferSize: number
): MessageBuffer {
  if (buffer.messages.length <= maxBufferSize) {
    return buffer;
  }

  const excess = buffer.messages.length - maxBufferSize;
  const trimmedMessages = buffer.messages.slice(excess);

  return {
    messages: trimmedMessages,
    humanMessageCount: countHumanMessages(trimmedMessages),
    lastMessageTimestamp: buffer.lastMessageTimestamp,
    createdAt: buffer.createdAt,
  };
}

/**
 * Processes reflection: extracts memories and updates memory bank.
 */
async function processReflection(
  buffer: MessageBuffer,
  vectorStore: VectorStoreInterface,
  summarizationModel: BaseChatModel,
  embeddings: Embeddings,
  extractSpeaker1: (dialogue: string) => string,
  updateMemory: AfterAgentDependencies["updateMemory"]
): Promise<void> {
  const memories = await extractMemories(
    buffer.messages,
    summarizationModel,
    embeddings,
    extractSpeaker1
  );

  if (!memories || memories.length === 0) {
    return;
  }

  for (const memory of memories) {
    const { actions, similarMemories } = await processMemory(
      memory,
      vectorStore,
      summarizationModel,
      updateMemory
    );

    for (const action of actions) {
      await executeAction(action, memory, similarMemories, vectorStore);
    }
  }
}

/**
 * Persists message buffer to storage.
 */
async function persistMessageBuffer(
  buffer: MessageBuffer,
  userId: string | undefined,
  store: AfterAgentDependencies["store"]
): Promise<void> {
  if (!(userId && store)) {
    return;
  }

  const bufferStorage = createMessageBufferStorage(
    store as Parameters<typeof createMessageBufferStorage>[0]
  );
  const saved = await bufferStorage.saveBuffer(userId, buffer);

  if (!saved) {
    console.warn(
      "[after-agent] Failed to persist message buffer - messages will be retained in memory only"
    );
  }
}

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Prospective Reflection: afterAgent hook implementation.
 *
 * This hook implements batched memory extraction with configurable triggers:
 * 1. Load persisted message buffer from BaseStore (user-scoped)
 * 2. Append current session messages to buffer
 * 3. Check reflection triggers (turn count + inactivity thresholds)
 * 4. If triggered: extract memories, update memory bank, clear buffer
 * 5. Save updated buffer to BaseStore
 *
 * Trigger modes:
 * - "relaxed": Trigger when EITHER threshold is met
 * - "strict": Trigger only when BOTH thresholds are met
 *
 * @param state - The current agent state containing messages
 * @param runtime - The runtime context with model and embeddings
 * @param deps - Optional dependencies for testing (vectorStore, prompts, config)
 * @returns Empty object (no state changes from Prospective Reflection)
 *
 * @example
 * ```typescript
 * const result = await afterAgent(state, runtime, {
 *   vectorStore,
 *   extractSpeaker1,
 *   userId: "user-123",
 *   store: baseStore,
 *   reflectionConfig: {
 *     minTurns: 2,
 *     maxTurns: 50,
 *     minInactivityMs: 600000,
 *     maxInactivityMs: 1800000,
 *     mode: "strict"
 *   }
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

    const { vectorStore, extractSpeaker1, userId, store } = depsResult;

    if (!state.messages || state.messages.length === 0) {
      return {};
    }

    const config = deps?.reflectionConfig ?? DEFAULT_REFLECTION_CONFIG;
    const now = Date.now();

    // Load buffer and append messages
    let buffer = await loadMessageBuffer(userId, store, now);
    const previousLastMessageTimestamp = buffer.lastMessageTimestamp;
    buffer = appendMessagesToBuffer(buffer, state.messages, now);
    buffer = enforceBufferSize(buffer, config.maxBufferSize);

    // Check trigger and process reflection if needed
    const shouldReflect = shouldTriggerReflection(
      buffer.humanMessageCount,
      previousLastMessageTimestamp,
      config,
      now
    );

    if (shouldReflect) {
      await processReflection(
        buffer,
        vectorStore,
        runtime.context.summarizationModel,
        runtime.context.embeddings,
        extractSpeaker1,
        deps?.updateMemory
      );

      // Clear persisted buffer after reflection using dedicated method
      if (userId && store) {
        const bufferStorage = createMessageBufferStorage(
          store as Parameters<typeof createMessageBufferStorage>[0]
        );
        await bufferStorage.clearBuffer(userId);
      }
      buffer = createEmptyMessageBuffer();
    }

    // Persist buffer
    await persistMessageBuffer(buffer, userId, store);

    return {};
  } catch (error) {
    console.warn(
      "[after-agent] Error during Prospective Reflection, continuing:",
      error instanceof Error ? error.message : String(error)
    );
    return {};
  }
}
