/**
 * beforeAgent hook for Retrospective Reflection
 *
 * Responsibilities:
 * 1. Loads learned reranker weights from BaseStore (or initializes new ones)
 * 2. Checks prospective reflection triggers using BaseStore's updated_at
 * 3. Triggers reflection asynchronously if thresholds are met
 * 4. Clears buffer after reflection
 */

import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  type BaseMessage,
  mapStoredMessagesToChatMessages,
} from "@langchain/core/messages";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { extractMemories } from "@/algorithms/memory-extraction";
import type {
  CitationRecord,
  MessageBuffer,
  ReflectionConfig,
  RerankerState,
  RetrievedMemory,
} from "@/schemas";
import { DEFAULT_REFLECTION_CONFIG } from "@/schemas";
import {
  createMessageBufferStorage,
  type MessageBufferStorage,
} from "@/storage/message-buffer-storage";
import { createWeightStorage } from "@/storage/weight-storage";
import { getLogger } from "@/utils/logger";
import { initializeMatrix } from "@/utils/matrix";

const logger = getLogger("before-agent");

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  topK: 20,
  topM: 5,
  temperature: 0.5,
  learningRate: 0.001,
  baseline: 0.5,
} as const;

/**
 * Configuration options for the beforeAgent hook
 */
export interface BeforeAgentOptions {
  /**
   * BaseStore instance for persisting reranker weights
   */
  store: BaseStore;

  /**
   * Function to extract userId from runtime context
   * Used for multi-user isolation of reranker weights
   */
  userIdExtractor: (runtime: BeforeAgentRuntime) => string;

  /**
   * Optional reflection configuration
   * If not provided, uses DEFAULT_REFLECTION_CONFIG
   */
  reflectionConfig?: ReflectionConfig;

  /**
   * Optional dependencies for reflection processing
   * If not provided, reflection is skipped
   */
  reflectionDeps?: {
    vectorStore: {
      similaritySearch: (query: string) => Promise<
        Array<{
          pageContent: string;
          metadata: Record<string, unknown>;
        }>
      >;
      addDocuments: (
        documents: Array<{
          pageContent: string;
          metadata?: Record<string, unknown>;
        }>
      ) => Promise<void>;
    };
    extractSpeaker1: (dialogue: string) => string;
    updateMemory?: (history: string[], newSummary: string) => string;
    /**
     * LLM for memory extraction (Prospective Reflection)
     * Required for LLM-based memory extraction via extractMemories
     */
    llm: BaseChatModel;
    /**
     * Embeddings for encoding extracted memories
     * Required for generating memory vectors in VectorStore
     */
    embeddings: Embeddings;
  };

  /**
   * Optional custom namespace for buffer/staging isolation.
   * Controls how message buffers are partitioned for concurrent access.
   *
   * The namespace is used as: [namespace..., "buffer"] for main buffer
   * and [namespace..., "buffer", "staging"] for staging buffer.
   *
   * Default (3 elements): ["rmm", userId, "buffer"]
   * With thread isolation (4 elements): ["rmm", userId, threadId, "buffer"]
   * With agent isolation (4 elements): ["rmm", userId, agentId, "buffer"]
   * With full isolation (5 elements): ["rmm", userId, threadId, agentId, "buffer"]
   *
   * For single-threaded deployments, the default user isolation is sufficient.
   * For multi-threaded/multi-agent deployments, include threadId and/or agentId
   * in the namespace to prevent race conditions between concurrent sessions.
   */
  namespace?: string[];
}

/**
 * Runtime interface for beforeAgent hook
 * Documents expected context properties from LangChain runtime
 */
interface BeforeAgentRuntime {
  context: {
    userId?: string;
    store?: BaseStore;
    sessionId?: string;
  };
}

/**
 * State interface for beforeAgent hook
 */
