import type { StoredMessage } from "@langchain/core/messages";
import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { createZeroMatrix } from "@/utils/matrix";

// ============================================================================
// Constants
// ============================================================================

/**
 * Default embedding dimension for OpenAI ada-002 embeddings (1536 dimensions).
 *
 * This constant serves as the default value for embedding dimension validation.
 * Factory functions accept custom dimensions for different embedding models:
 * - OpenAI ada-002: 1536 dimensions
 * - Contriever: 768 dimensions
 * - Stella: 1536 dimensions
 * - Cohere: 1024 dimensions
 */
export const DEFAULT_EMBEDDING_DIMENSION = 1536;

/**
 * Backwards compatibility alias for DEFAULT_EMBEDDING_DIMENSION
 * @deprecated Use DEFAULT_EMBEDDING_DIMENSION instead
 */
export const EMBEDDING_DIMENSION = DEFAULT_EMBEDDING_DIMENSION;

// ============================================================================
// MemoryEntry Schema
// ============================================================================

/**
 * Creates a MemoryEntrySchema with configurable embedding dimension
 */
export function createMemoryEntrySchema(
  embeddingDimension = DEFAULT_EMBEDDING_DIMENSION
) {
  return z.object({
    id: z.string().uuid(),
    topicSummary: z.string().min(1),
    rawDialogue: z.string().min(1),
    timestamp: z.number().int().positive(),
    sessionId: z.string().min(1),
    embedding: z.array(z.number()).length(embeddingDimension),
    turnReferences: z.array(z.number().int().nonnegative()),
  });
}

/**
 * Core memory unit stored in memory bank
 */
export const MemoryEntrySchema = createMemoryEntrySchema();

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

// ============================================================================
// RetrievedMemory Schema
// ============================================================================

/**
 * Base schema for retrieved memory (without embedding)
 */
const RetrievedMemoryBaseSchema = z.object({
  id: z.string().min(1),
  topicSummary: z.string().min(1),
  rawDialogue: z.string().min(1),
  timestamp: z.number().int().positive(),
  sessionId: z.string().min(1),
  turnReferences: z.array(z.number().int().nonnegative()),
});

/**
 * Creates a RetrievedMemorySchema with configurable embedding dimension
 */
export function createRetrievedMemorySchema(
  embeddingDimension = DEFAULT_EMBEDDING_DIMENSION
) {
  return RetrievedMemoryBaseSchema.extend({
    embedding: z.array(z.number()).length(embeddingDimension).optional(),
    relevanceScore: z.number(),
    rerankScore: z.number().optional(),
  });
}

/**
 * Retrieved memory with relevance scores.
 * Note: embedding is optional since VectorStore.similaritySearch doesn't return embeddings.
 * We use a separate base to avoid field duplication while making embedding optional.
 */
export const RetrievedMemorySchema = createRetrievedMemorySchema();

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
 * Validates that a matrix is square with specified dimension
 */
const validateMatrixDimensions =
  (dimension: number) =>
  (matrix: number[][]): boolean => {
    if (matrix.length !== dimension) {
      return false;
    }
    return matrix.every((row) => row.length === dimension);
  };

/**
 * Creates a RerankerStateSchema with configurable embedding dimension
 */
