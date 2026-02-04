/**
 * Tests for afterModel hook (RMM-7: Retrospective Reflection Learning)
 *
 * Implements the REINFORCE update for reranker weights:
 * Δφ = η·(R-b)·∇_φ log P(M_M|q, M_K; φ)
 */

import { describe, expect, test } from "bun:test";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { createRetrospectiveAfterModel } from "@/middleware/hooks/after-model";
import type {
  BaseMessage,
  CitationRecord,
  RerankerState,
  RetrievedMemory,
} from "@/schemas";

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a matrix of specified dimensions
 */
function createMatrix(rows: number, cols: number, value: number): number[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => value)
  );
}

/**
 * Creates a simple reranker state for testing
 */
function createTestRerankerState(
  overrides: Partial<RerankerState> = {}
): RerankerState {
  return {
    config: {
      learningRate: 0.001,
      baseline: 0.5,
      topK: 20,
      topM: 4,
      temperature: 0.5,
    },
    weights: {
      queryTransform: createMatrix(1536, 1536, 0.01),
      memoryTransform: createMatrix(1536, 1536, 0.01),
    },
    ...overrides,
  };
}

/**
 * Creates a mock BaseStore for testing
 */
function createMockStore(
  existingData: Map<string, unknown> = new Map()
): BaseStore {
  return {
    async get(namespace: string[], key: string) {
      const namespaceKey = namespace.join("/");
      const fullKey = `${namespaceKey}/${key}`;
      const value = existingData.get(fullKey);
      return value ? { value } : null;
    },
    async put(namespace: string[], key: string, value: unknown) {
      const namespaceKey = namespace.join("/");
      const fullKey = `${namespaceKey}/${key}`;
      existingData.set(fullKey, value);
      return true;
    },
    async delete(_namespace: string[], _key: string) {
      return true;
    },
    async batch(
      _namespace: string[],
      _values: Array<{ key: string; value: unknown }>
    ) {
      return [];
    },
  };
}

/**
 * Creates test messages
 */
function createTestMessages(): BaseMessage[] {
  return [
    new HumanMessage({ content: "What do you know about hiking?" }),
    new AIMessage({
      content: "I remember you mentioning you enjoy hiking in the mountains!",
    }),
    new HumanMessage({ content: "What's my favorite trail?" }),
  ];
}

/**
 * Creates test retrieved memories
 */
function createTestMemories(count = 4): RetrievedMemory[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `memory-${i}`,
    topicSummary: `Memory ${i} about hiking`,
    rawDialogue: `User mentioned hiking topic ${i}`,
    timestamp: Date.now() - 10_000 * i,
    sessionId: "session-1",
    turnReferences: [i],
    relevanceScore: 0.9 - i * 0.1,
  }));
}

// ============================================================================
// afterModel Hook Integration Tests
// ============================================================================

