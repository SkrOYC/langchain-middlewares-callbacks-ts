/**
 * beforeAgent hook for Retrospective Reflection
 *
 * Initializes the reranker state at the start of each agent invocation:
 * 1. Loads learned reranker weights from BaseStore (or initializes new ones)
 * 2. Resets transient state fields for the new invocation
 *
 * Per paper: Weights are initialized with W_q[i][j] ~ N(0, 0.01)
 */

import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { BaseMessage, RerankerState } from "@/schemas";
import { createWeightStorage } from "@/storage/weight-storage";
import { initializeMatrix } from "@/utils/matrix";

// ============================================================================
// Configuration
// ============================================================================

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
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  topK: 20,
  topM: 5,
  temperature: 0.5,
  learningRate: 0.001,
  baseline: 0.5,
} as const;

// ============================================================================
// Hook Factory
// ============================================================================

/**
 * Creates a beforeAgent hook for Retrospective Reflection
 *
 * This hook is responsible for:
 * 1. Loading reranker weights from BaseStore (per-user isolation)
 * 2. Initializing new weights with Gaussian distribution if none exist
 * 3. Resetting transient state fields for the new invocation
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
interface BeforeAgentStateUpdate {
  /**
   * Learned reranker weights (W_q, W_m matrices)
   */
  _rerankerWeights: RerankerState;

  /**
   * Retrieved memories from current query (populated by beforeModel)
   */
  _retrievedMemories: unknown[];

  /**
   * Citation records from current response (populated by wrapModelCall)
   */
  _citations: unknown[];

  /**
   * Number of turns processed in current session
   */
  _turnCountInSession: number;
}