export function createRerankerStateSchema(
  embeddingDimension = DEFAULT_EMBEDDING_DIMENSION
) {
  const validateMatrix = validateMatrixDimensions(embeddingDimension);

  return z.object({
    weights: z.object({
      queryTransform: z
        .array(z.array(z.number()).length(embeddingDimension))
        .length(embeddingDimension)
        .refine(validateMatrix, {
          message: `queryTransform must be a ${embeddingDimension}×${embeddingDimension} matrix`,
        }),
      memoryTransform: z
        .array(z.array(z.number()).length(embeddingDimension))
        .length(embeddingDimension)
        .refine(validateMatrix, {
          message: `memoryTransform must be a ${embeddingDimension}×${embeddingDimension} matrix`,
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
}

/**
 * Learnable reranker state with transformation matrices
 * Architecture: Two linear matrices (1536×1536) for query and memory transformation
 * Memory: 2 × (1536 × 1536) floats ≈ 18MB total
 */
export const RerankerStateSchema = createRerankerStateSchema();

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
 * Creates a GradientSampleSchema with configurable embedding dimension
 */
export function createGradientSampleSchema(
  embeddingDimension = DEFAULT_EMBEDDING_DIMENSION
) {
  return z.object({
    // Query embeddings
    queryEmbedding: z.array(z.number()).length(embeddingDimension),
    adaptedQuery: z.array(z.number()).length(embeddingDimension),

    // Memory embeddings for all K retrieved memories (K × dim where K = topK)
    memoryEmbeddings: z.array(z.array(z.number()).length(embeddingDimension)),

    // Adapted memories (K × dim)
    adaptedMemories: z.array(z.array(z.number()).length(embeddingDimension)),

    // Gumbel-Softmax sampling probabilities for all K memories (K probabilities)
    samplingProbabilities: z.array(z.number().min(0).max(1)),

    // Indices of Top-M memories selected for LLM context
    selectedIndices: z.array(z.number().int().nonnegative()),

    // Citation rewards (+1 or -1) for all K memories
    citationRewards: z.array(z.union([z.literal(1), z.literal(-1)])),

    // Timestamp for this gradient sample
    timestamp: z.number().int().positive(),
  });
}

/**
 * Stores computation state for exact REINFORCE gradient computation.
 * Contains all embeddings and probabilities needed to compute gradients
 * for one turn's reranking decision.
 *
 * For Equation 3: Δφ = η·(R-b)·∇_φ log P(M_M|q, M_K; φ)
 * We need: q, q', m_i, m'_i, P_i, selected indices, R_i
 */
export const GradientSampleSchema = createGradientSampleSchema();

export type GradientSample = z.infer<typeof GradientSampleSchema>;

// ============================================================================
// GradientAccumulatorState Schema
// ============================================================================

/**
 * Creates a GradientAccumulatorStateSchema with configurable embedding dimension
 */
export function createGradientAccumulatorStateSchema(
  embeddingDimension = DEFAULT_EMBEDDING_DIMENSION
) {
  const gradientSampleSchema = createGradientSampleSchema(embeddingDimension);

  return z.object({
    // Accumulated gradient samples (max 4 per batch)
    samples: z.array(gradientSampleSchema).max(4),

    // Accumulated gradients for W_q (dim×dim)
    accumulatedGradWq: z
      .array(z.array(z.number()).length(embeddingDimension))
      .length(embeddingDimension),

    // Accumulated gradients for W_m (dim×dim)
    accumulatedGradWm: z
      .array(z.array(z.number()).length(embeddingDimension))
      .length(embeddingDimension),

    // Whether a batch update was applied (for tracking)
    lastBatchIndex: z.number().int().nonnegative(),

    // Timestamp of last update
    lastUpdated: z.number().int().positive(),

    // Version number for optimistic locking (incremented on each save)
    version: z.number().int().nonnegative().default(0),
  });
}

/**
 * State for accumulating gradients across multiple turns (batch size = 4).
 * Persisted to BaseStore for recovery across sessions.
 */
export const GradientAccumulatorStateSchema =
  createGradientAccumulatorStateSchema();

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
export function createEmptyGradientAccumulatorState(
  embeddingDimension = DEFAULT_EMBEDDING_DIMENSION
) {
  return {
    samples: [],
    accumulatedGradWq: createZeroMatrix(embeddingDimension, embeddingDimension),
    accumulatedGradWm: createZeroMatrix(embeddingDimension, embeddingDimension),
    lastBatchIndex: 0,
    lastUpdated: Date.now(),
    version: 0,
  };
}

// ============================================================================
// RMMState Schema (with private fields)
// ============================================================================

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
  _gradientAccumulator: GradientAccumulatorStateSchema.optional(),

  // Standard LangChain state - messages are BaseMessage[] at runtime
  messages: z.array(z.any()),
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
 * For runtime validation, use parseStoredMessage() from validation.ts instead.
 */
export const SerializedMessageSchema = z.unknown();

/**
 * Schema for the persisted message buffer in BaseStore.
 * For runtime validation, use parseMessageBuffer() from validation.ts instead.
 * Supports ContentBlock[] content (LangChain v1 format).
 */
export const MessageBufferSchema = z.unknown();

/**
 * Message buffer for cross-thread message persistence.
 * Uses StoredMessage[] (LangChain's serialization format).
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
export function validateEmbeddingDimension(
  embedding: number[],
  expectedDimension = DEFAULT_EMBEDDING_DIMENSION
): boolean {
  return embedding.length === expectedDimension;
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
export function createDefaultRerankerState(
  embeddingDimension = DEFAULT_EMBEDDING_DIMENSION
): RerankerState {
  return {
    weights: {
      queryTransform: createZeroMatrix(embeddingDimension, embeddingDimension),
      memoryTransform: createZeroMatrix(embeddingDimension, embeddingDimension),
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

// ============================================================================
// RmmMiddlewareState - Extended State for Hooks
// ============================================================================

/**
 * Runtime context for RMM middleware hooks.
 *
 * This interface defines all properties that can be present in the runtime
 * context when accessing via runtime.context in middleware hooks.
 *
 * Properties can come from:
 * - User-provided context (passed via agent.invoke({ context: {...} }))
 * - Internal RMM context set by other hooks (e.g., _citations set by beforeModel)
 */
export interface RmmRuntimeContext {
  /** User ID for memory and weight persistence */
  userId?: string;
  /** Session ID for tracking conversation sessions */
  sessionId?: string;
  /** Whether this is the end of a session */
  isSessionEnd?: boolean;

  // Internal RMM context set by hooks
  /** Citation records extracted from LLM response (set by beforeModel) */
  _citations?: CitationRecord[];
  /** Original query embedding before reranking */
  _originalQuery?: number[];
  /** Adapted query embedding after reranking */
  _adaptedQuery?: number[];
  /** Memory embeddings before reranking */
  _originalMemoryEmbeddings?: number[][];
  /** Memory embeddings after reranking */
  _adaptedMemoryEmbeddings?: number[][];
  /** Gumbel-Softmax sampling probabilities */
  _samplingProbabilities?: number[];
  /** Indices of selected memories */
  _selectedIndices?: number[];
}

/**
 * RMM-specific middleware state properties.
 *
 * This interface defines RMM-specific fields that are added to the base
 * LangChain state (messages). Use it combined with { messages: BaseMessage[] }
 * in middleware hooks: `RmmMiddlewareState & { messages: BaseMessage[] }`
 *
 * Note: This type is used in middleware hooks to provide proper type inference
 * for state parameters.
 */
export interface RmmMiddlewareState {
  /** Learned reranker weights (W_q, W_m transformation matrices) */
  _rerankerWeights: RerankerState;
  /** Memories retrieved from vector store for current query */
  _retrievedMemories?: RetrievedMemory[];
  /** Citation records for REINFORCE gradient computation */
  _citations?: CitationRecord[];
  /** Number of turns in current session (for reflection triggers) */
  _turnCountInSession?: number;
  /** Persisted message buffer for prospective reflection */
  _messageBuffer?: MessageBuffer;
  /** Gradient accumulator for batched REINFORCE updates */
  _gradientAccumulator?: GradientAccumulatorState;
}

// ============================================================================
// RMM Middleware State Schema (for createMiddleware)
// ============================================================================

/**
 * LangChain StateSchema for RMM middleware state.
 * Used with createMiddleware to provide proper type inference.
 *
 * Note: The messages field is handled by LangChain's AgentBuiltInState.
 * This schema defines only the RMM-specific fields.
 *
 * @example
 * import { createMiddleware } from "langchain";
 * import { rmmMiddlewareStateSchema } from "./schemas";
 *
 * const middleware = createMiddleware({
 *   stateSchema: rmmMiddlewareStateSchema,
 *   // ... hooks
 * });
 */
export const rmmMiddlewareStateSchema = new StateSchema({
  _rerankerWeights: RerankerStateSchema,
  _retrievedMemories: z.array(RetrievedMemorySchema).optional(),
  _citations: z.array(CitationRecordSchema).optional(),
  _turnCountInSession: z.number().int().nonnegative().optional(),
  _messageBuffer: MessageBufferSchema.optional(),
  _gradientAccumulator: GradientAccumulatorStateSchema.optional(),
});

/**
 * Zod schema for RMM middleware state (for validation).
 * @deprecated Use rmmMiddlewareStateSchema (StateSchema) for LangChain integration.
 * This Zod schema is kept for backwards compatibility and input validation.
 */
export const rmmMiddlewareStateSchemaZod = z.object({
  _rerankerWeights: RerankerStateSchema,
  _retrievedMemories: z.array(RetrievedMemorySchema).optional(),
  _citations: z.array(CitationRecordSchema).optional(),
  _turnCountInSession: z.number().int().nonnegative().optional(),
  _messageBuffer: MessageBufferSchema.optional(),
  _gradientAccumulator: GradientAccumulatorStateSchema.optional(),
});

/**
 * Type inferred from the RMM middleware state schema (input/validation type)
 */
export type RmmMiddlewareStateInput = z.input<
  typeof rmmMiddlewareStateSchemaZod
>;
