import type { StoredMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createZeroMatrix } from "@/utils/matrix";

// ============================================================================
// Constants
// ============================================================================

/**
 * Default embedding dimension for OpenAI ada-002 embeddings (1536 dimensions).
 *
 * Note: This is hardcoded based on the paper and common embedding models.
 * For different embedding models, this should be updated to match the model's
 * output dimension. Making this fully configurable would require:
 * - Adding embeddingDimension option to hook configurations
 * - Validating embeddings at runtime against the configured dimension
 * - Updating matrix initialization to use the configured dimension
 *
 * For production use with custom embedding models, consider making this
 * configurable through BeforeAgentOptions.embeddingDimension.
 */
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
  id: z.string().min(1), // Can be UUID or generated ID like "memory-{index}"
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
export const RERANKER_CONFIG_DEFAULTS = {
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
  memoryId: z.string(), // Can be UUID or memory ID like "memory-{index}"
  cited: z.boolean(),
  reward: z.union([z.literal(1), z.literal(-1)]),
  turnIndex: z.number().int().nonnegative(),
});

export type CitationRecord = z.infer<typeof CitationRecordSchema>;

// ============================================================================
// GradientSample Schema (Exact REINFORCE)
// ============================================================================

/**
 * Stores computation state for exact REINFORCE gradient computation.
 * Contains all embeddings and probabilities needed to compute gradients
 * for one turn's reranking decision.
 *
 * For Equation 3: Δφ = η·(R-b)·∇_φ log P(M_M|q, M_K; φ)
 * We need: q, q', m_i, m'_i, P_i, selected indices, R_i
 */
export const GradientSampleSchema = z.object({
  // Query embeddings (1536-dim)
  queryEmbedding: z.array(z.number()).length(EMBEDDING_DIMENSION),
  adaptedQuery: z.array(z.number()).length(EMBEDDING_DIMENSION),

  // Memory embeddings for all K retrieved memories (K × 1536 where K = topK)
  memoryEmbeddings: z.array(z.array(z.number()).length(EMBEDDING_DIMENSION)), // Array of K embeddings, each 1536-dim

  // Adapted memories (K × 1536)
  adaptedMemories: z.array(z.array(z.number()).length(EMBEDDING_DIMENSION)), // Array of K embeddings, each 1536-dim

  // Gumbel-Softmax sampling probabilities for all K memories (K probabilities)
  samplingProbabilities: z.array(z.number().min(0).max(1)), // Array of K probabilities

  // Indices of Top-M memories selected for LLM context
  selectedIndices: z.array(z.number().int().nonnegative()),

  // Citation rewards (+1 or -1) for all K memories
  // Matches indices in memoryEmbeddings
  citationRewards: z.array(z.union([z.literal(1), z.literal(-1)])), // Array of K rewards

  // Timestamp for this gradient sample
  timestamp: z.number().int().positive(),
});

export type GradientSample = z.infer<typeof GradientSampleSchema>;

// ============================================================================
// GradientAccumulatorState Schema
// ============================================================================

/**
 * State for accumulating gradients across multiple turns (batch size = 4).
 * Persisted to BaseStore for recovery across sessions.
 */
export const GradientAccumulatorStateSchema = z.object({
  // Accumulated gradient samples (max 4 per batch)
  samples: z.array(GradientSampleSchema).max(4),

  // Accumulated gradients for W_q (1536×1536)
  accumulatedGradWq: z
    .array(z.array(z.number()).length(EMBEDDING_DIMENSION))
    .length(EMBEDDING_DIMENSION),

  // Accumulated gradients for W_m (1536×1536)
  accumulatedGradWm: z
    .array(z.array(z.number()).length(EMBEDDING_DIMENSION))
    .length(EMBEDDING_DIMENSION),

  // Whether a batch update was applied (for tracking)
  lastBatchIndex: z.number().int().nonnegative(),

  // Timestamp of last update
  lastUpdated: z.number().int().positive(),

  // Version number for optimistic locking (incremented on each save)
  version: z.number().int().nonnegative().default(0),
});

export type GradientAccumulatorState = z.infer<
  typeof GradientAccumulatorStateSchema
>;

// ============================================================================
// Gradient Utilities
// ============================================================================

/**
 * Creates an empty gradient accumulator state for a new batch.
 * Initializes with zero matrices and empty samples array.
 */
export function createEmptyGradientAccumulatorState(): GradientAccumulatorState {
  return {
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
    version: 0,
  };
}

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
  _gradientAccumulator: z.array(GradientSampleSchema).optional(),

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
// ReflectionConfig Schema
// ============================================================================

/**
 * Schema for prospective reflection trigger configuration.
 * Controls when memory extraction occurs based on turn count and inactivity.
 *
 * Trigger modes:
 * - "relaxed": Reflection triggers when EITHER min threshold is met (OR)
 * - "strict": Reflection triggers only when BOTH min thresholds are met (AND)
 *
 * Max thresholds act as "force" triggers - reflection happens regardless of
 * the other condition when max is reached.
 */
