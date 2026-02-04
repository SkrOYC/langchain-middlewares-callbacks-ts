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
  if (transformMatrix.length !== embedding.length) {
    throw new Error(
      `Matrix rows (${transformMatrix.length}) must match embedding dimension (${embedding.length})`
    );
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
 * @returns Array of selected memories (length = topM or fewer if not enough memories)
 */
export function gumbelSoftmaxSample(
  memories: ScoredMemory[],
  topM: number,
  temperature = 0.5
): RetrievedMemory[] {
  if (!memories || memories.length === 0 || topM <= 0) {
    return [];
  }

  // Validate temperature parameter
  if (temperature <= 0) {
    throw new Error("Temperature must be a positive number");
  }

  // If topM >= number of memories, return all memories
  if (topM >= memories.length) {
    return [...memories];
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
  const perturbedScores = scores.map((s, i) => s + gumbelNoise[i]);

  // Apply temperature and compute softmax probabilities
  // p_i = exp(s̃_i/τ) / Σ_j exp(s̃_j/τ)
  const maxPerturbed = Math.max(...perturbedScores);
  const expScores = perturbedScores.map((s) =>
    Math.exp((s - maxPerturbed) / temperature)
  );
  const sumExp = expScores.reduce((acc, e) => acc + e, 0);

  // Handle numerical edge case where all expScores underflow to 0
  if (sumExp === 0 || !Number.isFinite(sumExp)) {
    return memories.slice(0, topM);
  }

  const probabilities = expScores.map((e) => e / sumExp);

  // Sample without replacement based on probabilities
  const selectedIndices = sampleWithoutReplacementFromProbabilities(
    probabilities,
    topM
  );

  // Return selected memories
  return selectedIndices.map((i) => memories[i]);
}

/**
 * Helper function to sample indices without replacement based on probabilities
 *
 * Uses cumulative distribution for efficient sampling.
 *
 * @param probabilities - Normalized probability distribution
 * @param topM - Number of samples to draw
 * @returns Array of selected indices
 */
function sampleWithoutReplacementFromProbabilities(
  probabilities: number[],
  topM: number
): number[] {
  if (topM >= probabilities.length) {
    return probabilities.map((_, i) => i);
  }

  const selectedIndices: number[] = [];
  const availableProbabilities = [...probabilities];
  const availableIndices = probabilities.map((_, i) => i);

  for (let i = 0; i < topM && availableProbabilities.length > 0; i++) {
    // Sample from the current distribution
    const total = availableProbabilities.reduce((a, b) => a + b, 0);
    if (total <= 0) {
      break;
    }

    const random = Math.random() * total;
    let cumulative = 0;
    let selectedIndex = -1;

    for (let j = 0; j < availableProbabilities.length; j++) {
      cumulative += availableProbabilities[j];

      if (random <= cumulative) {
        selectedIndex = j;
        break;
      }
    }

    // Store the original index
    selectedIndices.push(availableIndices[selectedIndex]);

    // Remove the selected item from both arrays
    availableProbabilities.splice(selectedIndex, 1);
    availableIndices.splice(selectedIndex, 1);
  }

  return selectedIndices;
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
    score += (queryEmbedding[i] ?? 0) * (memoryEmbedding[i] ?? 0);
  }

  return score;
}
