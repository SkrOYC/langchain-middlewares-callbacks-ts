import { describe, expect, test } from "bun:test";
import type { Embeddings } from "@langchain/core/embeddings";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type {
  RerankerState,
  RetrievedMemory,
  SerializedMessage,
} from "@/schemas/index";

/**
 * Mock store interface for testing
 */
interface MockStore extends BaseStore {
  storedData: Map<string, unknown>;
}

/**
 * Creates an async mock BaseStore for testing
 */
function createAsyncMockStore(initialData?: Map<string, unknown>): MockStore {
  const storedData = initialData ?? new Map<string, unknown>();

  return {
    storedData,
    async get(namespace, key) {
      const namespaceKey = [...namespace, key].join("|");
      const item = storedData.get(namespaceKey);
      return await Promise.resolve(
        item
          ? {
              value: item,
              key,
              namespace,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : null
      );
    },
    async put(namespace, key, value) {
      const namespaceKey = [...namespace, key].join("|");
      storedData.set(namespaceKey, value);
      return await Promise.resolve();
    },
    async delete() {
      return await Promise.resolve();
    },
    async batch() {
      return await Promise.resolve([]);
    },
    async search() {
      return await Promise.resolve([]);
    },
    async listNamespaces() {
      return await Promise.resolve([]);
    },
  };
}

/**
 * Creates a mock VectorStoreInterface for testing
 */
function createMockVectorStore(): VectorStoreInterface {
  return {
    async addDocuments(_documents) {
      return await Promise.resolve();
    },
    async addVectors(_vectors, _documents) {
      return await Promise.resolve();
    },
    async similaritySearch(query: string, k = 4) {
      // Return mock memories based on query
      const docs: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
      }> = [];
      for (let i = 0; i < Math.min(k, 5); i++) {
        docs.push({
          pageContent: `Memory ${i} about ${query}`,
          metadata: {
            id: `memory-${i}`,
            rawDialogue: `Dialogue for memory ${i}`,
            timestamp: Date.now() - i * 1000,
            sessionId: "test-session",
            turnReferences: [i],
            score: 0.9 - i * 0.1,
          },
        });
      }
      return await Promise.resolve(docs);
    },
    async similaritySearchWithScore(_query, _k) {
      return await Promise.resolve([]);
    },
    delete(_ids) {
      return Promise.resolve();
    },
  };
}

/**
 * Creates a mock Embeddings for testing
 */
function createMockEmbeddings(): Embeddings {
  return {
    embedDocument(text: string): Promise<number[]> {
      // Return deterministic embedding based on text
      const hash = text
        .split("")
        .reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const embedding = new Array(1536).fill(0);
      embedding[hash % 1536] = 1;
      return Promise.resolve(embedding);
    },
    embedQuery(text: string): Promise<number[]> {
      return this.embedDocument(text);
    },
  };
}

/**
 * Tests for rmmMiddleware() integration
 *
 * These tests verify that rmmMiddleware:
 * 1. Properly exports the factory function
 * 2. Wires up beforeAgent hook correctly
 * 3. Wires up beforeModel hook correctly
 * 4. Wires up afterModel hook correctly
 * 5. Wires up afterAgent hook correctly
 * 6. Returns no-op middleware when disabled
 * 7. Creates functional middleware when enabled
 */
import { createSerializedMessage } from "@/tests/helpers/messages";

