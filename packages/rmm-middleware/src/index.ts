// biome-ignore lint/performance/noBarrelFile: This is the main entry point barrel file

// ============================================================================
// Schemas and Types
// ============================================================================

export {
  // Types
  type BaseMessage,
  // Schemas
  BaseMessageSchema,
  type CitationRecord,
  CitationRecordSchema,
  type Context,
  ContextSchema,
  // Utility functions
  createDefaultRerankerState,
  // Constants
  EMBEDDING_DIMENSION,
  type MemoryEntry,
  MemoryEntrySchema,
  type MemoryExtractionOutput,
  MemoryExtractionOutputSchema,
  type MergeDecision,
  MergeDecisionSchema,
  type MergeDecisionType,
  MergeDecisionTypeSchema,
  type MiddlewareOptions,
  MiddlewareOptionsSchema,
  type RerankerState,
  RerankerStateSchema,
  type RetrievedMemory,
  RetrievedMemorySchema,
  type RMMState,
  RMMStateSchema,
  validateEmbeddingDimension,
} from "./schemas/index.ts";

// ============================================================================
// Core Utilities (RMM-2)
// ============================================================================

export {
  type CitationResult,
  // Similarity metrics
  cosineSimilarity,
  dotProduct,
  // Citation extraction
  extractCitations,
  // Matrix operations
  initializeMatrix,
  matmul,
  matmulVector,
  residualAdd,
  validateCitations,
} from "./utils/index.ts";