describe("afterModel Hook Integration", () => {
  test("hook executes without error when citations present", async () => {
    const reranker = createTestRerankerState();
    const messages = createTestMessages();
    const memories = createTestMemories(4);

    const afterModel = createRetrospectiveAfterModel({ batchSize: 4 });

    const store = createMockStore();
    const state = {
      messages,
      _rerankerWeights: reranker,
      _retrievedMemories: memories,
      _citations: [
        { memoryId: "memory-0", cited: true, reward: 1, turnIndex: 0 },
        { memoryId: "memory-1", cited: false, reward: -1, turnIndex: 1 },
      ],
      _turnCountInSession: 3, // Full batch
    };

    const runtime = {
      context: {
        _citations: state._citations,
        _originalQuery: new Array(1536).fill(0.1),
        _adaptedQuery: new Array(1536).fill(0.11),
        _originalMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.1)
        ),
        _adaptedMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.11)
        ),
        _samplingProbabilities: memories.map((_, _i) => 1 / memories.length),
        _selectedIndices: [0, 1, 2, 3],
        userId: "user-1",
        store,
        isSessionEnd: true,
      },
    };

    // Should not throw
    const result = await afterModel.afterModel(state, runtime);
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  test("no citations skips RL update gracefully", async () => {
    const reranker = createTestRerankerState();
    const messages = createTestMessages();
    const memories = createTestMemories(4);

    const afterModel = createRetrospectiveAfterModel({ batchSize: 4 });

    const store = createMockStore();
    const state = {
      messages,
      _rerankerWeights: reranker,
      _retrievedMemories: memories,
      _citations: [], // No citations
      _turnCountInSession: 1,
    };

    const runtime = {
      context: {
        _citations: [],
        _originalQuery: new Array(1536).fill(0.1),
        _adaptedQuery: new Array(1536).fill(0.11),
        _originalMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.1)
        ),
        _adaptedMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.11)
        ),
        _samplingProbabilities: memories.map((_, _i) => 1 / memories.length),
        _selectedIndices: [0, 1, 2, 3],
        userId: "user-1",
        store,
        isSessionEnd: true,
      },
    };

    // Should not throw
    const result = await afterModel.afterModel(state, runtime);
    expect(result).toBeDefined();
  });

  test("malformed citations handled gracefully", async () => {
    const reranker = createTestRerankerState();
    const messages = createTestMessages();
    const memories = createTestMemories(4);

    const afterModel = createRetrospectiveAfterModel({ batchSize: 4 });

    const store = createMockStore();
    const state = {
      messages,
      _rerankerWeights: reranker,
      _retrievedMemories: memories,
      _citations: [
        { memoryId: "memory-0", cited: true, reward: 1, turnIndex: 999 }, // Invalid
      ],
      _turnCountInSession: 1,
    };

    const runtime = {
      context: {
        _citations: state._citations,
        _originalQuery: new Array(1536).fill(0.1),
        _adaptedQuery: new Array(1536).fill(0.11),
        _originalMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.1)
        ),
        _adaptedMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.11)
        ),
        _samplingProbabilities: memories.map((_, _i) => 1 / memories.length),
        _selectedIndices: [0, 1, 2, 3],
        userId: "user-1",
        store,
        isSessionEnd: true,
      },
    };

    // Should not throw
    const result = await afterModel.afterModel(state, runtime);
    expect(result).toBeDefined();
  });

  test("session end triggers update with partial batch", async () => {
    const reranker = createTestRerankerState();
    const messages = createTestMessages();
    const memories = createTestMemories(4);

    const afterModel = createRetrospectiveAfterModel({ batchSize: 4 });

    const store = createMockStore();
    const state = {
      messages,
      _rerankerWeights: reranker,
      _retrievedMemories: memories,
      _citations: [
        { memoryId: "memory-0", cited: true, reward: 1, turnIndex: 0 },
      ],
      _turnCountInSession: 1,
    };

    const runtime = {
      context: {
        _citations: state._citations,
        _originalQuery: new Array(1536).fill(0.1),
        _adaptedQuery: new Array(1536).fill(0.11),
        _originalMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.1)
        ),
        _adaptedMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.11)
        ),
        _samplingProbabilities: memories.map((_, _i) => 1 / memories.length),
        _selectedIndices: [0, 1, 2, 3],
        userId: "user-1",
        store,
        isSessionEnd: true, // Session end triggers update
      },
    };

    // Should not throw
    const result = await afterModel.afterModel(state, runtime);
    expect(result).toBeDefined();
  });

  test("missing userId skips update gracefully", async () => {
    const reranker = createTestRerankerState();
    const messages = createTestMessages();
    const memories = createTestMemories(4);

    const afterModel = createRetrospectiveAfterModel({ batchSize: 4 });

    const store = createMockStore();
    const state = {
      messages,
      _rerankerWeights: reranker,
      _retrievedMemories: memories,
      _citations: [
        { memoryId: "memory-0", cited: true, reward: 1, turnIndex: 0 },
      ],
      _turnCountInSession: 3,
    };

    const runtime = {
      context: {
        _citations: state._citations,
        _originalQuery: new Array(1536).fill(0.1),
        _adaptedQuery: new Array(1536).fill(0.11),
        _originalMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.1)
        ),
        _adaptedMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.11)
        ),
        _samplingProbabilities: memories.map((_, _i) => 1 / memories.length),
        _selectedIndices: [0, 1, 2, 3],
        userId: undefined, // Missing userId
        store,
        isSessionEnd: true,
      },
    };

    // Should not throw
    const result = await afterModel.afterModel(state, runtime);
    expect(result).toBeDefined();
  });

  test("persistence works when update applied", async () => {
    const reranker = createTestRerankerState();
    const messages = createTestMessages();
    const memories = createTestMemories(4);

    const afterModel = createRetrospectiveAfterModel({ batchSize: 4 });

    // Mock store to capture saved data
    const savedData = new Map<string, unknown>();
    const store = createMockStore(savedData);

    const state = {
      messages,
      _rerankerWeights: reranker,
      _retrievedMemories: memories,
      _citations: [
        { memoryId: "memory-0", cited: true, reward: 1, turnIndex: 0 },
        { memoryId: "memory-1", cited: true, reward: 1, turnIndex: 1 },
        { memoryId: "memory-2", cited: true, reward: 1, turnIndex: 2 },
        { memoryId: "memory-3", cited: true, reward: 1, turnIndex: 3 },
      ],
      _turnCountInSession: 3,
    };

    const runtime = {
      context: {
        _citations: state._citations,
        _originalQuery: new Array(1536).fill(0.1),
        _adaptedQuery: new Array(1536).fill(0.11),
        _originalMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.1)
        ),
        _adaptedMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.11)
        ),
        _samplingProbabilities: memories.map((_, _i) => 1 / memories.length),
        _selectedIndices: [0, 1, 2, 3],
        userId: "user-1",
        store,
        isSessionEnd: true,
      },
    };

    await afterModel.afterModel(state, runtime);

    // Verify something was saved
    expect(savedData.size).toBeGreaterThan(0);
  });

  test("gradient accumulation across multiple turns", async () => {
    const reranker = createTestRerankerState();
    const messages = createTestMessages();
    const memories = createTestMemories(4);

    const afterModel = createRetrospectiveAfterModel({ batchSize: 4 });

    const store = createMockStore();
    const baseCitations: CitationRecord[] = [
      { memoryId: "memory-0", cited: true, reward: 1, turnIndex: 0 },
    ];

    const createRuntime = (_turn: number) => ({
      context: {
        _citations: baseCitations,
        _originalQuery: new Array(1536).fill(0.1),
        _adaptedQuery: new Array(1536).fill(0.11),
        _originalMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.1)
        ),
        _adaptedMemoryEmbeddings: memories.map(() =>
          new Array(1536).fill(0.11)
        ),
        _samplingProbabilities: memories.map((_, _i) => 1 / memories.length),
        _selectedIndices: [0, 1, 2, 3],
        userId: "user-1",
        store,
        isSessionEnd: false,
      },
    });

    // First 3 turns - should not throw
    for (let i = 0; i < 3; i++) {
      const state = {
        messages,
        _rerankerWeights: reranker,
        _retrievedMemories: memories,
        _citations: baseCitations,
        _turnCountInSession: i,
      };
      const runtime = createRuntime(i);
      const result = await afterModel.afterModel(state, runtime);
      expect(result).toBeDefined();
    }
  });
});
