import { describe, expect, test } from "bun:test";
import { createMockBaseStore } from "../fixtures/mock-base-store";

/**
 * Tests for factory weight persistence via runtime store
 *
 * These tests verify that beforeAgent correctly uses runtime.context.store
 * (BaseStore) for weight persistence instead of the VectorStore from config.
 *
 * Bug: The factory was casting vectorStore to BaseStore at creation time,
 * but VectorStore doesn't have get()/put() methods - this would crash at runtime.
 *
 * Fix: Get BaseStore lazily from runtime.context.store at invocation time.
 */

describe("Factory - Weight Persistence via Runtime Store", () => {
  test("beforeAgent uses runtime.context.store when available", async () => {
    const { rmmMiddleware } = await import("@/index");

    // Create a mock store that tracks if get/put were called
    const mockStore = createMockBaseStore();
    let getCalled = false;
    const originalGet = mockStore.get.bind(mockStore);
    mockStore.get = async (namespace, key) => {
      getCalled = true;
      return originalGet(namespace, key);
    };

    const middleware = rmmMiddleware({
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {},
      },
      embeddings: {
        embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
        embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
      },
      embeddingDimension: 1536,
      enabled: true,
    });

    // Call beforeAgent with runtime containing store
    await middleware.beforeAgent(
      { messages: [] },
      {
        context: {
          store: mockStore,
          sessionId: "test-user",
        },
      } as any
    );

    // Verify store was accessed
    expect(getCalled).toBe(true);
  });

  test("beforeAgent uses initialized weights when store is missing", async () => {
    const { rmmMiddleware } = await import("@/index");

    const middleware = rmmMiddleware({
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {},
      },
      embeddings: {
        embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
        embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
      },
      embeddingDimension: 1536,
      enabled: true,
    });

    // Call beforeAgent without store in runtime
    const result = await middleware.beforeAgent(
      { messages: [] },
      { context: {} } as any
    );

    // Should return initialized weights (not crash)
    expect(result._rerankerWeights).toBeDefined();
    expect(result._rerankerWeights.config.topK).toBe(20);
  });

  test("beforeAgent uses initialized weights when userId is missing", async () => {
    const { rmmMiddleware } = await import("@/index");

    const mockStore = createMockBaseStore();
    const middleware = rmmMiddleware({
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {},
      },
      embeddings: {
        embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
        embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
      },
      embeddingDimension: 1536,
      enabled: true,
    });

    // Call beforeAgent with store but no userId
    const result = await middleware.beforeAgent(
      { messages: [] },
      {
        context: {
          store: mockStore,
          // No sessionId
        },
      } as any
    );

    // Should return initialized weights (can't save without userId)
    expect(result._rerankerWeights).toBeDefined();
    expect(result._rerankerWeights.config.topK).toBe(20);
  });
});
