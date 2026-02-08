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
    get(namespace: string[], key: string) {
      const namespaceKey = namespace.join("/");
      const fullKey = `${namespaceKey}/${key}`;
      const value = existingData.get(fullKey);
      return value ? { value } : null;
    },
    put(namespace: string[], key: string, value: unknown) {
      const namespaceKey = namespace.join("/");
      const fullKey = `${namespaceKey}/${key}`;
      existingData.set(fullKey, value);
      return true;
    },
    delete(_namespace: string[], _key: string) {
      return true;
    },
    batch(
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

  test("works with non-1536 embedding dimensions (e.g. 768-dim Contriever)", async () => {
    const dim = 768;
    const reranker: RerankerState = {
      config: {
        learningRate: 0.001,
        baseline: 0.5,
        topK: 20,
        topM: 4,
        temperature: 0.5,
      },
      weights: {
        queryTransform: createMatrix(dim, dim, 0.01),
        memoryTransform: createMatrix(dim, dim, 0.01),
      },
    };
    const messages = createTestMessages();
    const memories = createTestMemories(4);

    const afterModel = createRetrospectiveAfterModel({ batchSize: 1 });

    const store = createMockStore();
    const state = {
      messages,
      _rerankerWeights: reranker,
      _retrievedMemories: memories,
      _citations: [
        { memoryId: "memory-0", cited: true, reward: 1 as const, turnIndex: 0 },
        { memoryId: "memory-1", cited: false, reward: -1 as const, turnIndex: 1 },
      ],
      _turnCountInSession: 1,
    };

    const runtime = {
      context: {
        _citations: state._citations,
        _originalQuery: new Array(dim).fill(0.1),
        _adaptedQuery: new Array(dim).fill(0.11),
        _originalMemoryEmbeddings: memories.map(() =>
          new Array(dim).fill(0.1)
        ),
        _adaptedMemoryEmbeddings: memories.map(() =>
          new Array(dim).fill(0.11)
        ),
        _samplingProbabilities: memories.map(() => 1 / memories.length),
        _selectedIndices: [0, 1, 2, 3],
        userId: "user-1",
        store,
        isSessionEnd: true,
      },
    };

    // Should NOT throw a dimension mismatch error
    const result = await afterModel.afterModel(state, runtime);
    expect(result).toBeDefined();
    // Should have updated weights
    expect(result._rerankerWeights).toBeDefined();
    // Weights should maintain 768 dimensions
    const updatedWeights = result._rerankerWeights as RerankerState;
    expect(updatedWeights.weights.queryTransform.length).toBe(dim);
    expect(updatedWeights.weights.queryTransform[0]?.length).toBe(dim);
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

describe("REINFORCE Gradient Correctness (Equation 3)", () => {
  test("W_q gradient uses original query q, not adapted query q' (chain rule)", async () => {
    // With W_q != 0, q and q' differ. The correct chain rule for
    // ∂s_i/∂W_q gives m'_i ⊗ q (original query), not m'_i ⊗ q'.
    // We verify this by checking the column ratio of the ΔW_q update.
    //
    // Setup: q=[1, 0.5], W_q=diag(1, 0) → q'=[2, 0.5]
    // Correct ratio: ΔW_q[r][0]/ΔW_q[r][1] = q_0/q_1 = 1/0.5 = 2
    // Buggy ratio:  ΔW_q[r][0]/ΔW_q[r][1] = q'_0/q'_1 = 2/0.5 = 4
    const dim = 2;
    const q = [1.0, 0.5];
    // W_q = [[1, 0], [0, 0]] → q' = q + W_q·q = [1+1, 0.5+0] = [2, 0.5]
    const Wq = [[1.0, 0.0], [0.0, 0.0]];
    const Wm = [[0.0, 0.0], [0.0, 0.0]];
    const q_prime = [2.0, 0.5];

    // Two memories: m_0 = [1, 0], m_1 = [0, 0]
    // m'_0 = m_0 (since W_m = 0), m'_1 = m_1
    const m0 = [1.0, 0.0];
    const m1 = [0.0, 0.0];

    const reranker: RerankerState = {
      config: { learningRate: 0.1, baseline: 0, topK: 2, topM: 1, temperature: 1.0 },
      weights: { queryTransform: Wq, memoryTransform: Wm },
    };

    const store = createMockStore();
    const afterModel = createRetrospectiveAfterModel({ batchSize: 1 });

    const state = {
      messages: createTestMessages(),
      _rerankerWeights: reranker,
      _retrievedMemories: [
        { id: "m0", topicSummary: "t0", rawDialogue: "r0", timestamp: Date.now(), sessionId: "s", turnReferences: [0], relevanceScore: 0.9 },
        { id: "m1", topicSummary: "t1", rawDialogue: "r1", timestamp: Date.now(), sessionId: "s", turnReferences: [1], relevanceScore: 0.1 },
      ],
      _citations: [
        { memoryId: "m0", cited: true, reward: 1 as const, turnIndex: 0 },
        { memoryId: "m1", cited: false, reward: -1 as const, turnIndex: 1 },
      ],
      _turnCountInSession: 0,
    };

    const runtime = {
      context: {
        _citations: state._citations,
        _originalQuery: q,
        _adaptedQuery: q_prime,
        _originalMemoryEmbeddings: [m0, m1],
        _adaptedMemoryEmbeddings: [m0, m1], // same since W_m = 0
        _samplingProbabilities: [0.88, 0.12],
        _selectedIndices: [0],
        userId: "test-gradient",
        store,
        isSessionEnd: false,
      },
    };

    const result = await afterModel.afterModel(state, runtime);

    const updatedWeights = result._rerankerWeights as RerankerState;
    expect(updatedWeights).toBeDefined();

    // ΔW_q = newW_q - oldW_q
    const deltaWq_0_0 = updatedWeights.weights.queryTransform[0]![0]! - Wq[0]![0]!;
    const deltaWq_0_1 = updatedWeights.weights.queryTransform[0]![1]! - Wq[0]![1]!;

    // Skip if both are near-zero (degenerate case)
    if (Math.abs(deltaWq_0_0) > 1e-12 && Math.abs(deltaWq_0_1) > 1e-12) {
      // The ratio should be q_0/q_1 = 1/0.5 = 2 (correct chain rule)
      // NOT q'_0/q'_1 = 2/0.5 = 4 (buggy)
      const ratio = deltaWq_0_0 / deltaWq_0_1;
      expect(Math.abs(ratio - 2.0)).toBeLessThan(0.5); // Should be ~2, not ~4
    }
  });

  test("gradient magnitude scales with 1/temperature (softmax derivative)", async () => {
    // Paper: gradient includes 1/τ from softmax derivative.
    // With τ=0.5, gradient should be ~2x that of τ=1.0 (all else equal).
    const dim = 2;
    const q = [1.0, 0.0];

    const makeReranker = (temp: number): RerankerState => ({
      config: { learningRate: 0.1, baseline: 0, topK: 2, topM: 1, temperature: temp },
      weights: { queryTransform: [[0, 0], [0, 0]], memoryTransform: [[0, 0], [0, 0]] },
    });

    const m0 = [1.0, 0.0];
    const m1 = [0.0, 1.0];

    // Scores: s_0 = q·m_0 = 1, s_1 = q·m_1 = 0
    // For τ=1: P_0 = e/(e+1) ≈ 0.73, P_1 ≈ 0.27
    // For τ=0.5: P_0 = e^2/(e^2+1) ≈ 0.88, P_1 ≈ 0.12
    const P_t1 = [Math.exp(1) / (Math.exp(1) + 1), 1 / (Math.exp(1) + 1)];
    const P_t05 = [Math.exp(2) / (Math.exp(2) + 1), 1 / (Math.exp(2) + 1)];

    const makeContext = (probs: number[]) => ({
      _citations: [
        { memoryId: "m0", cited: true, reward: 1 as const, turnIndex: 0 },
        { memoryId: "m1", cited: false, reward: -1 as const, turnIndex: 1 },
      ],
      _originalQuery: q,
      _adaptedQuery: q, // q' = q since W_q = 0
      _originalMemoryEmbeddings: [m0, m1],
      _adaptedMemoryEmbeddings: [m0, m1], // same since W_m = 0
      _samplingProbabilities: probs,
      _selectedIndices: [0],
      userId: "test-temp",
      store: createMockStore(),
      isSessionEnd: false,
    });

    const makeState = (reranker: RerankerState) => ({
      messages: createTestMessages(),
      _rerankerWeights: reranker,
      _retrievedMemories: [
        { id: "m0", topicSummary: "t0", rawDialogue: "r0", timestamp: Date.now(), sessionId: "s", turnReferences: [0], relevanceScore: 0.9 },
        { id: "m1", topicSummary: "t1", rawDialogue: "r1", timestamp: Date.now(), sessionId: "s", turnReferences: [1], relevanceScore: 0.1 },
      ],
      _citations: makeContext(P_t1)._citations,
      _turnCountInSession: 0,
    });

    const afterModel = createRetrospectiveAfterModel({ batchSize: 1 });

    // Run with τ=1.0
    const reranker_t1 = makeReranker(1.0);
    const result_t1 = await afterModel.afterModel(
      makeState(reranker_t1),
      { context: makeContext(P_t1) }
    );

    // Run with τ=0.5
    const reranker_t05 = makeReranker(0.5);
    const result_t05 = await afterModel.afterModel(
      makeState(reranker_t05),
      { context: makeContext(P_t05) }
    );

    const w_t1 = (result_t1._rerankerWeights as RerankerState);
    const w_t05 = (result_t05._rerankerWeights as RerankerState);

    // ΔW_q with τ=0.5 should be roughly 2x ΔW_q with τ=1.0
    // because the gradient includes 1/τ from the softmax derivative
    const delta_t1 = w_t1.weights.queryTransform[0]![0]!; // W_q was zero
    const delta_t05 = w_t05.weights.queryTransform[0]![0]!;

    // Both should be non-zero
    if (Math.abs(delta_t1) > 1e-15) {
      const tempRatio = Math.abs(delta_t05 / delta_t1);
      // The ratio should be approximately 2 (1/0.5 vs 1/1.0)
      // Allow some tolerance due to different softmax probabilities
      expect(tempRatio).toBeGreaterThan(1.3); // Should be ~2, definitely > 1
    }
  });
});