interface BeforeAgentState {
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
 * @param humanMessageCount - Number of human messages in the buffer
 * @param timeSinceLastUpdate - Milliseconds elapsed since buffer was last updated (using BaseStore's updatedAt)
 * @param config - Reflection configuration with min/max thresholds and mode
 * @returns true if reflection should be triggered, false otherwise
 */
export function checkReflectionTriggers(
  humanMessageCount: number,
  timeSinceLastUpdate: number,
  config: ReflectionConfig
): boolean {
  // Max thresholds: force reflection regardless of mode
  if (humanMessageCount >= config.maxTurns) {
    return true;
  }

  if (timeSinceLastUpdate >= config.maxInactivityMs) {
    return true;
  }

  // Min thresholds: follow mode logic
  const minTurnsMet = humanMessageCount >= config.minTurns;
  const minInactivityMet = timeSinceLastUpdate >= config.minInactivityMs;

  if (config.mode === "strict") {
    return minTurnsMet && minInactivityMet;
  }

  return minTurnsMet || minInactivityMet;
}

/**
 * Processes reflection on buffered messages using LLM-based memory extraction.
 * Extracts memories and stores them in the memory bank with rich metadata.
 *
 * Reads from staging buffer to ensure atomic reflection processing.
 * Implements retry logic with exponential backoff.
 *
 * This function:
 * 1. Converts StoredMessage[] to BaseMessage[] using LangChain's mapStoredMessagesToChatMessages
 * 2. Calls extractMemories with LLM to extract topic-based memories
 * 3. Creates VectorStore documents with rich metadata (id, sessionId, timestamp, turnReferences, rawDialogue)
 * 4. Implements graceful degradation: clears staging on null/empty extraction
 * 5. Handles errors with retry logic and exponential backoff
 * 6. On storage failure during retry: manually increments retry count to prevent infinite loop
 *
 * @param userId - User identifier for buffer isolation
 * @param bufferStorage - Storage adapter for buffer operations
 * @param config - Reflection configuration with retry settings
 * @param deps - Dependencies for memory extraction (LLM, embeddings, vectorStore, prompt handlers)
 *
 * Note: When re-staging fails due to storage issues, the function manually increments the retry
 * count in the existing staging buffer to prevent an infinite loop. If max retries are exceeded,
 * the staging buffer is cleared to allow normal operation to continue.
 *
 * @see Issue #48 - [RMM-5] Prospective Reflection implementation (original incomplete work)
 */
async function processReflection(
  userId: string,
  bufferStorage: MessageBufferStorage,
  config: ReflectionConfig,
  deps: NonNullable<BeforeAgentOptions["reflectionDeps"]>
): Promise<void> {
  // Read from staging buffer (source of truth for reflection)
  const stagedBuffer = await bufferStorage.loadStagingBuffer(userId);

  if (!stagedBuffer || stagedBuffer.messages.length === 0) {
    console.debug("[before-agent] No staged buffer to reflect on");
    return;
  }

  const retryCount = stagedBuffer.retryCount ?? 0;

  // Check if we've exceeded max retries
  if (retryCount >= config.maxRetries) {
    logger.warn(
      `Reflection failed after ${retryCount} retries, giving up`,
      stagedBuffer.messages.length,
      "messages lost"
    );
    // Clear staging to prevent indefinite retention of failed buffer
    await bufferStorage.clearStaging(userId);
    return;
  }

  // Calculate exponential backoff delay
  const delayMs = config.retryDelayMs * 2 ** retryCount;
  console.debug(
    `[before-agent] Reflection attempt ${retryCount + 1}/${config.maxRetries + 1}, ` +
      `delay ${delayMs}ms`
  );

  // Wait before processing (if not first attempt)
  if (retryCount > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  try {
    // FORMAT: Convert StoredMessage[] to BaseMessage[] for extractMemories
    const sessionHistory: BaseMessage[] = mapStoredMessagesToChatMessages(
      stagedBuffer.messages
    );

    // EXTRACT: Use LLM to extract memories from dialogue
    const memories = await extractMemories(
      sessionHistory,
      deps.llm,
      deps.embeddings,
      deps.extractSpeaker1,
      userId
    );

    // HANDLE EMPTY OR FAILED EXTRACTION: Graceful degradation (Option A)
    if (!memories || memories.length === 0) {
      console.debug(
        `[before-agent] No memories extracted from ${stagedBuffer.humanMessageCount} human messages`
      );
      // Clear staging buffer even with empty extraction
      await bufferStorage.clearStaging(userId);
      return;
    }

    // STORE: Convert MemoryEntry[] to VectorStore documents with rich metadata
    const documents = memories.map((memory) => ({
      pageContent: memory.topicSummary,
      metadata: {
        id: memory.id,
        sessionId: memory.sessionId,
        timestamp: memory.timestamp,
        turnReferences: JSON.stringify(memory.turnReferences),
        rawDialogue: memory.rawDialogue,
      },
    }));

    await deps.vectorStore.addDocuments(documents);

    console.debug(
      `[before-agent] Extracted and stored ${memories.length} memories`
    );
  } catch (error) {
    logger.warn(
      `Reflection attempt ${retryCount + 1} failed:`,
      error instanceof Error ? error.message : String(error)
    );

    // Increment retry count and re-stage for next attempt
    const retryBuffer: typeof stagedBuffer = {
      ...stagedBuffer,
      retryCount: retryCount + 1,
    };

    const reStaged = await bufferStorage.stageBuffer(userId, retryBuffer);
    if (!reStaged) {
      await handleRetryStagingFailure(
        userId,
        bufferStorage,
        config,
        retryCount
      );
      return;
    }

    // Re-throw to trigger retry in caller
    throw error;
  }
}

/**
 * Handle storage failure when re-staging buffer for retry.
 * Attempts to increment retry count manually to prevent infinite loop.
 * Clears staging if max retries exceeded.
 *
 * @param userId - User identifier
 * @param bufferStorage - Storage adapter
 * @param config - Reflection configuration
 * @param retryCount - Current retry count
 * @param error - Original error that triggered retry
 */
async function handleRetryStagingFailure(
  userId: string,
  bufferStorage: MessageBufferStorage,
  config: ReflectionConfig,
  retryCount: number
): Promise<void> {
  // Attempt to increment retry count manually in existing staging buffer
  // This prevents infinite loop when storage issues persist
  try {
    // Use exposed interface values for consistency
    const stagingNamespace = bufferStorage.buildNamespace(userId, "staging");
    const NAMESPACE_KEY = bufferStorage.NAMESPACE_KEY;

    // Get current staging to preserve state
    const currentStaging = await bufferStorage.store.get(
      stagingNamespace,
      NAMESPACE_KEY
    );

    if (currentStaging) {
      // Increment retry count
      const updatedStaging = {
        ...currentStaging.value,
        retryCount: retryCount + 1,
      };
      await bufferStorage.store.put(
        stagingNamespace,
        NAMESPACE_KEY,
        updatedStaging
      );

      // Check if max retries exceeded
      if (retryCount + 1 >= config.maxRetries) {
        logger.warn(
          "Max retries exceeded, clearing staging to prevent infinite loop"
        );
        await bufferStorage.clearStaging(userId);
        return;
      }

      logger.warn(
        `Failed to re-stage buffer for retry (storage issue), manually incremented retry count to ${retryCount + 1}`
      );
    }
  } catch (updateError) {
    logger.warn(
      `Failed to update staging buffer retry count: ${updateError instanceof Error ? updateError.message : String(updateError)}`
    );
  }
}

// ============================================================================
// Default Configuration
// ============================================================================

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Loads reranker weights from storage or initializes new ones
 *
 * @param userId - User identifier for weight isolation (null for anonymous)
 * @param weightStorage - Storage adapter for weights
 * @returns Promise resolving to RerankerState
 */
async function loadOrInitializeWeights(
  userId: string | null | undefined,
  weightStorage: ReturnType<typeof createWeightStorage>
): Promise<RerankerState> {
  if (!userId) {
    return initializeRerankerState();
  }

  const existingWeights = await weightStorage.loadWeights(userId);

  if (existingWeights) {
    return existingWeights;
  }

  return initializeRerankerState();
}

/**
 * Checks reflection triggers and stages buffer if needed
 * Handles all nested conditions for reflection decision
 *
 * @param userId - User identifier for buffer isolation
 * @param runtime - Runtime context with store access
 * @param reflectionConfig - Configuration for reflection thresholds
 * @param options - Full hook options including dependencies
 * @param rerankerState - Current reranker state (for logging)
 */
async function checkAndStageReflection(
  userId: string | null | undefined,
  runtime: BeforeAgentRuntime,
  reflectionConfig: ReflectionConfig,
  options: BeforeAgentOptions,
  _rerankerState: RerankerState
): Promise<void> {
  // Skip if no userId, no deps, or no store available
  if (!(userId && options.reflectionDeps && runtime.context.store)) {
    return;
  }

  const bufferStorage = createMessageBufferStorage(
    runtime.context.store,
    options.namespace
  );

  const item = await bufferStorage.loadBufferItem(userId);

  // Check buffer exists and has messages
  if (!item || item.value.messages.length === 0) {
    return;
  }

  // Calculate time since last buffer update
  const now = Date.now();
  const timeSinceLastUpdate = item.updatedAt
    ? now - item.updatedAt.getTime()
    : Number.POSITIVE_INFINITY;

  // Check if reflection should trigger
  if (
    !checkReflectionTriggers(
      item.value.humanMessageCount,
      timeSinceLastUpdate,
      reflectionConfig
    )
  ) {
    return;
  }

  // Stage buffer for async reflection
  // Note: item.value is typed as Record<string, unknown> by loader, cast to MessageBuffer
  await stageBufferForReflection(
    userId,
    bufferStorage,
    item.value as unknown as MessageBuffer,
    reflectionConfig,
    options.reflectionDeps
  );
}

/**
 * Stages the buffer for asynchronous reflection processing
 * Handles staging, clearing, and triggering the async reflection
 */
async function stageBufferForReflection(
  userId: string,
  bufferStorage: MessageBufferStorage,
  buffer: MessageBuffer,
  reflectionConfig: ReflectionConfig,
  reflectionDeps: NonNullable<BeforeAgentOptions["reflectionDeps"]>
): Promise<void> {
  // Snapshot buffer for reflection
  const bufferToStage: MessageBuffer = {
    messages: buffer.messages,
    humanMessageCount: buffer.humanMessageCount,
    lastMessageTimestamp: buffer.lastMessageTimestamp,
    createdAt: buffer.createdAt,
  };

  // Stage the buffer
  const staged = await bufferStorage.stageBuffer(userId, bufferToStage);

  if (!staged) {
    logger.warn("Failed to stage buffer, skipping reflection");
    return;
  }

  // Clear main buffer to prevent duplicate processing
  await bufferStorage.clearBuffer(userId);

  // Process reflection asynchronously (non-blocking)
  processReflection(userId, bufferStorage, reflectionConfig, reflectionDeps)
    .then(async () => {
      await bufferStorage.clearStaging(userId);
      logger.debug("Reflection completed, staging cleared");
    })
    .catch((error) => {
      logger.warn(
        "Reflection failed, staging preserved for retry:",
        error instanceof Error ? error.message : String(error)
      );
    });
}

/**
 * Creates initial state update for the agent
 */
function createInitialStateUpdate(
  rerankerState: RerankerState
): BeforeAgentStateUpdate {
  return {
    _rerankerWeights: rerankerState,
    _retrievedMemories: [],
    _citations: [],
    _turnCountInSession: 0,
  };
}

/**
 * Creates error state update with initialized reranker
 */
function createErrorStateUpdate(error: unknown): BeforeAgentStateUpdate {
  logger.warn(
    "Error loading weights, using initialized state:",
    error instanceof Error ? error.message : String(error)
  );

  return {
    _rerankerWeights: initializeRerankerState(),
    _retrievedMemories: [],
    _citations: [],
    _turnCountInSession: 0,
  };
}

/**
 * Initializes a new reranker state with Gaussian-weighted matrices
 *
 * Per paper recommendation: W_q[i][j] ~ N(0, 0.01), W_m[i][j] ~ N(0, 0.01)
 * This initialization prevents gradient vanishing during early training.
 *
 * @returns New RerankerState with zero-config weights
 */
function initializeRerankerState(): RerankerState {
  const EMBEDDING_DIMENSION = 1536;

  return {
    weights: {
      queryTransform: initializeMatrix(
        EMBEDDING_DIMENSION,
        EMBEDDING_DIMENSION,
        0,
        0.01
      ),
      memoryTransform: initializeMatrix(
        EMBEDDING_DIMENSION,
        EMBEDDING_DIMENSION,
        0,
        0.01
      ),
    },
    config: {
      topK: DEFAULT_CONFIG.topK,
      topM: DEFAULT_CONFIG.topM,
      temperature: DEFAULT_CONFIG.temperature,
      learningRate: DEFAULT_CONFIG.learningRate,
      baseline: DEFAULT_CONFIG.baseline,
    },
  };
}

// ============================================================================
// Hook Factory
// ============================================================================

/**
 * Creates a beforeAgent hook for Retrospective Reflection
 *
 * This hook is responsible for:
 * 1. Loading reranker weights from BaseStore (per-user isolation)
 * 2. Checking prospective reflection triggers using BaseStore's updated_at
 * 3. Processing reflection asynchronously if thresholds are met
 * 4. Clearing buffer after reflection
 *
 * @param options - Configuration options
 * @returns Middleware with beforeAgent hook
 *
 * @example
 * ```typescript
 * const beforeAgent = createRetrospectiveBeforeAgent({
 *   store: baseStore,
 *   userIdExtractor: (runtime) => runtime.context.userId,
 * });
 *
 * const agent = createAgent({
 *   model,
 *   middleware: [beforeAgent],
 * });
 * ```
 */
export function createRetrospectiveBeforeAgent(options: BeforeAgentOptions) {
  // Create weight storage adapter
  const weightStorage = createWeightStorage(options.store);

  // Get reflection config or use default
  const reflectionConfig =
    options.reflectionConfig ?? DEFAULT_REFLECTION_CONFIG;

  return {
    name: "rmm-before-agent",

    beforeAgent: async (
      _state: BeforeAgentState,
      runtime: BeforeAgentRuntime
    ): Promise<BeforeAgentStateUpdate> => {
      try {
        const userId = options.userIdExtractor(runtime);

        if (!userId) {
          logger.warn("No userId provided, cannot load or save weights");
        }

        const rerankerState = await loadOrInitializeWeights(
          userId,
          weightStorage
        );

        await checkAndStageReflection(
          userId,
          runtime,
          reflectionConfig,
          options,
          rerankerState
        );

        return createInitialStateUpdate(rerankerState);
      } catch (error) {
        return createErrorStateUpdate(error);
      }
    },
  };
}

// ============================================================================
// Type Exports
// ============================================================================

/**
 * State update returned by the beforeAgent hook
 */
export interface BeforeAgentStateUpdate {
  /**
   * Learned reranker weights (W_q, W_m matrices)
   */
  _rerankerWeights: RerankerState;

  /**
   * Retrieved memories from current query (populated by beforeModel)
   */
  _retrievedMemories: RetrievedMemory[];

  /**
   * Citation records from current response (populated by wrapModelCall)
   */
  _citations: CitationRecord[];

  /**
   * Number of turns processed in current session
   */
  _turnCountInSession: number;
}
