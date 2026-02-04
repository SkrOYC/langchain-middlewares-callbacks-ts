/**
 * afterModel hook for Retrospective Reflection
 *
 * Implements Step 4 of Algorithm 1: REINFORCE weight update
 *
 * This hook performs:
 * 1. Checks for citations in runtime.context._citations
 * 2. Builds GradientSample from embeddings, probabilities, and citations
 * 3. Loads gradient accumulator from BaseStore
 * 4. Computes exact REINFORCE gradients
 * 5. Accumulates gradients (batch size = 4)
 * 6. Applies update when batch is full
 * 7. Persists weights to BaseStore
 * 8. Clears runtime context for next turn
 *
 * Per Algorithm 1 and Equation 3 from the paper:
 * Δφ = η·(R-b)·∇_φ log P(M_M|q, M_K; φ)
 */

import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type {
  BaseMessage,
  CitationRecord,
  GradientSample,
  RerankerState,
  RetrievedMemory,
} from "@/schemas";
import { EMBEDDING_DIMENSION } from "@/schemas";
import { createGradientStorage } from "@/storage/gradient-storage";
import { createWeightStorage } from "@/storage/weight-storage";
import { addMatrix, clipMatrix, createZeroMatrix } from "@/utils/matrix";

// ============================================================================
// Constants
// ============================================================================

/**
 * Floating point comparison threshold for gradient computation
 */
const EPSILON = 1e-9;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration options for the afterModel hook
 */
export interface AfterModelOptions {
  /**
   * Batch size for gradient accumulation
   * Per paper Appendix A.1: 4
   */
  batchSize?: number;

  /**
   * Weight clipping threshold to prevent gradient explosion
   * Default: 100
   */
  clipThreshold?: number;
}

/**
 * Runtime interface for afterModel hook
 */
