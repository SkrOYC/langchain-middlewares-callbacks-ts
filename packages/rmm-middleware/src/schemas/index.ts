import { z } from "zod";

// ============================================================================
// Constants
// ============================================================================

export const EMBEDDING_DIMENSION = 1536;

// ============================================================================
// MemoryEntry Schema
// ============================================================================

/**
 * Core memory unit stored in memory bank
 */
export const MemoryEntrySchema = z.object({
  id: z.string().uuid(),
  topicSummary: z.string().min(1),
  rawDialogue: z.string().min(1),
  timestamp: z.number().int().positive(),
  sessionId: z.string().min(1),
  embedding: z.array(z.number()).length(EMBEDDING_DIMENSION),
  turnReferences: z.array(z.number().int().nonnegative()),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

// ============================================================================
// RetrievedMemory Schema
// ============================================================================

/**
 * Retrieved memory with relevance scores.
 * Note: embedding is optional since VectorStore.similaritySearch doesn't return embeddings.
 * We use a separate base to avoid field duplication while making embedding optional.
 */
const RetrievedMemoryBaseSchema = z.object({
  id: z.string(), // Can be UUID or generated ID like "memory-{index}"
  topicSummary: z.string().min(1),
  rawDialogue: z.string().min(1),
  timestamp: z.number().int().positive(),
  sessionId: z.string().min(1),
  turnReferences: z.array(z.number().int().nonnegative()),
});

export const RetrievedMemorySchema = RetrievedMemoryBaseSchema.extend({
  embedding: z.array(z.number()).length(EMBEDDING_DIMENSION).optional(),
  relevanceScore: z.number(),
  rerankScore: z.number().optional(),
});

export type RetrievedMemory = z.infer<typeof RetrievedMemorySchema>;

// ============================================================================
// RerankerState Schema
// ============================================================================

/**
 * Configuration defaults per paper Appendix A.1
 */
const RERANKER_CONFIG_DEFAULTS = {
  topK: 20,
  topM: 5,
  temperature: 0.5,
  learningRate: 0.001,
  baseline: 0.5,
} as const;

/**
 * Validates that a matrix is 1536×1536
 */
const validateMatrix1536x1536 = (matrix: number[][]): boolean => {
  if (matrix.length !== EMBEDDING_DIMENSION) {
    return false;
  }
  return matrix.every((row) => row.length === EMBEDDING_DIMENSION);
};

/**
 * Learnable reranker state with transformation matrices
 * Architecture: Two linear matrices (1536×1536) for query and memory transformation
 * Memory: 2 × (1536 × 1536) floats ≈ 18MB total
 */
export const RerankerStateSchema = z.object({
  weights: z.object({
    queryTransform: z
      .array(z.array(z.number()).length(EMBEDDING_DIMENSION))
      .length(EMBEDDING_DIMENSION)
      .refine(validateMatrix1536x1536, {
        message: `queryTransform must be a ${EMBEDDING_DIMENSION}×${EMBEDDING_DIMENSION} matrix`,
      }),
    memoryTransform: z
      .array(z.array(z.number()).length(EMBEDDING_DIMENSION))
      .length(EMBEDDING_DIMENSION)
      .refine(validateMatrix1536x1536, {
        message: `memoryTransform must be a ${EMBEDDING_DIMENSION}×${EMBEDDING_DIMENSION} matrix`,
      }),
  }),
  config: z.object({
    topK: z.number().int().positive().default(RERANKER_CONFIG_DEFAULTS.topK),
    topM: z.number().int().positive().default(RERANKER_CONFIG_DEFAULTS.topM),
    temperature: z
      .number()
      .positive()
      .default(RERANKER_CONFIG_DEFAULTS.temperature),
    learningRate: z
      .number()
      .positive()
      .default(RERANKER_CONFIG_DEFAULTS.learningRate),
    baseline: z.number().default(RERANKER_CONFIG_DEFAULTS.baseline),
  }),
});

export type RerankerState = z.infer<typeof RerankerStateSchema>;

// ============================================================================
// CitationRecord Schema
// ============================================================================

/**
 * Evidence of memory utility for RL reward
 * Reward: +1 (useful) or -1 (not useful)
 */
export const CitationRecordSchema = z.object({
  memoryId: z.string(),  // Can be UUID or memory ID like "memory-{index}"
  cited: z.boolean(),
  reward: z.union([z.literal(1), z.literal(-1)]),
  turnIndex: z.number().int().nonnegative(),
});

export type CitationRecord = z.infer<typeof CitationRecordSchema>;

// ============================================================================
// RMMState Schema (with private fields)
// ============================================================================

/**
 * LangChain BaseMessage schema (simplified for state definition)
 */
export const BaseMessageSchema = z.object({
  type: z.string(),
  content: z.union([z.string(), z.array(z.any())]),
});

export type BaseMessage = z.infer<typeof BaseMessageSchema>;

/**
 * RMM state with private fields (underscore prefix convention)
 * Private fields are persisted but filtered from public types
 */
export const RMMStateSchema = z.object({
  // Private fields - persisted but filtered from public types
  _sessionStartIndex: z.number().int().nonnegative(),
  _turnCountInSession: z.number().int().nonnegative(),
  _citations: z.array(CitationRecordSchema),
  _retrievedMemories: z.array(RetrievedMemorySchema),
  _rerankerWeights: RerankerStateSchema,

  // Standard LangChain state
  messages: z.array(BaseMessageSchema),
});

export type RMMState = z.infer<typeof RMMStateSchema>;

// ============================================================================
// Context Schema
// ============================================================================

/**
 * Runtime context for RMM middleware
 */
export const ContextSchema = z.object({
  userId: z.string().min(1),
  isSessionEnd: z.boolean(),
  store: z.any(), // BaseStore instance - validated at runtime
});

export type Context = z.infer<typeof ContextSchema>;

// ============================================================================
// MiddlewareOptions Schema
// ============================================================================

/**
 * Configuration options for RMM middleware factory
 */
export const MiddlewareOptionsSchema = z.object({
  userId: z.string().min(1),
  vectorStore: z.any(), // VectorStore instance - validated at runtime
  embeddings: z.any(), // Embeddings instance - validated at runtime
  store: z.any(), // BaseStore instance - validated at runtime
  summarizationModel: z.any(), // Language model instance - validated at runtime
});

export type MiddlewareOptions = z.infer<typeof MiddlewareOptionsSchema>;

// ============================================================================
// MemoryExtractionOutput Schema
// ============================================================================

/**
 * Schema for LLM memory extraction output
 * JSON response from extraction prompt
 */
export const MemoryExtractionOutputSchema = z.object({
  topicSummary: z.string().min(1),
  rawDialogue: z.string().min(1),
  turnReferences: z.array(z.number().int().nonnegative()),
});

export type MemoryExtractionOutput = z.infer<
  typeof MemoryExtractionOutputSchema
>;

// ============================================================================
// MergeDecision Schema
// ============================================================================

/**
 * Decision type for memory update: merge with existing or add as new
 */
export const MergeDecisionTypeSchema = z.union([
  z.literal("MERGE"),
  z.literal("ADD"),
]);

export type MergeDecisionType = z.infer<typeof MergeDecisionTypeSchema>;

/**
 * Schema for merge/add decision output from LLM
 */
export const MergeDecisionSchema = z
  .object({
    decision: MergeDecisionTypeSchema,
    targetMemoryId: z.string().uuid().optional(),
    reason: z.string().min(1, { message: "Reason cannot be empty." }),
  })
  .superRefine((data, ctx) => {
    if (data.decision === "MERGE" && !data.targetMemoryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetMemoryId is required when decision is MERGE.",
        path: ["targetMemoryId"],
      });
    }
    if (data.decision === "ADD" && data.targetMemoryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetMemoryId must not be provided when decision is ADD.",
        path: ["targetMemoryId"],
      });
    }
  });

