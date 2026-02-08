import { describe, expect, test } from "bun:test";
import {
  type CitationRecord,
  CitationRecordSchema,
  type Context,
  ContextSchema,
  createDefaultRerankerState,
  createGradientAccumulatorStateSchema,
  createGradientSampleSchema,
  createMemoryEntrySchema,
  createRetrievedMemorySchema,
  createRerankerStateSchema,
  type MemoryEntry,
  MemoryEntrySchema,
  MemoryExtractionOutputSchema,
  MergeDecisionSchema,
  type MiddlewareOptions,
  MiddlewareOptionsSchema,
  type ReflectionConfig,
  ReflectionConfigSchema,
  type RerankerState,
  RerankerStateSchema,
  type RetrievedMemory,
  RetrievedMemorySchema,
  type RMMState,
  RMMStateSchema,
  validateEmbeddingDimension,
  DEFAULT_EMBEDDING_DIMENSION,
} from "@/schemas";
import { rmmConfigSchema } from "@/schemas/config";

// ============================================================================
// Test Helpers
// ============================================================================

const createValidEmbedding = (): number[] =>
  Array.from({ length: DEFAULT_EMBEDDING_DIMENSION }, () => Math.random());

const createValidMatrix = (): number[][] =>
  Array.from({ length: DEFAULT_EMBEDDING_DIMENSION }, () =>
    Array.from(
      { length: DEFAULT_EMBEDDING_DIMENSION },
      () => Math.random() * 0.02 - 0.01
    )
  );

const createValidMemoryEntry = (): MemoryEntry => ({
  id: "550e8400-e29b-41d4-a716-446655440000",
  topicSummary: "User enjoys hiking",
  rawDialogue: "I love hiking on weekends",
  timestamp: Date.now(),
  sessionId: "session-123",
  embedding: createValidEmbedding(),
  turnReferences: [0, 2],
});

const createValidRerankerState = (): RerankerState => ({
  weights: {
    queryTransform: createValidMatrix(),
    memoryTransform: createValidMatrix(),
  },
  config: {
    topK: 20,
    topM: 5,
    temperature: 0.5,
    learningRate: 0.001,
    baseline: 0.5,
  },
});

const createValidCitationRecord = (): CitationRecord => ({
  memoryId: "550e8400-e29b-41d4-a716-446655440000",
  cited: true,
  reward: 1,
  turnIndex: 5,
});

const createValidRetrievedMemory = (): RetrievedMemory => ({
  ...createValidMemoryEntry(),
  relevanceScore: 0.85,
  rerankScore: 0.92,
});

const createValidRMMState = (): RMMState => ({
  _sessionStartIndex: 0,
  _turnCountInSession: 10,
  _citations: [createValidCitationRecord()],
  _retrievedMemories: [createValidRetrievedMemory()],
  _rerankerWeights: createValidRerankerState(),
  messages: [{ type: "human", content: "Hello" }],
});

// ============================================================================
// MemoryEntry Schema Tests
// ============================================================================

