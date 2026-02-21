import { describe, expect, test } from "bun:test";
import { Document } from "@langchain/core/documents";
import { HumanMessage } from "@langchain/core/messages";
import type { Runtime } from "langchain";
import { rmmMiddleware } from "@/index";
import type { RmmRuntimeContext } from "@/schemas";
import { createInMemoryVectorStore } from "@/tests/fixtures/in-memory-vector-store";
import { createMockBaseStore } from "@/tests/fixtures/mock-base-store";
import { createMockEmbeddings } from "@/tests/helpers/mock-embeddings";

function createState() {
  return {
    messages: [new HumanMessage("Hello, remember this")],
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

describe("rmmMiddleware integration", () => {
  test("exports rmmMiddleware", () => {
    expect(typeof rmmMiddleware).toBe("function");
  });

  test("returns no-op middleware when disabled", async () => {
    const middleware = rmmMiddleware({ enabled: false });

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

    expect(result).toBeUndefined();
  });

  test("returns full middleware when enabled", () => {
    const embeddings = createMockEmbeddings();
    const middleware = rmmMiddleware({
      enabled: true,
      embeddings,
      embeddingDimension: 1536,
      vectorStore: createInMemoryVectorStore(embeddings),
    });

    expect(middleware.beforeAgent).toBeDefined();
    expect(middleware.beforeModel).toBeDefined();
    expect(middleware.afterModel).toBeDefined();
    expect(middleware.afterAgent).toBeDefined();
  });

  test("beforeAgent initializes state with runtime.store", async () => {
    const embeddings = createMockEmbeddings();
    const middleware = rmmMiddleware({
      enabled: true,
      embeddings,
      embeddingDimension: 1536,
      vectorStore: createInMemoryVectorStore(embeddings),
    });

    const beforeAgent = middleware.beforeAgent;
    expect(beforeAgent).toBeDefined();
    if (!beforeAgent) {
      throw new Error("beforeAgent hook missing");
    }
    const runtime = {
      context: { sessionId: "s-1" },
      store: createMockBaseStore(),
    } as Runtime<RmmRuntimeContext>;
    const result =
      typeof beforeAgent === "function"
        ? await beforeAgent(createState(), runtime)
        : await beforeAgent.hook(createState(), runtime);

    expect(result?._rerankerWeights).toBeDefined();
    expect(result?._retrievedMemories).toEqual([]);
  });

  test("beforeModel can retrieve memories after beforeAgent init", async () => {
    const embeddings = createMockEmbeddings();
    const vectorStore = createInMemoryVectorStore(embeddings);
    await vectorStore.addDocuments([
      new Document({
        pageContent: "User likes hiking",
        metadata: { id: "m-1" },
      }),
    ]);

    const middleware = rmmMiddleware({
      enabled: true,
      embeddings,
      embeddingDimension: 1536,
      vectorStore,
    });

    const runtime = {
      context: { sessionId: "s-1" },
      store: createMockBaseStore(),
    } as Runtime<RmmRuntimeContext>;

    const beforeAgent = middleware.beforeAgent;
    expect(beforeAgent).toBeDefined();
    if (!beforeAgent) {
      throw new Error("beforeAgent hook missing");
    }
    const init =
      typeof beforeAgent === "function"
        ? await beforeAgent(createState(), runtime)
        : await beforeAgent.hook(createState(), runtime);

    const state = {
      ...createState(),
      ...init,
      messages: [new HumanMessage("what do you remember?")],
    };

    const beforeModel = middleware.beforeModel;
    expect(beforeModel).toBeDefined();
    if (!beforeModel) {
      throw new Error("beforeModel hook missing");
    }
    const result =
      typeof beforeModel === "function"
        ? await beforeModel(state, runtime)
        : await beforeModel.hook(state, runtime);
    expect(result?._turnCountInSession).toBe(1);
    expect(result?._retrievedMemories?.length).toBeGreaterThan(0);
  });
});