describe("rmmMiddleware Integration", () => {
  const sampleState = {
    messages: [
      createSerializedMessage("human", "Hello, I need help with coding"),
    ] as SerializedMessage[],
    _rerankerWeights: {
      weights: {
        queryTransform: {
          rows: 1536,
          cols: 1536,
          data: new Float32Array(1536 * 1536),
        },
        memoryTransform: {
          rows: 1536,
          cols: 1536,
          data: new Float32Array(1536 * 1536),
        },
      },
      config: {
        topK: 20,
        topM: 5,
        temperature: 0.5,
        learningRate: 0.001,
        baseline: 0.5,
      },
    } as RerankerState,
    _retrievedMemories: [] as RetrievedMemory[],
    _citations: [],
    _turnCountInSession: 0,
  };

  test("should export rmmMiddleware function", async () => {
    const { rmmMiddleware } = await import("@/index");
    expect(typeof rmmMiddleware).toBe("function");
  });

  test("should return middleware with all hooks when enabled", async () => {
    const { rmmMiddleware } = await import("@/index");
    const vectorStore = createMockVectorStore();
    const embeddings = createMockEmbeddings();
    const _store = createAsyncMockStore();

    const middleware = rmmMiddleware({
      vectorStore,
      embeddings,
      embeddingDimension: 1536,
      enabled: true,
    });

    expect(middleware).toBeDefined();
    expect(typeof middleware.beforeAgent).toBe("function");
    expect(typeof middleware.beforeModel).toBe("function");
    expect(typeof middleware.afterModel).toBe("function");
    expect(typeof middleware.afterAgent).toBe("function");
  });

  test("should return no-op middleware when disabled", async () => {
    const { rmmMiddleware } = await import("@/index");
    const vectorStore = createMockVectorStore();
    const embeddings = createMockEmbeddings();

    const middleware = rmmMiddleware({
      vectorStore,
      embeddings,
      embeddingDimension: 1536,
      enabled: false,
    });

    expect(middleware).toBeDefined();
    // No-op middleware returns undefined from hooks
    const result = await middleware.beforeAgent(
      sampleState as Record<string, unknown>,
      {
        configurable: {},
      } as Record<string, unknown>
    );
    expect(result).toBeUndefined();
  });

  test("beforeAgent hook should initialize state when enabled", async () => {
    const { rmmMiddleware } = await import("@/index");
    const vectorStore = createMockVectorStore();
    const embeddings = createMockEmbeddings();
    const store = createAsyncMockStore();

    const middleware = rmmMiddleware({
      vectorStore,
      embeddings,
      embeddingDimension: 1536,
      store,
      enabled: true,
    });

    const runtime = {
      configurable: {},
      context: {
        store,
        sessionId: "test-session",
      },
    };

    const result = await middleware.beforeAgent(
      sampleState as Record<string, unknown>,
      runtime
    );

    expect(result).toBeDefined();
    expect(result).not.toBeUndefined();
    // Should have initialized reranker weights
    const stateUpdate = result as Record<string, unknown>;
    expect(stateUpdate._rerankerWeights).toBeDefined();
  });

  test("beforeModel hook should retrieve memories", async () => {
    const { rmmMiddleware } = await import("@/index");
    const vectorStore = createMockVectorStore();
    const embeddings = createMockEmbeddings();

    const middleware = rmmMiddleware({
      vectorStore,
      embeddings,
      embeddingDimension: 1536,
      topK: 3,
      enabled: true,
    });

    const result = await middleware.beforeModel(
      sampleState as Record<string, unknown>,
      { configurable: {}, context: {} } as Record<string, unknown>
    );

    expect(result).toBeDefined();
    const stateUpdate = result as Record<string, unknown>;
    // Should have retrieved memories
    expect(Array.isArray(stateUpdate._retrievedMemories)).toBe(true);
  });

  test("afterAgent hook should handle message buffering", async () => {
    const { rmmMiddleware } = await import("@/index");
    const vectorStore = createMockVectorStore();
    const embeddings = createMockEmbeddings();
    const store = createAsyncMockStore();

    const middleware = rmmMiddleware({
      vectorStore,
      embeddings,
      embeddingDimension: 1536,
      store,
      enabled: true,
    });

    const runtime = {
      configurable: {},
      context: {
        store,
        sessionId: "test-session",
      },
    };

    const result = await middleware.afterAgent(
      sampleState as Record<string, unknown>,
      runtime
    );

    // afterAgent returns empty object in append-only mode
    expect(result).toBeDefined();
  });

  test("should accept all configuration options", async () => {
    const { rmmMiddleware } = await import("@/index");
    const vectorStore = createMockVectorStore();
    const embeddings = createMockEmbeddings();

    // This should not throw - validates config schema
    const middleware = rmmMiddleware({
      vectorStore,
      embeddings,
      embeddingDimension: 1536,
      topK: 10,
      topM: 3,
      sessionId: "my-session",
      enabled: true,
    });

    expect(middleware).toBeDefined();
  });

  test("should use default values for optional config", async () => {
    const { rmmMiddleware } = await import("@/index");
    const vectorStore = createMockVectorStore();
    const embeddings = createMockEmbeddings();

    // Only required options (embeddings requires embeddingDimension)
    const middleware = rmmMiddleware({
      vectorStore,
      embeddings,
      embeddingDimension: 1536,
    });

    expect(middleware).toBeDefined();
  });
});