describe("MemoryEntrySchema", () => {
  test("validates correct memory entry", () => {
    const validEntry = createValidMemoryEntry();
    const result = MemoryEntrySchema.safeParse(validEntry);
    expect(result.success).toBe(true);
  });

  test("rejects invalid UUID", () => {
    const invalidEntry = { ...createValidMemoryEntry(), id: "not-a-uuid" };
    const result = MemoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  test("rejects empty topicSummary", () => {
    const invalidEntry = { ...createValidMemoryEntry(), topicSummary: "" };
    const result = MemoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  test("rejects wrong embedding dimension", () => {
    const invalidEntry = {
      ...createValidMemoryEntry(),
      embedding: Array.from({ length: 768 }, () => 0),
    };
    const result = MemoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  test("rejects negative timestamp", () => {
    const invalidEntry = { ...createValidMemoryEntry(), timestamp: -1 };
    const result = MemoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  test("rejects negative turn references", () => {
    const invalidEntry = {
      ...createValidMemoryEntry(),
      turnReferences: [-1, 2],
    };
    const result = MemoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  test("rejects empty rawDialogue", () => {
    const invalidEntry = {
      ...createValidMemoryEntry(),
      rawDialogue: "",
    };
    const result = MemoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  test("validates with empty turnReferences array", () => {
    const validEntry = { ...createValidMemoryEntry(), turnReferences: [] };
    const result = MemoryEntrySchema.safeParse(validEntry);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// RetrievedMemory Schema Tests
// ============================================================================

describe("RetrievedMemorySchema", () => {
  test("validates correct retrieved memory", () => {
    const validMemory = createValidRetrievedMemory();
    const result = RetrievedMemorySchema.safeParse(validMemory);
    expect(result.success).toBe(true);
  });

  test("validates without optional rerankScore", () => {
    const validMemory = { ...createValidRetrievedMemory() };
    validMemory.rerankScore = undefined;
    const result = RetrievedMemorySchema.safeParse(validMemory);
    expect(result.success).toBe(true);
  });

  test("inherits MemoryEntry validations", () => {
    const invalidMemory = {
      ...createValidRetrievedMemory(),
      topicSummary: "", // Empty topicSummary should fail validation
    };
    const result = RetrievedMemorySchema.safeParse(invalidMemory);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// RerankerState Schema Tests
// ============================================================================

describe("RerankerStateSchema", () => {
  test("validates correct reranker state", () => {
    const validState = createValidRerankerState();
    const result = RerankerStateSchema.safeParse(validState);
    expect(result.success).toBe(true);
  });

  test("rejects invalid queryTransform matrix dimensions", () => {
    const invalidState = {
      ...createValidRerankerState(),
      weights: {
        queryTransform: Array.from({ length: 768 }, () =>
          Array.from({ length: 768 }, () => 0)
        ),
        memoryTransform: createValidMatrix(),
      },
    };
    const result = RerankerStateSchema.safeParse(invalidState);
    expect(result.success).toBe(false);
  });

  test("rejects invalid memoryTransform matrix dimensions", () => {
    const invalidState = {
      ...createValidRerankerState(),
      weights: {
        queryTransform: createValidMatrix(),
        memoryTransform: Array.from({ length: 1536 }, () =>
          Array.from({ length: 768 }, () => 0)
        ),
      },
    };
    const result = RerankerStateSchema.safeParse(invalidState);
    expect(result.success).toBe(false);
  });

  test("rejects non-integer topK", () => {
    const invalidState = {
      ...createValidRerankerState(),
      config: { ...createValidRerankerState().config, topK: 20.5 },
    };
    const result = RerankerStateSchema.safeParse(invalidState);
    expect(result.success).toBe(false);
  });

  test("rejects zero temperature", () => {
    const invalidState = {
      ...createValidRerankerState(),
      config: { ...createValidRerankerState().config, temperature: 0 },
    };
    const result = RerankerStateSchema.safeParse(invalidState);
    expect(result.success).toBe(false);
  });

  test("applies default values for config", () => {
    const partialState = {
      weights: {
        queryTransform: createValidMatrix(),
        memoryTransform: createValidMatrix(),
      },
      config: {},
    };
    const result = RerankerStateSchema.safeParse(partialState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config.topK).toBe(20);
      expect(result.data.config.topM).toBe(5);
      expect(result.data.config.temperature).toBe(0.5);
      expect(result.data.config.learningRate).toBe(0.001);
      expect(result.data.config.baseline).toBe(0.5);
    }
  });
});

// ============================================================================
// RmmConfig Schema Tests
// ============================================================================

describe("rmmConfigSchema", () => {
  test("accepts topM values greater than 10 (paper Table 5)", () => {
    const result = rmmConfigSchema.safeParse({ topM: 15 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topM).toBe(15);
    }
  });

  test("accepts topM of 20 matching topK default", () => {
    const result = rmmConfigSchema.safeParse({ topM: 20 });
    expect(result.success).toBe(true);
  });

  test("rejects topM of 0", () => {
    const result = rmmConfigSchema.safeParse({ topM: 0 });
    expect(result.success).toBe(false);
  });

  test("rejects negative topM", () => {
    const result = rmmConfigSchema.safeParse({ topM: -1 });
    expect(result.success).toBe(false);
  });

  test("defaults topM to 5", () => {
    const result = rmmConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topM).toBe(5);
    }
  });
});

// ============================================================================
// CitationRecord Schema Tests
// ============================================================================

describe("CitationRecordSchema", () => {
  test("validates correct citation record with positive reward", () => {
    const validRecord = createValidCitationRecord();
    const result = CitationRecordSchema.safeParse(validRecord);
    expect(result.success).toBe(true);
  });

  test("validates correct citation record with negative reward", () => {
    const validRecord = { ...createValidCitationRecord(), reward: -1 as const };
    const result = CitationRecordSchema.safeParse(validRecord);
    expect(result.success).toBe(true);
  });

  test("rejects invalid reward value", () => {
    const invalidRecord = { ...createValidCitationRecord(), reward: 0 };
    const result = CitationRecordSchema.safeParse(invalidRecord);
    expect(result.success).toBe(false);
  });

  test("rejects negative turn index", () => {
    const invalidRecord = { ...createValidCitationRecord(), turnIndex: -1 };
    const result = CitationRecordSchema.safeParse(invalidRecord);
    expect(result.success).toBe(false);
  });

  test("rejects invalid reward value", () => {
    const invalidRecord = {
      ...createValidCitationRecord(),
      reward: 0, // Reward must be +1 or -1
    };
    const result = CitationRecordSchema.safeParse(invalidRecord);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// RMMState Schema Tests
// ============================================================================

describe("RMMStateSchema", () => {
  test("validates correct RMM state", () => {
    const validState = createValidRMMState();
    const result = RMMStateSchema.safeParse(validState);
    expect(result.success).toBe(true);
  });

  test("validates private fields with underscore prefix", () => {
    const validState = createValidRMMState();
    expect(validState._sessionStartIndex).toBe(0);
    expect(validState._turnCountInSession).toBe(10);
    expect(validState._citations.length).toBe(1);
    expect(validState._retrievedMemories.length).toBe(1);
    expect(validState._rerankerWeights).toBeDefined();
  });

  test("rejects negative _sessionStartIndex", () => {
    const invalidState = { ...createValidRMMState(), _sessionStartIndex: -1 };
    const result = RMMStateSchema.safeParse(invalidState);
    expect(result.success).toBe(false);
  });

  test("rejects negative _turnCountInSession", () => {
    const invalidState = { ...createValidRMMState(), _turnCountInSession: -1 };
    const result = RMMStateSchema.safeParse(invalidState);
    expect(result.success).toBe(false);
  });

  test("validates empty private arrays", () => {
    const validState = {
      ...createValidRMMState(),
      _citations: [],
      _retrievedMemories: [],
    };
    const result = RMMStateSchema.safeParse(validState);
    expect(result.success).toBe(true);
  });

  test("validates messages array", () => {
    const validState = {
      ...createValidRMMState(),
      messages: [
        { type: "human", content: "Hello" },
        { type: "ai", content: "Hi there!" },
        { type: "tool", content: [{ type: "text", text: "Result" }] },
      ],
    };
    const result = RMMStateSchema.safeParse(validState);
    expect(result.success).toBe(true);
  });

  test("rejects invalid message structure", () => {
    const invalidState = {
      ...createValidRMMState(),
      messages: [{ invalid: "structure" }],
    };
    const result = RMMStateSchema.safeParse(invalidState);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Context Schema Tests
// ============================================================================

describe("ContextSchema", () => {
  test("validates correct context", () => {
    const validContext: Context = {
      userId: "user-123",
      isSessionEnd: false,
      store: { mockStore: true },
    };
    const result = ContextSchema.safeParse(validContext);
    expect(result.success).toBe(true);
  });

  test("rejects empty userId", () => {
    const invalidContext = {
      userId: "",
      isSessionEnd: false,
      store: {},
    };
    const result = ContextSchema.safeParse(invalidContext);
    expect(result.success).toBe(false);
  });

  test("validates with isSessionEnd true", () => {
    const validContext: Context = {
      userId: "user-123",
      isSessionEnd: true,
      store: { mockStore: true },
    };
    const result = ContextSchema.safeParse(validContext);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// MiddlewareOptions Schema Tests
// ============================================================================

describe("MiddlewareOptionsSchema", () => {
  test("validates correct middleware options", () => {
    const validOptions: MiddlewareOptions = {
      userId: "user-123",
      vectorStore: { mockVectorStore: true },
      embeddings: { mockEmbeddings: true },
      store: { mockStore: true },
      summarizationModel: { mockModel: true },
    };
    const result = MiddlewareOptionsSchema.safeParse(validOptions);
    expect(result.success).toBe(true);
  });

  test("rejects empty userId", () => {
    const invalidOptions = {
      userId: "",
      vectorStore: {},
      embeddings: {},
      store: {},
      summarizationModel: {},
    };
    const result = MiddlewareOptionsSchema.safeParse(invalidOptions);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// MemoryExtractionOutput Schema Tests
// ============================================================================

describe("MemoryExtractionOutputSchema", () => {
  test("validates correct extraction output", () => {
    const validOutput = {
      topicSummary: "User enjoys hiking",
      rawDialogue: "I love hiking on weekends",
      turnReferences: [0, 2],
    };
    const result = MemoryExtractionOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  test("rejects empty topicSummary", () => {
    const invalidOutput = {
      topicSummary: "",
      rawDialogue: "I love hiking on weekends",
      turnReferences: [0, 2],
    };
    const result = MemoryExtractionOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  test("rejects negative turnReferences", () => {
    const invalidOutput = {
      topicSummary: "User enjoys hiking",
      rawDialogue: "I love hiking on weekends",
      turnReferences: [-1, 2],
    };
    const result = MemoryExtractionOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  test("rejects empty rawDialogue", () => {
    const invalidOutput = {
      topicSummary: "User enjoys hiking",
      rawDialogue: "",
      turnReferences: [0, 2],
    };
    const result = MemoryExtractionOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// MergeDecision Schema Tests
// ============================================================================

describe("MergeDecisionSchema", () => {
  test("validates MERGE decision with targetMemoryId", () => {
    const validDecision = {
      decision: "MERGE" as const,
      targetMemoryId: "550e8400-e29b-41d4-a716-446655440000",
      reason: "Similar topic to existing memory",
    };
    const result = MergeDecisionSchema.safeParse(validDecision);
    expect(result.success).toBe(true);
  });

  test("validates ADD decision without targetMemoryId", () => {
    const validDecision = {
      decision: "ADD" as const,
      reason: "New unique topic",
    };
    const result = MergeDecisionSchema.safeParse(validDecision);
    expect(result.success).toBe(true);
  });

  test("rejects invalid decision value", () => {
    const invalidDecision = {
      decision: "UPDATE",
      reason: "Invalid decision",
    };
    const result = MergeDecisionSchema.safeParse(invalidDecision);
    expect(result.success).toBe(false);
  });

  test("rejects MERGE without valid targetMemoryId", () => {
    const invalidDecision = {
      decision: "MERGE" as const,
      targetMemoryId: "not-a-uuid",
      reason: "Invalid UUID",
    };
    const result = MergeDecisionSchema.safeParse(invalidDecision);
    expect(result.success).toBe(false);
  });

  test("rejects empty reason", () => {
    const invalidDecision = {
      decision: "ADD" as const,
      reason: "",
    };
    const result = MergeDecisionSchema.safeParse(invalidDecision);
    expect(result.success).toBe(false);
  });

  test("rejects MERGE without targetMemoryId", () => {
    const invalidDecision = {
      decision: "MERGE" as const,
      reason: "Similar topic",
    };
    const result = MergeDecisionSchema.safeParse(invalidDecision);
    expect(result.success).toBe(false);
  });

  test("rejects ADD with targetMemoryId", () => {
    const invalidDecision = {
      decision: "ADD" as const,
      targetMemoryId: "550e8400-e29b-41d4-a716-446655440000",
      reason: "New topic",
    };
    const result = MergeDecisionSchema.safeParse(invalidDecision);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Utility Functions Tests
// ============================================================================

describe("Utility Functions", () => {
  describe("validateEmbeddingDimension", () => {
    test("returns true for valid 1536-dim embedding", () => {
      const embedding = createValidEmbedding();
      expect(validateEmbeddingDimension(embedding)).toBe(true);
    });

    test("returns false for wrong dimension (768)", () => {
      const embedding = Array.from({ length: 768 }, () => 0);
      expect(validateEmbeddingDimension(embedding)).toBe(false);
    });

    test("returns false for empty array", () => {
      expect(validateEmbeddingDimension([])).toBe(false);
    });
  });

  describe("createDefaultRerankerState", () => {
    test("creates state with correct matrix dimensions", () => {
      const state = createDefaultRerankerState();
      expect(state.weights.queryTransform.length).toBe(DEFAULT_EMBEDDING_DIMENSION);
      const queryFirstRow = state.weights.queryTransform[0];
      expect(queryFirstRow).toBeDefined();
      expect(queryFirstRow?.length).toBe(DEFAULT_EMBEDDING_DIMENSION);
      expect(state.weights.memoryTransform.length).toBe(DEFAULT_EMBEDDING_DIMENSION);
      const memoryFirstRow = state.weights.memoryTransform[0];
      expect(memoryFirstRow).toBeDefined();
      expect(memoryFirstRow?.length).toBe(DEFAULT_EMBEDDING_DIMENSION);
    });

    test("creates state with zero-initialized matrices", () => {
      const state = createDefaultRerankerState();
      const allZeros = state.weights.queryTransform.every((row) =>
        row.every((val) => val === 0)
      );
      expect(allZeros).toBe(true);
    });

    test("creates state with default config values", () => {
      const state = createDefaultRerankerState();
      expect(state.config.topK).toBe(20);
      expect(state.config.topM).toBe(5);
      expect(state.config.temperature).toBe(0.5);
      expect(state.config.learningRate).toBe(0.001);
      expect(state.config.baseline).toBe(0.5);
    });

    test("created state passes schema validation", () => {
      const state = createDefaultRerankerState();
      const result = RerankerStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// ReflectionConfig Schema Tests
// ============================================================================

describe("ReflectionConfigSchema", () => {
  test("validates correct reflection config", () => {
    const validConfig: ReflectionConfig = {
      minTurns: 2,
      maxTurns: 50,
      minInactivityMs: 600_000,
      maxInactivityMs: 1_800_000,
      mode: "strict",
    };
    const result = ReflectionConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  test("rejects when maxTurns is less than minTurns", () => {
    const invalidConfig = {
      minTurns: 10,
      maxTurns: 5, // Invalid: max < min
      minInactivityMs: 600_000,
      maxInactivityMs: 1_800_000,
      mode: "strict" as const,
    };
    const result = ReflectionConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  test("rejects when maxInactivityMs is less than minInactivityMs", () => {
    const invalidConfig = {
      minTurns: 2,
      maxTurns: 50,
      minInactivityMs: 1_800_000,
      maxInactivityMs: 600_000, // Invalid: max < min
      mode: "strict" as const,
    };
    const result = ReflectionConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  test("accepts when maxTurns equals minTurns", () => {
    const validConfig = {
      minTurns: 5,
      maxTurns: 5, // Valid: max = min
      minInactivityMs: 600_000,
      maxInactivityMs: 1_800_000,
      mode: "relaxed" as const,
    };
    const result = ReflectionConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  test("accepts when maxInactivityMs equals minInactivityMs", () => {
    const validConfig = {
      minTurns: 2,
      maxTurns: 50,
      minInactivityMs: 1_000_000,
      maxInactivityMs: 1_000_000, // Valid: max = min
      mode: "strict" as const,
    };
    const result = ReflectionConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  test("uses default values when optional fields are omitted", () => {
    const result = ReflectionConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minTurns).toBe(2);
      expect(result.data.maxTurns).toBe(50);
      expect(result.data.mode).toBe("strict");
    }
  });
});

// ============================================================================
// Dynamic Embedding Dimension Tests
// ============================================================================

describe("Dynamic Embedding Dimensions", () => {
  describe("createMemoryEntrySchema", () => {
    test("validates 768-dimension embeddings correctly", () => {
      const schema = createMemoryEntrySchema(768);
      const validEntry = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        topicSummary: "Test memory",
        rawDialogue: "Test dialogue",
        timestamp: Date.now(),
        sessionId: "session-123",
        embedding: Array.from({ length: 768 }, () => Math.random()),
        turnReferences: [0, 1, 2],
      };
      const result = schema.safeParse(validEntry);
      expect(result.success).toBe(true);
    });

    test("rejects 1536-dimension embeddings when 768 is expected", () => {
      const schema = createMemoryEntrySchema(768);
      const invalidEntry = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        topicSummary: "Test memory",
        rawDialogue: "Test dialogue",
        timestamp: Date.now(),
        sessionId: "session-123",
        embedding: Array.from({ length: 1536 }, () => Math.random()),
        turnReferences: [0, 1, 2],
      };
      const result = schema.safeParse(invalidEntry);
      expect(result.success).toBe(false);
    });

    test("rejects 1024-dimension embeddings when 768 is expected", () => {
      const schema = createMemoryEntrySchema(768);
      const invalidEntry = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        topicSummary: "Test memory",
        rawDialogue: "Test dialogue",
        timestamp: Date.now(),
        sessionId: "session-123",
        embedding: Array.from({ length: 1024 }, () => Math.random()),
        turnReferences: [0, 1, 2],
      };
      const result = schema.safeParse(invalidEntry);
      expect(result.success).toBe(false);
    });
  });

  describe("createRetrievedMemorySchema", () => {
    test("validates 1024-dimension embeddings correctly", () => {
      const schema = createRetrievedMemorySchema(1024);
      const validMemory = {
        id: "memory-1",
        topicSummary: "Test memory",
        rawDialogue: "Test dialogue",
        timestamp: Date.now(),
        sessionId: "session-123",
        embedding: Array.from({ length: 1024 }, () => Math.random()),
        turnReferences: [0, 1],
        relevanceScore: 0.85,
      };
      const result = schema.safeParse(validMemory);
      expect(result.success).toBe(true);
    });

    test("accepts optional embedding when dimension matches", () => {
      const schema = createRetrievedMemorySchema(1024);
      const validMemory = {
        id: "memory-1",
        topicSummary: "Test memory",
        rawDialogue: "Test dialogue",
        timestamp: Date.now(),
        sessionId: "session-123",
        turnReferences: [0, 1],
        relevanceScore: 0.85,
      };
      const result = schema.safeParse(validMemory);
      expect(result.success).toBe(true);
    });

    test("rejects 1536-dimension embeddings when 1024 is expected", () => {
      const schema = createRetrievedMemorySchema(1024);
      const invalidMemory = {
        id: "memory-1",
        topicSummary: "Test memory",
        rawDialogue: "Test dialogue",
        timestamp: Date.now(),
        sessionId: "session-123",
        embedding: Array.from({ length: 1536 }, () => Math.random()),
        turnReferences: [0, 1],
        relevanceScore: 0.85,
      };
      const result = schema.safeParse(invalidMemory);
      expect(result.success).toBe(false);
    });
  });

  describe("createRerankerStateSchema", () => {
    test("validates 768x768 weight matrices correctly", () => {
      const schema = createRerankerStateSchema(768);
      const validState = {
        weights: {
          queryTransform: Array.from({ length: 768 }, () =>
            Array.from({ length: 768 }, () => Math.random() * 0.02 - 0.01)
          ),
          memoryTransform: Array.from({ length: 768 }, () =>
            Array.from({ length: 768 }, () => Math.random() * 0.02 - 0.01)
          ),
        },
        config: {},
      };
      const result = schema.safeParse(validState);
      expect(result.success).toBe(true);
    });

    test("rejects 1536x1536 matrices when 768 is expected", () => {
      const schema = createRerankerStateSchema(768);
      const invalidState = {
        weights: {
          queryTransform: Array.from({ length: 1536 }, () =>
            Array.from({ length: 1536 }, () => Math.random() * 0.02 - 0.01)
          ),
          memoryTransform: Array.from({ length: 768 }, () =>
            Array.from({ length: 768 }, () => Math.random() * 0.02 - 0.01)
          ),
        },
        config: {},
      };
      const result = schema.safeParse(invalidState);
      expect(result.success).toBe(false);
    });

    test("rejects non-square matrices", () => {
      const schema = createRerankerStateSchema(768);
      const invalidState = {
        weights: {
          queryTransform: Array.from({ length: 768 }, () =>
            Array.from({ length: 1024 }, () => Math.random() * 0.02 - 0.01)
          ),
          memoryTransform: Array.from({ length: 768 }, () =>
            Array.from({ length: 768 }, () => Math.random() * 0.02 - 0.01)
          ),
        },
        config: {},
      };
      const result = schema.safeParse(invalidState);
      expect(result.success).toBe(false);
    });
  });

  describe("createGradientSampleSchema", () => {
    test("validates 768-dimension embeddings correctly", () => {
      const schema = createGradientSampleSchema(768);
      const validSample = {
        queryEmbedding: Array.from({ length: 768 }, () => Math.random()),
        adaptedQuery: Array.from({ length: 768 }, () => Math.random()),
        memoryEmbeddings: [
          Array.from({ length: 768 }, () => Math.random()),
          Array.from({ length: 768 }, () => Math.random()),
        ],
        adaptedMemories: [
          Array.from({ length: 768 }, () => Math.random()),
          Array.from({ length: 768 }, () => Math.random()),
        ],
        samplingProbabilities: [0.6, 0.4],
        selectedIndices: [0],
        citationRewards: [1],
        timestamp: Date.now(),
      };
      const result = schema.safeParse(validSample);
      expect(result.success).toBe(true);
    });

    test("rejects wrong dimension embeddings", () => {
      const schema = createGradientSampleSchema(768);
      const invalidSample = {
        queryEmbedding: Array.from({ length: 1536 }, () => Math.random()),
        adaptedQuery: Array.from({ length: 768 }, () => Math.random()),
        memoryEmbeddings: [
          Array.from({ length: 768 }, () => Math.random()),
        ],
        adaptedMemories: [
          Array.from({ length: 768 }, () => Math.random()),
        ],
        samplingProbabilities: [1.0],
        selectedIndices: [0],
        citationRewards: [1],
        timestamp: Date.now(),
      };
      const result = schema.safeParse(invalidSample);
      expect(result.success).toBe(false);
    });
  });

  describe("createGradientAccumulatorStateSchema", () => {
    test("validates 1024-dimension gradient matrices correctly", () => {
      const schema = createGradientAccumulatorStateSchema(1024);
      const validState = {
        samples: [],
        accumulatedGradWq: Array.from({ length: 1024 }, () =>
          Array.from({ length: 1024 }, () => 0)
        ),
        accumulatedGradWm: Array.from({ length: 1024 }, () =>
          Array.from({ length: 1024 }, () => 0)
        ),
        lastBatchIndex: 0,
        lastUpdated: Date.now(),
        version: 0,
      };
      const result = schema.safeParse(validState);
      expect(result.success).toBe(true);
    });

    test("rejects wrong dimension gradient matrices", () => {
      const schema = createGradientAccumulatorStateSchema(1024);
      const invalidState = {
        samples: [],
        accumulatedGradWq: Array.from({ length: 1536 }, () =>
          Array.from({ length: 1536 }, () => 0)
        ),
        accumulatedGradWm: Array.from({ length: 1024 }, () =>
          Array.from({ length: 1024 }, () => 0)
        ),
        lastBatchIndex: 0,
        lastUpdated: Date.now(),
        version: 0,
      };
      const result = schema.safeParse(invalidState);
      expect(result.success).toBe(false);
    });
  });

  describe("validateEmbeddingDimension", () => {
    test("validates 768-dimension embedding with custom expected dimension", () => {
      const embedding = Array.from({ length: 768 }, () => Math.random());
      expect(validateEmbeddingDimension(embedding, 768)).toBe(true);
      expect(validateEmbeddingDimension(embedding, 1536)).toBe(false);
    });

    test("validates 1024-dimension embedding with custom expected dimension", () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random());
      expect(validateEmbeddingDimension(embedding, 1024)).toBe(true);
      expect(validateEmbeddingDimension(embedding, 1536)).toBe(false);
    });

    test("returns false for empty array with custom dimension", () => {
      expect(validateEmbeddingDimension([], 768)).toBe(false);
      expect(validateEmbeddingDimension([], 1536)).toBe(false);
    });
  });

  describe("createDefaultRerankerState with custom dimension", () => {
    test("creates state with 768x768 matrices", () => {
      const state = createDefaultRerankerState(768);
      expect(state.weights.queryTransform.length).toBe(768);
      expect(state.weights.queryTransform[0].length).toBe(768);
      expect(state.weights.memoryTransform.length).toBe(768);
      expect(state.weights.memoryTransform[0].length).toBe(768);
    });

    test("creates state with 1024x1024 matrices", () => {
      const state = createDefaultRerankerState(1024);
      expect(state.weights.queryTransform.length).toBe(1024);
      expect(state.weights.queryTransform[0].length).toBe(1024);
      expect(state.weights.memoryTransform.length).toBe(1024);
      expect(state.weights.memoryTransform[0].length).toBe(1024);
    });

    test("created state passes schema validation with custom dimension", () => {
      const state = createDefaultRerankerState(768);
      const schema = createRerankerStateSchema(768);
      const result = schema.safeParse(state);
      expect(result.success).toBe(true);
    });
  });
});
