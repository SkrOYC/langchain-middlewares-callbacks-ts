/**
 * Reranking algorithms for Retrospective Reflection
 *
 * Implements the core mathematical operations from the paper:
 * - Equation 1: Embedding adaptation with linear transformation and residual
 * - Equation 2: Gumbel-Softmax sampling for stochastic selection
 */

import type { RetrievedMemory } from "@/schemas/index";
import { matmulVector, residualAdd } from "@/utils/matrix";

/**
 * Extended memory interface with rerank score
 */
export interface ScoredMemory extends RetrievedMemory {
  rerankScore: number;
}

/**
 * Result of Gumbel-Softmax sampling with probabilities for exact REINFORCE
 */
export interface SamplingResult {
  /**
   * Selected memories for LLM context (Top-M)
   */
  selectedMemories: RetrievedMemory[];

  /**
   * Sampling probabilities for ALL K memories.
   * Used in exact REINFORCE gradient computation.
   * P_i = exp(s̃_i/τ) / Σ_j exp(s̃_j/τ)
   */
  allProbabilities: number[];

  /**
   * Indices of selected memories in the original array
   */
  selectedIndices: number[];
}

/**
 * Applies embedding adaptation using Equation 1 from the paper
 *
 * Equation: q' = q + W_q · q
 *          m'_i = m_i + W_m · m_i
 *
 * This applies a linear transformation with residual connection
 * to adapt query and memory embeddings for better relevance scoring.
 *
 * @param embedding - Original embedding vector (1536-dim)
 * @param transformMatrix - Linear transformation matrix (1536×1536)
 * @returns Adapted embedding with same dimensions as input
 */
export function applyEmbeddingAdaptation(
  embedding: number[],
  transformMatrix: number[][]
): number[] {
  if (!embedding || embedding.length === 0) {
    throw new Error("Embedding vector cannot be empty");
  }

  if (!transformMatrix || transformMatrix.length === 0) {
    throw new Error("Transformation matrix cannot be empty");
  }

  // Validate matrix dimensions
  // Matrix must be square with dimensions matching embedding length
  if (transformMatrix.length !== embedding.length) {
    throw new Error(
      `Matrix rows (${transformMatrix.length}) must match embedding dimension (${embedding.length})`
    );
  }

  // Validate each row has the correct number of columns
  for (let i = 0; i < transformMatrix.length; i++) {
    const row = transformMatrix[i];
    if (!row || row.length !== embedding.length) {
      throw new Error(
        `Matrix row ${i} is invalid or has ${row?.length ?? "undefined"} columns, expected ${embedding.length}`
      );
    }
  }

  // Compute W · embedding
  const transformed = matmulVector(transformMatrix, embedding);

  // Compute residual: embedding + W·embedding
  const adapted = residualAdd(embedding, transformed);

  return adapted;
}

/**
 * Performs Gumbel-Softmax sampling to select Top-M memories
 *
 * Equation 2 from the paper:
 * g_i = -log(-log(u_i)) where u_i ~ Uniform(0, 1)
 * s̃_i = s_i + g_i
 * p_i = exp(s̃_i/τ) / Σ_j exp(s̃_j/τ)
 *
 * This enables stochastic sampling while preserving gradients,
 * allowing the reranker to learn through reinforcement learning.
 *
 * @param memories - Array of scored memories to select from
 * @param topM - Number of memories to select
 * @param temperature - Temperature parameter τ (default: 0.5)
 *                     Lower τ = more deterministic (peaky distribution)
 *                     Higher τ = more stochastic (uniform distribution)
 * @returns SamplingResult with selected memories and probabilities for exact REINFORCE
 */
