import { describe, expect, test } from "bun:test";
import type { Runtime } from "langchain";
import { rmmMiddleware } from "@/index";
import type { RmmRuntimeContext } from "@/schemas";
import { createInMemoryVectorStore } from "@/tests/fixtures/in-memory-vector-store";
import { createMockBaseStore } from "@/tests/fixtures/mock-base-store";
import { createMockEmbeddings } from "@/tests/helpers/mock-embeddings";

function createState() {
  return {
    messages: [],
    _rerankerWeights: {
      weights: { queryTransform: [[0]], memoryTransform: [[0]] },
      config: {
        topK: 3,
        topM: 1,
        temperature: 0.5,
        learningRate: 0.001,
        baseline: 0.5,
      },
    },
    _retrievedMemories: [],
    _citations: [],
    _turnCountInSession: 0,
  };
}

describe("factory weight persistence", () => {
  test("beforeAgent reads weights from runtime.store", async () => {
    const embeddings = createMockEmbeddings();
    const store = createMockBaseStore();

    let getCalled = false;
    const originalGet = store.get.bind(store);
    store.get = (namespace, key) => {
      getCalled = true;
      return originalGet(namespace, key);
    };

    const middleware = rmmMiddleware({
      vectorStore: createInMemoryVectorStore(embeddings),
      embeddings,
      embeddingDimension: 1536,
      enabled: true,
    });

    const beforeAgent = middleware.beforeAgent;
    expect(beforeAgent).toBeDefined();
    if (!beforeAgent) {
      throw new Error("beforeAgent hook missing");
    }
    if (typeof beforeAgent === "function") {
      await beforeAgent(createState(), {
        store,
        context: { sessionId: "test-user" },
      } as Runtime<RmmRuntimeContext>);
    } else {
      await beforeAgent.hook(createState(), {
        store,
        context: { sessionId: "test-user" },
      } as Runtime<RmmRuntimeContext>);
    }

    expect(getCalled).toBe(true);
  });

  test("beforeAgent initializes weights without store", async () => {
    const embeddings = createMockEmbeddings();
    const middleware = rmmMiddleware({
      vectorStore: createInMemoryVectorStore(embeddings),
      embeddings,
      embeddingDimension: 1536,
      enabled: true,
    });

    const beforeAgent = middleware.beforeAgent;
    expect(beforeAgent).toBeDefined();
    if (!beforeAgent) {
      throw new Error("beforeAgent hook missing");
    }
    const result =
      typeof beforeAgent === "function"
        ? await beforeAgent(createState(), {
            context: {},
          } as Runtime<RmmRuntimeContext>)
        : await beforeAgent.hook(createState(), {
            context: {},
          } as Runtime<RmmRuntimeContext>);

    expect(result).toBeDefined();
    if (result && typeof result === "object" && "_rerankerWeights" in result) {
      const typed = result as {
        _rerankerWeights: { config: { topK: number } };
      };
      expect(typed._rerankerWeights.config.topK).toBe(20);
    }
  });

  test("beforeAgent initializes weights when sessionId is missing", async () => {
    const embeddings = createMockEmbeddings();
    const middleware = rmmMiddleware({
      vectorStore: createInMemoryVectorStore(embeddings),
      embeddings,
      embeddingDimension: 1536,
      enabled: true,
    });

    const beforeAgent = middleware.beforeAgent;
    expect(beforeAgent).toBeDefined();
    if (!beforeAgent) {
      throw new Error("beforeAgent hook missing");
    }
    const result =
      typeof beforeAgent === "function"
        ? await beforeAgent(createState(), {
            store: createMockBaseStore(),
            context: {},
          } as Runtime<RmmRuntimeContext>)
        : await beforeAgent.hook(createState(), {
            store: createMockBaseStore(),
            context: {},
          } as Runtime<RmmRuntimeContext>);

    expect(result).toBeDefined();
    if (result && typeof result === "object" && "_rerankerWeights" in result) {
      const typed = result as {
        _rerankerWeights: { config: { topK: number } };
      };
      expect(typed._rerankerWeights.config.topK).toBe(20);
    }
  });
});
