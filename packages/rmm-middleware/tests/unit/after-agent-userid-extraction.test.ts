import { describe, expect, test } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import type { Runtime } from "langchain";
import { rmmMiddleware } from "@/index";
import type { RmmRuntimeContext } from "@/schemas";
import { createInMemoryVectorStore } from "@/tests/fixtures/in-memory-vector-store";
import { createMockBaseStore } from "@/tests/fixtures/mock-base-store";
import { createMockEmbeddings } from "@/tests/helpers/mock-embeddings";

function createState() {
  return {
    messages: [new HumanMessage("Test message")],
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

describe("afterAgent user/session extraction", () => {
  test("persists buffer using runtime.context.sessionId", async () => {
    const embeddings = createMockEmbeddings();
    const store = createMockBaseStore();

    const middleware = rmmMiddleware({
      vectorStore: createInMemoryVectorStore(embeddings),
      embeddings,
      embeddingDimension: 1536,
      enabled: true,
    });

    const afterAgent = middleware.afterAgent;
    expect(afterAgent).toBeDefined();
    if (!afterAgent) {
      throw new Error("afterAgent hook missing");
    }

    if (typeof afterAgent === "function") {
      await afterAgent(createState(), {
        context: { sessionId: "context-user-789" },
        store,
      } as Runtime<RmmRuntimeContext>);
    } else {
      await afterAgent.hook(createState(), {
        context: { sessionId: "context-user-789" },
        store,
      } as Runtime<RmmRuntimeContext>);
    }

    const buffer = await store.get(
      ["rmm", "context-user-789", "buffer"],
      "message-buffer"
    );
    expect(buffer).not.toBeNull();
    expect((buffer?.value as { messages: unknown[] }).messages).toHaveLength(1);
  });

  test("returns gracefully when sessionId is missing", async () => {
    const embeddings = createMockEmbeddings();
    const middleware = rmmMiddleware({
      vectorStore: createInMemoryVectorStore(embeddings),
      embeddings,
      embeddingDimension: 1536,
      enabled: true,
    });

    const afterAgent = middleware.afterAgent;
    expect(afterAgent).toBeDefined();
    if (!afterAgent) {
      throw new Error("afterAgent hook missing");
    }

    const result =
      typeof afterAgent === "function"
        ? await afterAgent(createState(), {
            context: {},
            store: createMockBaseStore(),
          } as Runtime<RmmRuntimeContext>)
        : await afterAgent.hook(createState(), {
            context: {},
            store: createMockBaseStore(),
          } as Runtime<RmmRuntimeContext>);

    expect(result).toEqual({});
  });

  test("returns gracefully when store is missing", async () => {
    const embeddings = createMockEmbeddings();
    const middleware = rmmMiddleware({
      vectorStore: createInMemoryVectorStore(embeddings),
      embeddings,
      embeddingDimension: 1536,
      enabled: true,
    });

    const afterAgent = middleware.afterAgent;
    expect(afterAgent).toBeDefined();
    if (!afterAgent) {
      throw new Error("afterAgent hook missing");
    }

    const result =
      typeof afterAgent === "function"
        ? await afterAgent(createState(), {
            context: { sessionId: "u1" },
          } as Runtime<RmmRuntimeContext>)
        : await afterAgent.hook(createState(), {
            context: { sessionId: "u1" },
          } as Runtime<RmmRuntimeContext>);

    expect(result).toEqual({});
  });
});