export type MergeDecision = z.infer<typeof MergeDecisionSchema>;

// ============================================================================
// SessionMetadata Schema
// ============================================================================

/**
 * Schema for session metadata persisted to BaseStore
 * Tracks version, config hash, and session statistics
 */
export const SessionMetadataSchema = z.object({
  version: z.string().min(1), // RMM schema version
  configHash: z.string().min(1), // Hash of reranker config
  sessionCount: z.number().int().nonnegative(), // Total sessions processed
  lastUpdated: z.number().int().positive(), // Unix timestamp
});

export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validates that an embedding vector has the correct dimension
 */
export function validateEmbeddingDimension(embedding: number[]): boolean {
  return embedding.length === EMBEDDING_DIMENSION;
}

/**
 * Creates a default reranker state with zero-initialized matrices
 *
 * ⚠️ WARNING: This function is intended for testing purposes only.
 * For production use, matrices should be initialized with small random values
 * per paper recommendation: W_q[i][j] ~ N(0, 0.01), W_m[i][j] ~ N(0, 0.01)
 *
 * Zero initialization may cause:
 * - Gradient vanishing during initial training phases
 * - Symmetry problems in learned representations
 */
export function createDefaultRerankerState(): RerankerState {
  const createZeroMatrix = (): number[][] =>
    Array.from({ length: EMBEDDING_DIMENSION }, () =>
      Array.from({ length: EMBEDDING_DIMENSION }, () => 0)
    );

  return {
    weights: {
      queryTransform: createZeroMatrix(),
      memoryTransform: createZeroMatrix(),
    },
    config: {
      topK: RERANKER_CONFIG_DEFAULTS.topK,
      topM: RERANKER_CONFIG_DEFAULTS.topM,
      temperature: RERANKER_CONFIG_DEFAULTS.temperature,
      learningRate: RERANKER_CONFIG_DEFAULTS.learningRate,
      baseline: RERANKER_CONFIG_DEFAULTS.baseline,
    },
  };
}
