/**
 * Similarity metrics for RMM (Reflective Memory Management) algorithms.
 *
 * Implements similarity calculations for reranker scoring:
 * - Cosine similarity: measures directional alignment between vectors
 * - Dot product: computes q'^T · m'_i for scoring memories
 *
 * All functions handle edge cases (zero vectors, dimension mismatches)
 * and return values in expected ranges.
 */

/**
 * Computes the dot product of two vectors.
 *
 * Used for: q'^T · m'_i scoring in the reranker algorithm.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Scalar dot product value
 * @throws Error if vectors have different dimensions or are empty
 */
export function dotProduct(a: number[], b: number[]): number {
  // Validate inputs
  if (a.length === 0 || b.length === 0) {
    throw new Error("Vectors cannot be empty");
  }

  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  // Compute dot product: Σ(a_i * b_i)
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }

  return sum;
}

/**
 * Computes the L2 norm (Euclidean norm) of a vector.
 *
 * @param v - Input vector
 * @returns L2 norm: sqrt(Σ(v_i²))
 */
function l2Norm(v: number[]): number {
  let sumSquared = 0;
  for (const val of v) {
    sumSquared += val * val;
  }
  return Math.sqrt(sumSquared);
}

/**
 * Computes cosine similarity between two vectors.
 *
 * Returns value in range [-1, 1] where:
 * - 1: identical direction
 * - 0: orthogonal (perpendicular)
 * - -1: opposite direction
 *
 * Handles zero vectors gracefully by returning 0 (not NaN).
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity in range [-1, 1]
 * @throws Error if vectors have different dimensions or are empty
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  // Validate inputs
  if (a.length === 0 || b.length === 0) {
    throw new Error("Vectors cannot be empty");
  }

  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  // Compute norms
  const normA = l2Norm(a);
  const normB = l2Norm(b);

  // Handle zero vectors: return 0 instead of NaN
  if (normA === 0 || normB === 0) {
    return 0;
  }

  // Compute cosine similarity: (a · b) / (||a|| * ||b||)
  const dotProd = dotProduct(a, b);
  const similarity = dotProd / (normA * normB);

  // Clamp to [-1, 1] to handle floating-point errors
  return Math.max(-1, Math.min(1, similarity));
}