export const ReflectionConfigSchema = z
  .object({
    /** Minimum turns before reflection is eligible */
    minTurns: z.number().int().positive().default(2),
    /** Maximum turns before reflection is forced (regardless of inactivity) */
    maxTurns: z.number().int().positive().default(50),
    /** Minimum inactivity time in milliseconds before reflection is eligible (default: 10 minutes) */
    minInactivityMs: z.number().int().positive().default(600_000),
    /** Maximum inactivity time in milliseconds before reflection is forced (default: 30 minutes) */
    maxInactivityMs: z.number().int().positive().default(1_800_000),
    /** Trigger mode: "relaxed" (OR logic) or "strict" (AND logic) */
    mode: z
      .union([z.literal("relaxed"), z.literal("strict")])
      .default("strict"),
    /** Maximum retry attempts for failed reflection (default: 3) */
    maxRetries: z.number().int().nonnegative().default(3),
    /** Base delay in milliseconds between retries (default: 1000) */
    retryDelayMs: z.number().int().positive().default(1000),
  })
  .refine((val) => val.maxTurns >= val.minTurns, {
    message: "maxTurns must be >= minTurns",
    path: ["maxTurns"],
  })
  .refine((val) => val.maxInactivityMs >= val.minInactivityMs, {
    message: "maxInactivityMs must be >= minInactivityMs",
    path: ["maxInactivityMs"],
  });

export type ReflectionConfig = z.infer<typeof ReflectionConfigSchema>;

/**
 * Default reflection configuration with paper-aligned values.
 * Uses strict mode requiring both sufficient turns AND inactivity period.
 */
export const DEFAULT_REFLECTION_CONFIG: ReflectionConfig = {
  minTurns: 2,
  maxTurns: 50,
  minInactivityMs: 600_000, // 10 minutes
  maxInactivityMs: 1_800_000, // 30 minutes
  mode: "strict",
  maxRetries: 3,
  retryDelayMs: 1000,
} as const;

// ============================================================================
// MessageBuffer Schema
// ============================================================================

/**
 * Schema for a serialized LangChain message (StoredMessage format).
 * Uses LangChain's canonical serialization format for BaseMessage.
 */
export const SerializedMessageSchema = z
  .object({
    /** LangChain serialized type identifier (lc format) */
    lc_serialized: z
      .object({
        type: z.string(),
      })
      .optional(),
    /** LangChain internal ID array */
    lc_id: z.array(z.string()).optional(),
    /** Message type identifier (legacy format) */
    type: z.string().optional(),
    /** Message content */
    content: z.union([z.string(), z.array(z.unknown()), z.unknown()]),
    /** Additional kwargs */
    additional_kwargs: z.record(z.string(), z.unknown()).optional(),
    /** Message name */
    name: z.string().optional(),
    /** Message ID */
    id: z.string().optional(),
    /** Response metadata */
    response_metadata: z.record(z.string(), z.unknown()).optional(),
    /** Usage metadata */
    usage_metadata: z.record(z.string(), z.number()).optional(),
  })
  .refine(
    (val) => {
      // Must have at least one type identifier
      return (
        val.lc_serialized !== undefined ||
        val.lc_id !== undefined ||
        val.type !== undefined
      );
    },
    {
      message:
        "Message must have at least one type identifier (lc_serialized, lc_id, or type)",
      path: ["type"],
    }
  );

/**
 * Type representing a serialized message in the buffer.
 * Matches LangChain's StoredMessage format.
 */
export type SerializedMessage = StoredMessage;

/**
 * Schema for the persisted message buffer in BaseStore.
 * Stores messages across threads for batched prospective reflection.
 *
 * Note: messages are stored as StoredMessage[] (plain objects), matching
 * LangChain's serialization format. No conversion needed at storage boundary.
 *
 * Inactivity is tracked via BaseStore's updated_at timestamp, not within the buffer itself.
 * This ensures that appending messages doesn't reset the inactivity clock.
 */
export const MessageBufferSchema = z.object({
  /** Array of serialized messages waiting for reflection */
  messages: z.array(SerializedMessageSchema),
  /** Count of human messages in the buffer (for quick threshold checks) */
  humanMessageCount: z.number().int().nonnegative(),
  /** Timestamp of the last message added to the buffer */
  lastMessageTimestamp: z.number().int().positive(),
  /** Timestamp when buffer was created */
  createdAt: z.number().int().positive(),
  /** Number of reflection retry attempts (for staging buffer) */
  retryCount: z.number().int().nonnegative().optional(),
});

/**
 * Message buffer for cross-thread message persistence.
 * Uses StoredMessage[] (plain objects) matching LangChain's serialization format.
 *
 * Note: Messages stay as StoredMessage[] throughout - no conversion at storage boundary.
 * Inactivity is tracked via BaseStore's updated_at timestamp externally.
 */
export interface MessageBuffer {
  messages: StoredMessage[];
  humanMessageCount: number;
  lastMessageTimestamp: number;
  createdAt: number;
  /** Number of reflection retry attempts (for staging buffer) */
  retryCount?: number;
}

/**
 * Creates an empty message buffer for initialization.
 */
export function createEmptyMessageBuffer(): MessageBuffer {
  const now = Date.now();
  return {
    messages: [],
    humanMessageCount: 0,
    lastMessageTimestamp: now,
    createdAt: now,
  };
}

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
