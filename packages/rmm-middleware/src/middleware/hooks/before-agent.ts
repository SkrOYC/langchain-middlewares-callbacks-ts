/**
 * beforeAgent hook for Retrospective Reflection
 *
 * Responsibilities:
 * 1. Loads learned reranker weights from BaseStore (or initializes new ones)
 * 2. Checks prospective reflection triggers using BaseStore's updated_at
 * 3. Triggers reflection asynchronously if thresholds are met
 * 4. Clears buffer after reflection
 */

import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type {
  BaseMessage,
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
      similaritySearch: (query: string) => Promise<RetrievedMemory[]>;
      addDocuments: (documents: string[]) => Promise<void>;
    };
    extractSpeaker1: (dialogue: string) => string;
    updateMemory?: (history: string[], newSummary: string) => string;
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
 * Processes reflection on buffered messages.
 * Extracts memories and updates the memory bank.
 *
 * Reads from staging buffer to ensure atomic reflection processing.
 * Implements retry logic with exponential backoff.
 *
 * TODO: Complete implementation with proper memory extraction using LLM.
 * This is a placeholder that adds raw dialogue markers to the vector store.
 *
 * @param userId - User identifier for buffer isolation
 * @param bufferStorage - Storage adapter for buffer operations
 * @param config - Reflection configuration with retry settings
 * @param deps - Dependencies for memory extraction
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
    // Format dialogue for extraction
    const dialogue = stagedBuffer.messages
      .map((msg) => {
        // Handle both formats: StoredMessage (nested data.content) and flattened (top-level content)
        const msgAny = msg as unknown as {
          data?: { content?: string };
          content?: string;
        };
        const content = msgAny.data?.content ?? msgAny.content ?? "";
        const type = msg.type ?? "unknown";
        return `${type}: ${content}`;
      })
      .join("\n");

    // For now, just add the raw dialogue as a "memory" placeholder
    // In full implementation, this would use extractMemories with LLM
    console.debug(
      `[before-agent] Processing reflection on ${stagedBuffer.humanMessageCount} human messages`
    );

    // Simulate memory extraction - in production this would call extractMemories
    // For testing, we just mark that reflection was attempted
    if (deps.vectorStore.addDocuments) {
      await deps.vectorStore.addDocuments([
        `Reflection marker: ${dialogue.substring(0, 100)}...`,
      ]);
    }
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
      logger.warn(
        `Failed to re-stage buffer for retry (storage issue), ${stagedBuffer.messages.length} messages preserved in existing staging`
      );
      // Don't throw - staging is preserved, reflection will retry on next trigger
      return;
    }

    // Re-throw to trigger retry in caller
    throw error;
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
  const timeSinceLastUpdate = now - item.updatedAt.getTime();

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