interface AfterModelRuntime {
  context: {
    _citations?: CitationRecord[];
    _originalQuery?: number[];
    _adaptedQuery?: number[];
    _originalMemoryEmbeddings?: number[][];
    _adaptedMemoryEmbeddings?: number[][];
    _samplingProbabilities?: number[];
    _selectedIndices?: number[];
    userId?: string;
    store?: BaseStore;
    isSessionEnd?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * State interface for afterModel hook
 */
interface AfterModelState {
  messages: BaseMessage[];
  _rerankerWeights: RerankerState;
  _retrievedMemories: RetrievedMemory[];
  _citations: CitationRecord[];
  _gradientAccumulator?: GradientSample[];
  _turnCountInSession: number;
}

// ============================================================================
// Hook Factory
// ============================================================================

/**
 * Creates an afterModel hook for Retrospective Reflection
 *
 * This hook implements the REINFORCE update for the reranker:
 * 1. Checks for citations from wrapModelCall
 * 2. Builds gradient sample with embeddings and probabilities
 * 3. Accumulates gradients (batch size = 4)
 * 4. Applies update and persists to BaseStore
 *
 * @param options - Configuration options
 * @returns Middleware with afterModel hook
 *
 * @example
 * ```typescript
 * const afterModel = createRetrospectiveAfterModel({
 *   batchSize: 4,
 *   clipThreshold: 100,
 * });
 *
 * const agent = createAgent({
 *   model,
 *   middleware: [afterModel],
 * });
 * ```
 */
export function createRetrospectiveAfterModel(options: AfterModelOptions = {}) {
  // Apply defaults
  const batchSize = options.batchSize ?? 4;
  const clipThreshold = options.clipThreshold ?? 100;

  return {
    name: "rmm-after-model",

    afterModel: async (
      state: AfterModelState,
      runtime: AfterModelRuntime
    ): Promise<Record<string, unknown>> => {
      // Step 1: Check for citations
      const citations = runtime.context._citations ?? [];
      const userId = runtime.context.userId;
      const store = runtime.context.store;

      // No citations extracted (malformed or error) → skip RL update
      if (citations.length === 0) {
        console.debug("[after-model] No citations found, skipping RL update");
        return {
          _turnCountInSession: state._turnCountInSession,
        };
      }

      // Missing required context → skip update
      if (!(userId && store)) {
        console.warn(
          "[after-model] Missing userId or store, skipping RL update"
        );
        return {
          _turnCountInSession: state._turnCountInSession,
        };
      }

      try {
        // Step 2: Build GradientSample from runtime context
        const gradientSample = buildGradientSample(
          state._rerankerWeights,
          citations,
          {
            originalQuery: runtime.context._originalQuery,
            adaptedQuery: runtime.context._adaptedQuery,
            originalMemoryEmbeddings: runtime.context._originalMemoryEmbeddings,
            adaptedMemoryEmbeddings: runtime.context._adaptedMemoryEmbeddings,
            samplingProbabilities: runtime.context._samplingProbabilities,
            selectedIndices: runtime.context._selectedIndices,
          }
        );

        // Step 3: Load gradient accumulator from BaseStore
        const gradientStorage = createGradientStorage(store);
        let accumulator = await gradientStorage.load(userId);

        if (!accumulator) {
          // Create new accumulator
          accumulator = {
            samples: [],
            accumulatedGradWq: createZeroMatrix(
              EMBEDDING_DIMENSION,
              EMBEDDING_DIMENSION
            ),
            accumulatedGradWm: createZeroMatrix(
              EMBEDDING_DIMENSION,
              EMBEDDING_DIMENSION
            ),
            lastBatchIndex: 0,
            lastUpdated: Date.now(),
          };
        }

        // Add new sample to accumulator
        accumulator.samples.push(gradientSample);
        accumulator.lastUpdated = Date.now();

        // Step 4: Compute exact REINFORCE gradients for this sample
        const sampleGradients = computeExactGradients(
          gradientSample,
          state._rerankerWeights
        );

        // Accumulate gradients
        accumulator.accumulatedGradWq = addMatrix(
          accumulator.accumulatedGradWq,
          sampleGradients.gradWq
        );
        accumulator.accumulatedGradWm = addMatrix(
          accumulator.accumulatedGradWm,
          sampleGradients.gradWm
        );

        // Step 5: Check if batch is full or session is ending
        const isSessionEnd = runtime.context.isSessionEnd ?? false;
        const shouldApplyUpdate =
          accumulator.samples.length >= batchSize || isSessionEnd;

        let updatedWeights = state._rerankerWeights;

        if (shouldApplyUpdate) {
          // Step 6: Apply gradient update to weights
          updatedWeights = applyGradientUpdate(
            state._rerankerWeights,
            accumulator.accumulatedGradWq,
            accumulator.accumulatedGradWm,
            clipThreshold
          );

          console.info(
            `[after-model] Applied gradient update (batch size: ${accumulator.samples.length})`
          );

          // Clear accumulator after applying
          accumulator = {
            samples: [],
            accumulatedGradWq: createZeroMatrix(
              EMBEDDING_DIMENSION,
              EMBEDDING_DIMENSION
            ),
            accumulatedGradWm: createZeroMatrix(
              EMBEDDING_DIMENSION,
              EMBEDDING_DIMENSION
            ),
            lastBatchIndex: accumulator.lastBatchIndex + 1,
            lastUpdated: Date.now(),
          };
        }

        // Step 7: Persist updated weights to BaseStore
        const weightStorage = createWeightStorage(store);
        const saved = await weightStorage.saveWeights(userId, updatedWeights);

        if (!saved) {
          console.warn("[after-model] Failed to persist updated weights");
        }

        // Persist accumulator state
        await gradientStorage.save(userId, accumulator);

        // Step 8: Clear runtime context embeddings for next turn
        clearRuntimeContext(runtime);

        // Return updated state
        return {
          _rerankerWeights: updatedWeights,
          _gradientAccumulator: accumulator.samples,
          _citations: [],
          _turnCountInSession: state._turnCountInSession,
        };
      } catch (error) {
        console.warn(
          "[after-model] Error during RL update, continuing:",
          error instanceof Error ? error.message : String(error)
        );

        // Clear context even on error
        clearRuntimeContext(runtime);

        return {
          _turnCountInSession: state._turnCountInSession,
        };
      }
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Builds a GradientSample from runtime context and citations
 */
function buildGradientSample(
  _reranker: RerankerState,
  citations: CitationRecord[],
  contextData: {
    originalQuery?: number[];
    adaptedQuery?: number[];
    originalMemoryEmbeddings?: number[][];
    adaptedMemoryEmbeddings?: number[][];
    samplingProbabilities?: number[];
    selectedIndices?: number[];
  }
): GradientSample {
  // Validate and extract data
  const originalQuery = contextData.originalQuery;
  const adaptedQuery = contextData.adaptedQuery;
  const originalMemEmbeddings = contextData.originalMemoryEmbeddings;
  const adaptedMemEmbeddings = contextData.adaptedMemoryEmbeddings;
  const samplingProbabilities = contextData.samplingProbabilities;
  const selectedIndices = contextData.selectedIndices;

  // Validate required data
  if (!originalQuery || originalQuery.length === 0) {
    throw new Error("Missing original query embedding");
  }

  if (originalQuery.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Invalid query embedding dimension: expected ${EMBEDDING_DIMENSION}, got ${originalQuery.length}`
    );
  }

  if (!adaptedQuery || adaptedQuery.length === 0) {
    throw new Error("Missing adapted query embedding");
  }

  if (adaptedQuery.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Invalid adapted query dimension: expected ${EMBEDDING_DIMENSION}, got ${adaptedQuery.length}`
    );
  }

  if (!originalMemEmbeddings || originalMemEmbeddings.length === 0) {
    throw new Error("Missing original memory embeddings");
  }

  // Validate each memory embedding has correct dimension
  for (let i = 0; i < originalMemEmbeddings.length; i++) {
    const emb = originalMemEmbeddings[i];
    if (!emb || emb.length !== EMBEDDING_DIMENSION) {
      throw new Error(
        `Invalid memory embedding at index ${i}: expected ${EMBEDDING_DIMENSION} dimensions`
      );
    }
  }

  if (!adaptedMemEmbeddings || adaptedMemEmbeddings.length === 0) {
    throw new Error("Missing adapted memory embeddings");
  }

  // Validate each adapted memory embedding has correct dimension
  for (let i = 0; i < adaptedMemEmbeddings.length; i++) {
    const emb = adaptedMemEmbeddings[i];
    if (!emb || emb.length !== EMBEDDING_DIMENSION) {
      throw new Error(
        `Invalid adapted memory embedding at index ${i}: expected ${EMBEDDING_DIMENSION} dimensions`
      );
    }
  }

  if (!samplingProbabilities || samplingProbabilities.length === 0) {
    throw new Error("Missing sampling probabilities");
  }

  // Validate sampling probabilities array matches memory count
  if (samplingProbabilities.length !== originalMemEmbeddings.length) {
    throw new Error(
      `Sampling probabilities length mismatch: expected ${originalMemEmbeddings.length}, got ${samplingProbabilities.length}`
    );
  }

  if (!selectedIndices || selectedIndices.length === 0) {
    throw new Error("Missing selected indices");
  }

  // Get K (number of retrieved memories) and validate selected indices
  const k = originalMemEmbeddings.length;

  // Validate selected indices are within bounds
  for (const idx of selectedIndices) {
    if (idx < 0 || idx >= k) {
      throw new Error(`Selected index ${idx} out of bounds for ${k} memories`);
    }
  }

  // Validate citations array - sparse citations are OK (some memories may not be cited)
  // All K memories will get rewards: +1 if cited, -1 if not
  if (citations.length > k) {
    throw new Error(
      `Citations length mismatch: expected at most ${k} citations for ${k} memories, got ${citations.length}`
    );
  }

  // Build citation rewards array matching K memories
  // Default to -1 (not cited) for all memories
  const citationRewards: Array<1 | -1> = new Array(k).fill(-1) as Array<1 | -1>;

  // Override with +1 for explicitly cited memories
  for (const citation of citations) {
    if (citation.turnIndex >= 0 && citation.turnIndex < k) {
      citationRewards[citation.turnIndex] = citation.reward;
    }
  }

  return {
    queryEmbedding: originalQuery,
    adaptedQuery,
    memoryEmbeddings: originalMemEmbeddings,
    adaptedMemories: adaptedMemEmbeddings,
    samplingProbabilities,
    selectedIndices,
    citationRewards,
    timestamp: Date.now(),
  };
}

/**
 * Computes exact REINFORCE gradients for a single sample
 *
 * Implements Equation 3 from the paper:
 * Δφ = η·(R-b)·∇_φ log P(M_M|q, M_K; φ)
 *
 * For the reranker's linear transformation matrices:
 * - ∇_W_q: (R_i - b)·m'_i·q^T for each selected memory i
 * - ∇_W_m: (R_i - b)·q'·m_i^T for each selected memory i
 */
interface SampleGradients {
  gradWq: number[][];
  gradWm: number[][];
}

function computeExactGradients(
  sample: GradientSample,
  reranker: RerankerState
): SampleGradients {
  const η = reranker.config.learningRate;
  const b = reranker.config.baseline;
  const gradWq = createZeroMatrix(EMBEDDING_DIMENSION, EMBEDDING_DIMENSION);
  const gradWm = createZeroMatrix(EMBEDDING_DIMENSION, EMBEDDING_DIMENSION);

  const k = sample.samplingProbabilities.length;
  const P = sample.samplingProbabilities;
  const selectedIndices = new Set(sample.selectedIndices);

  // For exact REINFORCE, we need the gradient of log P(M_M|q, M_K; φ)
  //
  // For Gumbel-Softmax with probabilities P_i:
  // ∂log P_i / ∂s̃_j = δ_ij - P_j
  //
  // The score s̃_i depends on weights through:
  // s̃_i = q'^T · m'_i = q'^T · (W_m · m_i)
  //
  // Using chain rule:
  // ∂s̃_i / ∂W_q = m'_i · q'^T (for W_q)
  // ∂s̃_i / ∂W_m = q' · m_i^T (for W_m)
  //
  // Therefore:
  // ∂log P_i / ∂W_q = Σ_j (δ_ij - P_j) · ∂s̃_j / ∂W_q
  //                  = (1 - P_i) · m'_i · q'^T - Σ_{j≠i} P_j · m'_j · q'^T
  //
  // Simplified using E[∇s̃] = Σ_j P_j · ∂s̃_j / ∂W:
  // ∂log P_i / ∂W = (1 - P_i) · ∂s̃_i / ∂W - E[∇s̃]
  //
  // This gives us the exact REINFORCE gradient:
  // ΔW_q = η·(R-b)·[(1-P_i)·m'_i - Σ_{j≠i} P_j·m'_j]·q'^T
  //      = η·(R-b)·[(1-P_i)·m'_i - (E[m'_] - P_i·m'_i)]·q'^T
  //      = η·(R-b)·[m'_i - E[m'_]]·q'^T
  //
  // Similarly for W_m:
  // ΔW_m = η·(R-b)·q'·[m_i - E[m]]^T

  // Compute expected (weighted average) of memories under sampling distribution
  const expectedMemOriginal: number[] = new Array(EMBEDDING_DIMENSION).fill(0);
  const expectedMemAdapted: number[] = new Array(EMBEDDING_DIMENSION).fill(0);

  for (let j = 0; j < k; j++) {
    const m_j = sample.memoryEmbeddings[j];
    const m_j_prime = sample.adaptedMemories[j];
    const P_j = P[j];

    if (m_j && m_j_prime && P_j !== undefined) {
      for (let d = 0; d < EMBEDDING_DIMENSION; d++) {
        const origVal = expectedMemOriginal[d];
        const adaptedVal = expectedMemAdapted[d];
        const m_j_d = m_j[d];
        const m_j_prime_d = m_j_prime[d];

        // Explicit null/undefined checks
        if (
          origVal !== undefined &&
          adaptedVal !== undefined &&
          m_j_d !== undefined &&
          m_j_prime_d !== undefined
        ) {
          expectedMemOriginal[d] = origVal + P_j * m_j_d;
          expectedMemAdapted[d] = adaptedVal + P_j * m_j_prime_d;
        }
      }
    }
  }

  // For each memory i in Top-K
  for (let i = 0; i < k; i++) {
    // Validate index exists in citationRewards array
    const R = sample.citationRewards[i];
    if (R === undefined) {
      continue;
    }
    const advantage = R - b;

    // Skip if advantage is effectively zero (no gradient contribution)
    if (Math.abs(advantage) < EPSILON) {
      continue;
    }

    const q_prime = sample.adaptedQuery;
    const m_i_prime = sample.adaptedMemories[i];
    const m_i = sample.memoryEmbeddings[i];
    const P_i = P[i];

    // Skip if any required data is missing
    if (!(q_prime && m_i_prime && m_i && P_i !== undefined)) {
      continue;
    }

    // Validate array dimensions before accessing elements
    if (
      q_prime.length !== EMBEDDING_DIMENSION ||
      m_i_prime.length !== EMBEDDING_DIMENSION ||
      m_i.length !== EMBEDDING_DIMENSION
    ) {
      continue;
    }

    // Compute the coefficient for memory i:
    // (1 - P_i) for selected - P_i for memory i itself in the sum
    // This simplifies to: coefficient_i = 1 - 2*P_i
    // But more accurately, we use:
    // gradient_term = (1 - P_i) - P_i = 1 - 2*P_i for the self term
    // For cross terms: -P_j for j ≠ i
    // Total: (1 - P_i) for self - Σ_{j≠i} P_j = 1 - P_i - (1 - P_i) = 0 ???

    // Actually, let's use the correct REINFORCE formulation:
    // Δφ = η·(R-b)·∇_φ log P(selected | φ)
    //
    // For Gumbel-Softmax, the gradient is:
    // ∇log P_i = ∇s̃_i - Σ_j P_j·∇s̃_j
    //          = ∇s̃_i - E[∇s̃]
    //
    // Where ∇s̃_i = q' (for W_m) or m'_i (for W_q)

    // For each memory, compute gradient contribution
    // The exact REINFORCE gradient uses: (I_i - P_i) where I_i is indicator of selection
    const isSelected = selectedIndices.has(i);
    const indicator = isSelected ? 1 : 0;

    // Apply gradient using exact REINFORCE formula:
    // ΔW_q = η·(R-b)·[(I_i - P_i) · (m'_i - E[m'_]) ⊗ q'^T]
    // ΔW_m = η·(R-b)·[(I_i - P_i) · q' ⊗ (m_i - E[m])^T]
    for (let row = 0; row < EMBEDDING_DIMENSION; row++) {
      const gradWqRow = gradWq[row];
      const gradWmRow = gradWm[row];
      const m_i_prime_row = m_i_prime[row];
      const q_prime_row = q_prime[row];
      const m_i_row = m_i[row];

      // Skip if row-level arrays are undefined
      if (
        !(gradWqRow && gradWmRow) ||
        m_i_prime_row === undefined ||
        q_prime_row === undefined ||
        m_i_row === undefined
      ) {
        continue;
      }

      for (let col = 0; col < EMBEDDING_DIMENSION; col++) {
        const q_prime_col = q_prime[col];
        const m_i_col = m_i[col];

        // Validate column-level array access
        if (q_prime_col === undefined || m_i_col === undefined) {
          continue;
        }

        // Explicit null guards for row arrays
        if (gradWqRow !== undefined && gradWmRow !== undefined) {
          // Exact REINFORCE gradient:
          // ΔW_q = η·(R-b)·[(I_i - P_i) · (m'_i - E[m'_]) ⊗ q'^T]
          // ΔW_m = η·(R-b)·[(I_i - P_i) · q' ⊗ (m_i - E[m])^T]
          const expectedAdaptedVal = expectedMemAdapted[row];
          const expectedOriginalVal = expectedMemOriginal[row];
          const coef = indicator - P_i;

          if (
            expectedAdaptedVal !== undefined &&
            expectedOriginalVal !== undefined
          ) {
            const diffAdapted = m_i_prime_row - expectedAdaptedVal;
            const diffOriginal = m_i_row - expectedOriginalVal;

            gradWqRow[col] =
              (gradWqRow[col] ?? 0) + η * advantage * coef * diffAdapted * q_prime_col;

            const gradWmCol = gradWm[col];
            if (gradWmCol !== undefined) {
              gradWmCol[row] =
                (gradWmCol[row] ?? 0) +
                η * advantage * coef * q_prime_col * diffOriginal;
            }
          }
        }
      }
    }
  }

  return { gradWq, gradWm };
}

/**
 * Applies accumulated gradients to reranker weights
 */
function applyGradientUpdate(
  reranker: RerankerState,
  gradWq: number[][],
  gradWm: number[][],
  clipThreshold: number
): RerankerState {
  // Apply gradients to weights (gradWq/gradWm already scaled by η in gradient computation)
  const newWq = addMatrix(reranker.weights.queryTransform, gradWq);
  const newWm = addMatrix(reranker.weights.memoryTransform, gradWm);

  // Clip weights to prevent explosion
  const clippedWq = clipMatrix(newWq, -clipThreshold, clipThreshold);
  const clippedWm = clipMatrix(newWm, -clipThreshold, clipThreshold);

  return {
    ...reranker,
    weights: {
      queryTransform: clippedWq,
      memoryTransform: clippedWm,
    },
  };
}

/**
 * Clears runtime context embeddings after processing
 */
function clearRuntimeContext(runtime: AfterModelRuntime): void {
  runtime.context._citations = [];
  runtime.context._originalQuery = undefined;
  runtime.context._adaptedQuery = undefined;
  runtime.context._originalMemoryEmbeddings = undefined;
  runtime.context._adaptedMemoryEmbeddings = undefined;
  runtime.context._samplingProbabilities = undefined;
  runtime.context._selectedIndices = undefined;
}