export function gumbelSoftmaxSample(
  memories: ScoredMemory[],
  topM: number,
  temperature = 0.5
): SamplingResult {
  if (!memories || memories.length === 0 || topM <= 0) {
    return {
      selectedMemories: [],
      allProbabilities: [],
      selectedIndices: [],
    };
  }

  // Validate temperature parameter
  if (temperature <= 0) {
    throw new Error("Temperature must be a positive number");
  }

  // If topM >= number of memories, return all memories
  if (topM >= memories.length) {
    const allProbabilities = memories.map(() => 1 / memories.length);
    return {
      selectedMemories: [...memories],
      allProbabilities,
      selectedIndices: memories.map((_, i) => i),
    };
  }

  // Extract rerank scores
  const scores = memories.map((m) => m.rerankScore ?? 0);

  // Compute Gumbel noise: g_i = -log(-log(u_i))
  // Use bounds to prevent Math.random() from returning exactly 0 or 1
  const gumbelNoise = scores.map(() => {
    const u = Math.random() * 0.999_999 + 0.000_000_5; // Avoid exact 0 or 1
    return -Math.log(-Math.log(u));
  });

  // Add Gumbel noise to scores: s̃_i = s_i + g_i
  const perturbedScores = scores.map((s, i) => {
    const noise = gumbelNoise[i] ?? 0;
    return s + noise;
  });

  // Apply temperature and compute softmax probabilities
  // p_i = exp(s̃_i/τ) / Σ_j exp(s̃_j/τ)
  const maxPerturbed = Math.max(...perturbedScores);
  const expScores = perturbedScores.map((s) =>
    Math.exp((s - maxPerturbed) / temperature)
  );
  const sumExp = expScores.reduce((acc, e) => acc + e, 0);

  // Handle numerical edge case where all expScores underflow to 0
  if (sumExp === 0 || !Number.isFinite(sumExp)) {
    const fallbackProb = 1 / memories.length;
    const fallbackCount = Math.min(topM, memories.length);
    const fallbackIndices = Array.from({ length: fallbackCount }, (_, i) => i);
    const fallbackMemories = memories
      .slice(0, fallbackCount)
      .map((mem) => ({ ...mem }));

    return {
      selectedMemories: fallbackMemories,
      allProbabilities: new Array(memories.length).fill(fallbackProb),
      selectedIndices: fallbackIndices,
    };
  }

  const probabilities = expScores.map((e) => e / sumExp);

  // Gumbel-Top-K trick: select the Top-M memories with highest perturbed scores.
  // This is equivalent to sampling without replacement from the categorical
  // distribution defined by the softmax probabilities (Kool et al., 2019).
  const selectedIndices = selectTopMByPerturbedScore(perturbedScores, topM);

  // Return selected memories with shallow copies to prevent mutation
  const validSelectedMemories: RetrievedMemory[] = [];
  for (const idx of selectedIndices) {
    const mem = memories[idx];
    if (mem?.id) {
      validSelectedMemories.push({ ...mem });
    }
  }

  return {
    selectedMemories: validSelectedMemories,
    allProbabilities: probabilities,
    selectedIndices,
  };
}

/**
 * Selects the Top-M indices by highest perturbed score (Gumbel-Top-K trick).
 *
 * Per the paper and Kool et al. (2019), selecting the items with the
 * highest Gumbel-perturbed log-probabilities is equivalent to sampling
 * without replacement from the categorical distribution.
 *
 * @param perturbedScores - Array of Gumbel-perturbed scores (s̃_i = s_i + g_i)
 * @param topM - Number of items to select
 * @returns Array of selected indices (sorted by descending perturbed score)
 */
function selectTopMByPerturbedScore(
  perturbedScores: number[],
  topM: number
): number[] {
  if (topM >= perturbedScores.length) {
    return perturbedScores.map((_, i) => i);
  }

  // Create index-score pairs and sort by descending perturbed score
  const indexed = perturbedScores.map((score, i) => ({ index: i, score }));
  indexed.sort((a, b) => b.score - a.score);

  // Take the top-M indices
  return indexed.slice(0, topM).map((entry) => entry.index);
}

/**
 * Computes relevance score between query and memory embeddings
 *
 * Uses dot product after embedding adaptation:
 * score = q'^T · m'_i
 *
 * @param queryEmbedding - Adapted query embedding
 * @param memoryEmbedding - Memory embedding (may be adapted or original)
 * @returns Scalar relevance score
 */
export function computeRelevanceScore(
  queryEmbedding: number[],
  memoryEmbedding: number[]
): number {
  if (queryEmbedding.length !== memoryEmbedding.length) {
    throw new Error(
      `Embedding dimension mismatch: query (${queryEmbedding.length}) vs memory (${memoryEmbedding.length})`
    );
  }

  // Compute dot product: Σ(q'_i * m'_i)
  let score = 0;
  for (let i = 0; i < queryEmbedding.length; i++) {
    const product = (queryEmbedding[i] ?? 0) * (memoryEmbedding[i] ?? 0);
    // Check for overflow before adding (though unlikely for typical embedding values)
    if (!(Number.isFinite(score) && Number.isFinite(product))) {
      break;
    }
    score += product;
  }

  // Clamp score to safe bounds if overflow occurred
  if (!Number.isFinite(score)) {
    score = Number.MAX_SAFE_INTEGER;
  }

  return score;
}
