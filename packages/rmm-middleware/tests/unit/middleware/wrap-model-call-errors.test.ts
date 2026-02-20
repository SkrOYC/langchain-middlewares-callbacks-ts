import { describe, expect, test } from "bun:test";
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import {
  createMockEmbeddings,
  createMockEmbeddingsWithFailure,
} from "@/tests/helpers/mock-embeddings";

/**
 * Tests for wrapModelCall hook error scenarios
 *
 * These tests verify that wrapModelCall gracefully handles errors:
 * 1. Embeddings failure → calls handler normally (no memory injection)
 * 2. Reranking failure → calls handler normally
 * 3. Citation extraction failure → continues but stores no citations
 */

describe("wrapModelCall Hook Error Scenarios", () => {
  // Helper to create a valid reranker state
  function createValidRerankerState() {
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

  // Helper to create mock retrieved memories
  function createMockMemories(length = 5) {
    return Array.from({ length }, (_, i) => ({
      id: `memory-${i}`,
      topicSummary: `Topic ${i}`,
      rawDialogue: `Dialogue ${i}`,
      timestamp: Date.now(),
      sessionId: "session-1",
      turnReferences: [1],
      relevanceScore: 1.0,
      embedding: new Array(1536).fill(0),
    }));
  }

  // Sample messages
  const sampleMessages: BaseMessage[] = [
    new HumanMessage({ content: "What is RMM?" }),
  ];

  test("should handle embeddings embedQuery failure gracefully", async () => {
    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const failingEmbeddings = createMockEmbeddingsWithFailure(true);

    const middleware = createRetrospectiveWrapModelCall({
      embeddings: failingEmbeddings,
    });

    let handlerCalled = false;
    const mockHandler = async () => {
      handlerCalled = true;
      return await Promise.resolve({
        content: "Response about RMM",
        text: "Response about RMM",
      } satisfies { content: string; text: string });
    };

    const request = {
      messages: sampleMessages,
      state: {
        _rerankerWeights: createValidRerankerState(),
        _retrievedMemories: createMockMemories(5),
        _citations: [],
        _turnCountInSession: 1,
      },
      runtime: {
        context: {},
      },
    };

    const result = await middleware(request, mockHandler);

    // Should call handler normally without memory injection
    expect(handlerCalled).toBe(true);
    expect(result.content).toBe("Response about RMM");
  });

  test("should handle missing reranker weights gracefully", async () => {
    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const workingEmbeddings = createMockEmbeddings();

    const middleware = createRetrospectiveWrapModelCall({
      embeddings: workingEmbeddings,
    });

    let handlerCalled = false;
    const mockHandler = async () => {
      handlerCalled = true;
      return await Promise.resolve({
        content: "Response",
        text: "Response",
      } satisfies { content: string; text: string });
    };

    const request = {
      messages: sampleMessages,
      state: {
        _rerankerWeights: {} as any, // Invalid weights
        _retrievedMemories: createMockMemories(5),
        _citations: [],
        _turnCountInSession: 1,
      },
      runtime: {
        context: {},
      },
    };

    const result = await middleware(request, mockHandler);

    // Should call handler normally without reranking
    expect(handlerCalled).toBe(true);
    expect(result.content).toBe("Response");
  });

  test("should handle empty retrieved memories array", async () => {
    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const workingEmbeddings = createMockEmbeddings();

    const middleware = createRetrospectiveWrapModelCall({
      embeddings: workingEmbeddings,
    });

    let handlerCalled = false;
    const mockHandler = async () => {
      handlerCalled = true;
      return await Promise.resolve({
        content: "Response",
        text: "Response",
      } satisfies { content: string; text: string });
    };

    const request = {
      messages: sampleMessages,
      state: {
        _rerankerWeights: createValidRerankerState(),
        _retrievedMemories: [], // Empty
        _citations: [],
        _turnCountInSession: 1,
      },
      runtime: {
        context: {},
      },
    };

    const result = await middleware(request, mockHandler);

    // Should call handler directly when no memories
    expect(handlerCalled).toBe(true);
    expect(result.content).toBe("Response");
  });

  test("should handle missing retrieved memories gracefully", async () => {
    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const workingEmbeddings = createMockEmbeddings();

    const middleware = createRetrospectiveWrapModelCall({
      embeddings: workingEmbeddings,
    });

    let handlerCalled = false;
    const mockHandler = async () => {
      handlerCalled = true;
      return await Promise.resolve({
        content: "Response",
        text: "Response",
      } satisfies { content: string; text: string });
    };

    const request = {
      messages: sampleMessages,
      state: {
        _rerankerWeights: createValidRerankerState(),
        _retrievedMemories: undefined as any, // Missing
        _citations: [],
        _turnCountInSession: 1,
      },
      runtime: {
        context: {},
      },
    };

    const result = await middleware(request, mockHandler);

    // Should call handler directly when memories missing
    expect(handlerCalled).toBe(true);
    expect(result.content).toBe("Response");
  });
});
