/**
 * beforeAgent hook for Retrospective Reflection
 *
 * Responsibilities:
 * 1. Loads learned reranker weights from BaseStore (or initializes new ones)
 * 2. Checks prospective reflection triggers using BaseStore's updated_at
 * 3. Triggers reflection asynchronously if thresholds are met
 * 4. Clears buffer after reflection
 */

import type { BaseStore, Item } from "@langchain/langgraph-checkpoint";
import type {
  BaseMessage,
  CitationRecord,
  ReflectionConfig,
  RetrievedMemory,
  RerankerState,
} from "@/schemas";
import {
  createEmptyMessageBuffer,
  DEFAULT_REFLECTION_CONFIG,
} from "@/schemas";
import { createMessageBufferStorage } from "@/storage/message-buffer-storage";
import { createWeightStorage } from "@/storage/weight-storage";
import { initializeMatrix } from "@/utils/matrix";
import { countHumanMessages } from "@/utils/message-helpers";

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
}

/**
 * Runtime interface for beforeAgent hook
 */
interface BeforeAgentRuntime {
  context: {
    userId?: string;
    store?: BaseStore;
  };
  [key: string]: unknown;
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
 * @param humanMessageCount - Count of human messages in buffer
 * @param timeSinceLastUpdate - Time in ms since BaseStore's updated_at
 * @param config - Reflection configuration
 * @returns true if reflection should be triggered
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
 * Note: This is a simplified implementation for testing.
 * Full implementation requires summarizationModel and embeddings.
 */
async function processReflection(
  buffer: { messages: unknown[]; humanMessageCount: number },
  deps: NonNullable<BeforeAgentOptions["reflectionDeps"]>
): Promise<void> {
  if (buffer.messages.length === 0) {
    return;
  }

  try {
    // Format dialogue for extraction
    const dialogue = (buffer.messages as Record<string, unknown>[])
      .map((msg) => {
        const content = msg.content ?? "";
        const type = msg.lc_serialized
          ? (msg.lc_serialized as Record<string, unknown>).type
          : "unknown";
        return `${type}: ${content}`;
      })
      .join("\n");

    // For now, just add the raw dialogue as a "memory" placeholder
    // In full implementation, this would use extractMemories with LLM
    console.debug(
      `[before-agent] Processing reflection on ${buffer.humanMessageCount} human messages`
    );

    // Simulate memory extraction - in production this would call extractMemories
    // For testing, we just mark that reflection was attempted
    if (deps.vectorStore.addDocuments) {
      await deps.vectorStore.addDocuments([`Reflection marker: ${dialogue.substring(0, 100)}...`]);
    }
  } catch (error) {
    console.warn(
      "[before-agent] Error during reflection processing:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

// ============================================================================
// Default Configuration
// ============================================================================

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
  const reflectionConfig = options.reflectionConfig ?? DEFAULT_REFLECTION_CONFIG;

  return {
    name: "rmm-before-agent",

    beforeAgent: async (
      _state: BeforeAgentState,
      runtime: BeforeAgentRuntime
    ): Promise<BeforeAgentStateUpdate> => {
      try {
        // Extract userId for multi-user isolation
        const userId = options.userIdExtractor(runtime);

        if (!userId) {
          console.warn(
            "[before-agent] No userId provided, cannot load or save weights"
          );
        }

        // Load existing weights or initialize new ones
        let rerankerState: RerankerState;

        if (userId) {
          const existingWeights = await weightStorage.loadWeights(userId);

          if (existingWeights) {
            // Use loaded weights
            rerankerState = existingWeights;
          } else {
            // Initialize new weights with Gaussian distribution
            rerankerState = initializeRerankerState();
          }
        } else {
          // No userId, use in-memory initialization
          rerankerState = initializeRerankerState();
        }

        // =========================================================================
        // Prospective Reflection: Check triggers using BaseStore's updated_at
        // =========================================================================

        if (userId && options.reflectionDeps && runtime.context.store) {
          const bufferStorage = createMessageBufferStorage(runtime.context.store);
          const item = await bufferStorage.loadBufferItem(userId);

          if (item && item.value.messages.length > 0) {
            // Calculate time since last buffer update using BaseStore's updatedAt
            const now = Date.now();
            const timeSinceLastUpdate = now - item.updatedAt.getTime();

            // Check if reflection should trigger
            const shouldTrigger = checkReflectionTriggers(
              item.value.humanMessageCount,
              timeSinceLastUpdate,
              reflectionConfig
            );

            if (shouldTrigger) {
              // Snapshot the buffer for async reflection (staging pattern)
              // This prevents message loss if new messages arrive during reflection
              const bufferToStage: typeof item.value = {
                messages: item.value.messages,
                humanMessageCount: item.value.humanMessageCount,
                lastMessageTimestamp: item.value.lastMessageTimestamp,
                createdAt: item.value.createdAt,
              };

              // Stage the buffer for reflection
              const staged = await bufferStorage.stageBuffer(userId, bufferToStage);

              if (!staged) {
                console.warn(
                  "[before-agent] Failed to stage buffer, skipping reflection"
                );
                return;
              }

              // Process reflection asynchronously on staged content (non-blocking)
              // We don't await this to not delay the agent
              processReflection(
                { messages: bufferToStage.messages, humanMessageCount: bufferToStage.humanMessageCount },
                options.reflectionDeps
              )
                .then(async () => {
                  // Clear staging buffer after reflection completes
                  await bufferStorage.clearStaging(userId);
                  console.debug(
                    "[before-agent] Reflection completed, staging cleared"
                  );
                })
                .catch((error) => {
                  console.warn(
                    "[before-agent] Reflection failed:",
                    error instanceof Error ? error.message : String(error)
                  );
                  // Staging is preserved for retry on next trigger
                });
            }
          }
        }

        // Reset transient state fields for new invocation
        return {
          _rerankerWeights: rerankerState,
          _retrievedMemories: [],
          _citations: [],
          _turnCountInSession: 0,
        };
      } catch (error) {
        // Graceful degradation: initialize in-memory state on error
        console.warn(
          "[before-agent] Error loading weights, using initialized state:",
          error instanceof Error ? error.message : String(error)
        );

        return {
          _rerankerWeights: initializeRerankerState(),
          _retrievedMemories: [],
          _citations: [],
          _turnCountInSession: 0,
        };
      }
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

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
