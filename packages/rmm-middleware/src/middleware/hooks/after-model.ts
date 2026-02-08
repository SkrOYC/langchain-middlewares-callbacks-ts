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
import { createGradientStorage } from "@/storage/gradient-storage";
import { createWeightStorage } from "@/storage/weight-storage";
import { getLogger } from "@/utils/logger";
import { addMatrix, clipMatrix, createZeroMatrix } from "@/utils/matrix";

const logger = getLogger("after-model");

// ============================================================================
// Constants
// ============================================================================

/**
 * Floating point comparison threshold for gradient computation
 */
const EPSILON = 1e-9;

/**
 * Derives the embedding dimension from the reranker weight matrices.
 * This avoids hardcoding EMBEDDING_DIMENSION and supports arbitrary
 * embedding models (e.g., 768 for Contriever, 1536 for OpenAI).
 */
function getEmbeddingDimension(reranker: RerankerState): number {
  return reranker.weights.queryTransform.length;
}

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
        logger.debug("No citations found, skipping RL update");
        return {
          _turnCountInSession: state._turnCountInSession,
        };
      }

      // Missing required context → skip update
      if (!(userId && store)) {
        logger.warn("Missing userId or store, skipping RL update");
        return {
          _turnCountInSession: state._turnCountInSession,
        };
      }

      try {
        const embDim = getEmbeddingDimension(state._rerankerWeights);

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
          },
          embDim
        );

        // Step 3: Load gradient accumulator from BaseStore
        const gradientStorage = createGradientStorage(store);
        let accumulator = await gradientStorage.load(userId);

        if (!accumulator) {
          // Create new accumulator
          accumulator = {
            samples: [],
            accumulatedGradWq: createZeroMatrix(embDim, embDim),
            accumulatedGradWm: createZeroMatrix(embDim, embDim),
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
          state._rerankerWeights,
          embDim
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

          logger.info(
            `Applied gradient update (batch size: ${accumulator.samples.length})`
          );

          // Clear accumulator after applying
          accumulator = {
            samples: [],
            accumulatedGradWq: createZeroMatrix(embDim, embDim),
            accumulatedGradWm: createZeroMatrix(embDim, embDim),
            lastBatchIndex: accumulator.lastBatchIndex + 1,
            lastUpdated: Date.now(),
          };
        }

        // Step 7: Persist updated weights to BaseStore
        const weightStorage = createWeightStorage(store);
        const saved = await weightStorage.saveWeights(userId, updatedWeights);

        if (!saved) {
          logger.warn("Failed to persist updated weights");
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
        logger.warn(
          "Error during RL update, continuing:",
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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validates and returns the original query embedding
 */
function validateOriginalQuery(
  originalQuery: number[] | undefined,
  embDim: number
): number[] {
  if (!originalQuery || originalQuery.length === 0) {
    throw new Error("Missing original query embedding");
  }
  if (originalQuery.length !== embDim) {
    throw new Error(
      `Invalid query embedding dimension: expected ${embDim}, got ${originalQuery.length}`
    );
  }
  return originalQuery;
}

/**
 * Validates and returns the adapted query embedding
 */
function validateAdaptedQuery(
  adaptedQuery: number[] | undefined,
  embDim: number
): number[] {
  if (!adaptedQuery || adaptedQuery.length === 0) {
    throw new Error("Missing adapted query embedding");
  }
  if (adaptedQuery.length !== embDim) {
    throw new Error(
      `Invalid adapted query dimension: expected ${embDim}, got ${adaptedQuery.length}`
    );
  }
  return adaptedQuery;
}

/**
 * Validates and returns memory embeddings with correct dimension
 */
function validateMemoryEmbeddings(
  embeddings: number[][] | undefined,
  embeddingName: string,
  embDim: number
): number[][] {
  if (!embeddings || embeddings.length === 0) {
    throw new Error(`Missing ${embeddingName}`);
  }

  for (let i = 0; i < embeddings.length; i++) {
    const emb = embeddings[i];
    if (!emb || emb.length !== embDim) {
      throw new Error(
        `Invalid memory embedding at index ${i}: expected ${embDim} dimensions`
      );
    }
  }

  return embeddings;
}

/**
 * Validates sampling probabilities array
 */
function validateSamplingProbabilities(
  samplingProbabilities: number[] | undefined,
  memoryCount: number
): number[] {
  if (!samplingProbabilities || samplingProbabilities.length === 0) {
    throw new Error("Missing sampling probabilities");
  }
  if (samplingProbabilities.length !== memoryCount) {
    throw new Error(
      `Sampling probabilities length mismatch: expected ${memoryCount}, got ${samplingProbabilities.length}`
    );
  }
  return samplingProbabilities;
}

/**
 * Validates selected indices and returns them
 */
function validateSelectedIndices(
  selectedIndices: number[] | undefined,
  k: number
): number[] {
  if (!selectedIndices || selectedIndices.length === 0) {
    throw new Error("Missing selected indices");
  }

  for (const idx of selectedIndices) {
    if (idx < 0 || idx >= k) {
      throw new Error(`Selected index ${idx} out of bounds for ${k} memories`);
    }
  }

  return selectedIndices;
}

/**
 * Builds citation rewards array for K memories
 */
function buildCitationRewards(
  citations: CitationRecord[],
  k: number
): Array<1 | -1> {
  const citationRewards: Array<1 | -1> = new Array(k).fill(-1) as Array<1 | -1>;

  for (const citation of citations) {
    if (citation.turnIndex >= 0 && citation.turnIndex < k) {
      citationRewards[citation.turnIndex] = citation.reward;
    }
  }

  return citationRewards;
}

/**
 * Validates citations array length
 */
function validateCitations(citations: CitationRecord[], k: number): void {
  if (citations.length > k) {
    throw new Error(
      `Citations length mismatch: expected at most ${k} citations for ${k} memories, got ${citations.length}`
    );
  }
}

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
  },
  embDim: number
): GradientSample {
  const originalQuery = validateOriginalQuery(
    contextData.originalQuery,
    embDim
  );
  const adaptedQuery = validateAdaptedQuery(contextData.adaptedQuery, embDim);
  const originalMemEmbeddings = validateMemoryEmbeddings(
    contextData.originalMemoryEmbeddings,
    "original memory embeddings",
    embDim
  );
  const adaptedMemEmbeddings = validateMemoryEmbeddings(
    contextData.adaptedMemoryEmbeddings,
    "adapted memory embeddings",
    embDim
  );

  const k = originalMemEmbeddings.length;
  const samplingProbabilities = validateSamplingProbabilities(
    contextData.samplingProbabilities,
    k
  );
  const selectedIndices = validateSelectedIndices(
    contextData.selectedIndices,
    k
  );

  validateCitations(citations, k);

  const citationRewards = buildCitationRewards(citations, k);

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
// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Computes expected (weighted average) of memories under sampling distribution
 */
function computeExpectedMemories(
  sample: GradientSample,
  k: number,
  P: number[],
  embDim: number
): { expectedMemOriginal: number[]; expectedMemAdapted: number[] } {
  const expectedMemOriginal: number[] = new Array(embDim).fill(0);
  const expectedMemAdapted: number[] = new Array(embDim).fill(0);

  for (let j = 0; j < k; j++) {
    const m_j = sample.memoryEmbeddings[j];
    const m_j_prime = sample.adaptedMemories[j];
    const P_j = P[j];

    if (m_j && m_j_prime && P_j !== undefined) {
      for (let d = 0; d < embDim; d++) {
        const origVal = expectedMemOriginal[d];
        const adaptedVal = expectedMemAdapted[d];
        const m_j_d = m_j[d];
        const m_j_prime_d = m_j_prime[d];

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

  return { expectedMemOriginal, expectedMemAdapted };
}

/**
 * Computes gradient contributions for a single row of memory embedding.
 *
 * Per Equation 3 and the chain rule for the linear transformation:
 * - ∂s_i/∂W_q[row][col] = m'_{i,row} * q_{col}  (ORIGINAL query q)
 * - ∂s_i/∂W_m[row][col] = q'_{row} * m_{i,col}   (ADAPTED query q')
 *
 * The 1/τ factor comes from the softmax derivative in ∇ log P.
 */
function computeGradientRow(
  row: number,
  advantage: number,
  coef: number,
  η: number,
  invTemperature: number,
  expectedMemAdapted: number[],
  expectedMemOriginal: number[],
  gradWq: number[][],
  gradWm: number[][],
  q: number[],
  q_prime: number[],
  m_i_prime: number[],
  m_i: number[],
  embDim: number
): void {
  const gradWqRow = gradWq[row];
  const gradWmRow = gradWm[row];
  const m_i_prime_row = m_i_prime[row];
  const q_prime_row = q_prime[row];
  const m_i_row = m_i[row];

  if (
    !(gradWqRow && gradWmRow) ||
    m_i_prime_row === undefined ||
    q_prime_row === undefined ||
    m_i_row === undefined
  ) {
    return;
  }

  const expectedAdaptedVal = expectedMemAdapted[row];
  const expectedOriginalVal = expectedMemOriginal[row];

  if (expectedAdaptedVal === undefined || expectedOriginalVal === undefined) {
    return;
  }

  const diffAdapted = m_i_prime_row - expectedAdaptedVal;
  const diffOriginal = m_i_row - expectedOriginalVal;

  for (let col = 0; col < embDim; col++) {
    const q_col = q[col];
    const q_prime_col = q_prime[col];
    const m_i_col = m_i[col];

    if (
      q_col === undefined ||
      q_prime_col === undefined ||
      m_i_col === undefined
    ) {
      continue;
    }

    // W_q gradient: ∂s_i/∂W_q uses m'_i ⊗ q (original query)
    // Includes 1/τ from softmax derivative
    gradWqRow[col] =
      (gradWqRow[col] ?? 0) +
      η * invTemperature * advantage * coef * diffAdapted * q_col;

    // W_m gradient: ∂s_i/∂W_m uses q' ⊗ m_i (adapted query)
    // Includes 1/τ from softmax derivative
    const gradWmCol = gradWm[col];
    if (gradWmCol !== undefined) {
      gradWmCol[row] =
        (gradWmCol[row] ?? 0) +
        η * invTemperature * advantage * coef * q_prime_col * diffOriginal;
    }
  }
}

/**
 * Computes gradient contributions for a single memory
 */
function computeMemoryGradient(
  i: number,
  sample: GradientSample,
  learningRate: number,
  baseline: number,
  invTemperature: number,
  expectedMemOriginal: number[],
  expectedMemAdapted: number[],
  gradWq: number[][],
  gradWm: number[][],
  selectedIndices: Set<number>,
  embDim: number
): void {
  const R = sample.citationRewards[i];
  if (R === undefined) {
    return;
  }

  const advantage = R - baseline;
  if (Math.abs(advantage) < EPSILON) {
    return;
  }

  const q = sample.queryEmbedding;
  const q_prime = sample.adaptedQuery;
  const m_i_prime = sample.adaptedMemories[i];
  const m_i = sample.memoryEmbeddings[i];
  const P_i = sample.samplingProbabilities[i];

  if (!(q && q_prime && m_i_prime && m_i && P_i !== undefined)) {
    return;
  }

  if (
    q.length !== embDim ||
    q_prime.length !== embDim ||
    m_i_prime.length !== embDim ||
    m_i.length !== embDim
  ) {
    return;
  }

  const isSelected = selectedIndices.has(i);
  const indicator = isSelected ? 1 : 0;
  const coef = indicator - P_i;

  for (let row = 0; row < embDim; row++) {
    computeGradientRow(
      row,
      advantage,
      coef,
      learningRate,
      invTemperature,
      expectedMemAdapted,
      expectedMemOriginal,
      gradWq,
      gradWm,
      q,
      q_prime,
      m_i_prime,
      m_i,
      embDim
    );
  }
}

interface SampleGradients {
  gradWq: number[][];
  gradWm: number[][];
}

function computeExactGradients(
  sample: GradientSample,
  reranker: RerankerState,
  embDim: number
): SampleGradients {
  const learningRate = reranker.config.learningRate;
  const baseline = reranker.config.baseline;
  const temperature = reranker.config.temperature;
  const invTemperature = 1.0 / temperature;
  const gradWq = createZeroMatrix(embDim, embDim);
  const gradWm = createZeroMatrix(embDim, embDim);

  const k = sample.samplingProbabilities.length;
  const P = sample.samplingProbabilities;
  const selectedIndices = new Set(sample.selectedIndices);

  // Compute expected (weighted average) of memories under sampling distribution
  const { expectedMemOriginal, expectedMemAdapted } = computeExpectedMemories(
    sample,
    k,
    P,
    embDim
  );

  // For each memory i in Top-K
  for (let i = 0; i < k; i++) {
    computeMemoryGradient(
      i,
      sample,
      learningRate,
      baseline,
      invTemperature,
      expectedMemOriginal,
      expectedMemAdapted,
      gradWq,
      gradWm,
      selectedIndices,
      embDim
    );
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
