/**
 * Core mathematical utilities for RMM algorithms.
 *
 * @module utils
 */

// Citation extraction
export {
  type CitationResult,
  extractCitations,
  validateCitations,
} from "./citationExtractor.ts";
// Matrix operations
export {
  initializeMatrix,
  matmul,
  matmulVector,
  residualAdd,
} from "./matrix.ts";
// Similarity metrics
export { cosineSimilarity, dotProduct } from "./similarity.ts";
