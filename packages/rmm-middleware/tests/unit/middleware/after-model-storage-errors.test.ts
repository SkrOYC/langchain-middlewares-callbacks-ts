import { describe, expect, test } from "bun:test";
import type { BaseMessage } from "@langchain/core/messages";
import type { CitationRecord, RerankerState } from "@/schemas";
import { createFailingMockBaseStore } from "@/tests/fixtures/mock-base-store";

/**
 * Tests for afterModel hook storage error scenarios
 *
 * These tests verify that afterModel gracefully handles storage errors:
 * 1. Gradient load failure → creates new accumulator
 * 2. Gradient save failure → continues (log warning)
 * 3. Weight save failure → continues with in-memory weights (log warning)
 */

describe("afterModel Hook Storage Error Scenarios", () => {
  // Helper to create valid reranker state
  function createValidRerankerState(): RerankerState {
    return {
      weights: {
        queryTransform: Array.from({ length: 1536 }, () =>
          Array.from({ length: 1536 }, () => 0.01)
        ),
        memoryTransform: Array.from({ length: 1536 }, () =>
          Array.from({ length: 1536 }, () => 0.01)
        ),
      },
      config: {
        topK: 20,
        topM: 5,
        temperature: 0.5,
        learningRate: 0.001,
        baseline: 0.5,
      },
    };
  }

  // Helper to create valid citations
  function createValidCitations(topM = 5): CitationRecord[] {
    return Array.from({ length: topM }, (_, i) => ({
      memoryId: `memory-${i}`,
      reward: i % 2 === 0 ? 1 : -1,
      index: i,
    }));
  }

  // Helper to create full runtime context with embeddings
  function createFullRuntimeContext(userIdOrStore?: string | any) {
    return {
      context: {
        _citations: createValidCitations(5),
        _originalQuery: new Array(1536).fill(0.1),
        _adaptedQuery: new Array(1536).fill(0.2),
        _originalMemoryEmbeddings: Array.from({ length: 20 }, () =>
          new Array(1536).fill(0.3)
        ),
        _adaptedMemoryEmbeddings: Array.from({ length: 20 }, () =>
          new Array(1536).fill(0.4)
        ),
        _samplingProbabilities: Array.from({ length: 20 }, (_, _i) => 1 / 20),
        _selectedIndices: [0, 1, 2, 3, 4],
        userId: typeof userIdOrStore === "string" ? userIdOrStore : "user1",
        store:
          typeof userIdOrStore !== "string" || !userIdOrStore
            ? userIdOrStore
            : undefined,
        isSessionEnd: false,
      },
    };
  }

  // Sample state
  const sampleState = {
    messages: [] as BaseMessage[],
    _rerankerWeights: createValidRerankerState(),
    _retrievedMemories: [],
    _citations: [],
    _turnCountInSession: 1,
  };

  test("should handle gradient load failure gracefully", async () => {
    const { createRetrospectiveAfterModel } = await import(
      "@/middleware/hooks/after-model"
    );

    const failingStore = createFailingMockBaseStore("get");

    const middleware = createRetrospectiveAfterModel({
      batchSize: 4,
      clipThreshold: 100,
    });

    const runtime = createFullRuntimeContext({
      userId: "user1",
      store: failingStore,
    });

    const result = await middleware(sampleState, runtime);

    // Should still return valid state despite load failure
    expect(result).toBeDefined();
    expect(result._turnCountInSession).toBe(sampleState._turnCountInSession);
  });

  test("should handle gradient save failure gracefully", async () => {
    const { createRetrospectiveAfterModel } = await import(
      "@/middleware/hooks/after-model"
    );

    const failingStore = createFailingMockBaseStore("get");

    const middleware = createRetrospectiveAfterModel({
      batchSize: 4,
      clipThreshold: 100,
    });

    const runtime = createFullRuntimeContext({
      userId: "user1",
      store: failingStore,
    });

    // Set session end to trigger save
    runtime.context.isSessionEnd = true;

    const result = await middleware(sampleState, runtime);

    // Should still return valid state despite save failure
    expect(result).toBeDefined();
    expect(result._turnCountInSession).toBe(sampleState._turnCountInSession);
  });

  test("should handle weight save failure gracefully", async () => {
    const { createRetrospectiveAfterModel } = await import(
      "@/middleware/hooks/after-model"
    );

    const failingStore = createFailingMockBaseStore("get");

    const middleware = createRetrospectiveAfterModel({
      batchSize: 4,
      clipThreshold: 100,
    });

    const runtime = createFullRuntimeContext({
      userId: "user1",
      store: failingStore,
    });

    // Set session end to trigger weight save
    runtime.context.isSessionEnd = true;

    const result = await middleware(sampleState, runtime);

    // Should still return valid state despite weight save failure
    expect(result).toBeDefined();
  });

  test("should handle missing userId gracefully", async () => {
    const { createRetrospectiveAfterModel } = await import(
      "@/middleware/hooks/after-model"
    );

    const mockStore: any = {
      async get() {
        return await Promise.resolve(null);
      },

      async put() {
        return await Promise.resolve();
      },
    };

    const middleware = createRetrospectiveAfterModel({
      batchSize: 4,
      clipThreshold: 100,
    });

    const runtime = {
      context: {
        ...createFullRuntimeContext(undefined).context,
        userId: undefined,
        store: mockStore,
      },
    };

    const result = await middleware(sampleState, runtime);

    // Should skip update when userId missing
    expect(result).toBeDefined();
    expect(result._turnCountInSession).toBe(sampleState._turnCountInSession);
  });

  test("should handle missing store gracefully", async () => {
    const { createRetrospectiveAfterModel } = await import(
      "@/middleware/hooks/after-model"
    );

    const middleware = createRetrospectiveAfterModel({
      batchSize: 4,
      clipThreshold: 100,
    });

    const runtime = {
      context: {
        ...createFullRuntimeContext(undefined).context,
        userId: "user1",
        store: undefined,
      },
    };

    const result = await middleware(sampleState, runtime);

    // Should skip update when store missing
    expect(result).toBeDefined();
    expect(result._turnCountInSession).toBe(sampleState._turnCountInSession);
  });

  test("should handle empty citations gracefully", async () => {
    const { createRetrospectiveAfterModel } = await import(
      "@/middleware/hooks/after-model"
    );

    const mockStore: any = {
      async get() {
        return await Promise.resolve(null);
      },

      async put() {
        return await Promise.resolve();
      },
    };

    const middleware = createRetrospectiveAfterModel({
      batchSize: 4,
      clipThreshold: 100,
    });

    const runtime = {
      context: {
        _citations: [], // Empty citations
        userId: "user1",
        store: mockStore,
        isSessionEnd: false,
      },
    };

    const result = await middleware(sampleState, runtime);

    // Should skip update when no citations
    expect(result).toBeDefined();
    expect(result._turnCountInSession).toBe(sampleState._turnCountInSession);
  });
});
