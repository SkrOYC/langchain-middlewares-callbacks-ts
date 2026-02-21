import { describe, expect, test } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { Runtime } from "langchain";
import {
  createDefaultRerankerState,
  type RerankerState,
  type RmmRuntimeContext,
} from "@/schemas";
import { createWeightStorage } from "@/storage/weight-storage";
import {
  createFailingMockBaseStore,
  createMockBaseStore,
} from "@/tests/fixtures/mock-base-store";

function createRuntime(userId: string, store?: BaseStore) {
  return {
    context: { userId, sessionId: `session-${userId}` },
    store,
  } as Runtime<RmmRuntimeContext>;
}

describe("beforeAgent hook", () => {
  test("exports createRetrospectiveBeforeAgent", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );
    expect(typeof createRetrospectiveBeforeAgent).toBe("function");
  });

  test("initializes reranker state when store is missing", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const hook = createRetrospectiveBeforeAgent({
      userIdExtractor: (runtime) => runtime.context?.userId ?? "",
    });

    const result = await hook(
      { messages: [new HumanMessage("hello")] },
      createRuntime("u1")
    );

    expect(result._rerankerWeights).toBeDefined();
    expect(result._retrievedMemories).toEqual([]);
    expect(result._citations).toEqual([]);
    expect(result._turnCountInSession).toBe(0);
  });

  test("loads existing weights from store", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const store = createMockBaseStore();
    const userId = "u2";

    const base = createDefaultRerankerState();
    const existing: RerankerState = {
      ...base,
      config: {
        topK: 7,
        topM: 3,
        temperature: 0.6,
        learningRate: 0.01,
        baseline: 0.25,
      },
    };
    const queryRow = existing.weights.queryTransform[0];
    if (queryRow) {
      queryRow[0] = 0.123;
    }

    await createWeightStorage(store).saveWeights(userId, existing);

    const hook = createRetrospectiveBeforeAgent({
      userIdExtractor: (runtime) => runtime.context?.userId ?? "",
    });

    const result = await hook(
      { messages: [new HumanMessage("hello")] },
      createRuntime(userId, store)
    );

    expect(result._rerankerWeights.config.topK).toBe(7);
    expect(result._rerankerWeights.config.topM).toBe(3);
    expect(result._rerankerWeights.weights.queryTransform[0]?.[0]).toBe(0.123);
  });

  test("uses configured reranker defaults on fresh state", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const hook = createRetrospectiveBeforeAgent({
      userIdExtractor: (runtime) => runtime.context?.userId ?? "",
      rerankerConfig: {
        topK: 15,
        topM: 6,
        temperature: 0.7,
        learningRate: 0.002,
        baseline: 0.4,
        embeddingDimension: 8,
      },
    });

    const result = await hook(
      { messages: [new HumanMessage("hello")] },
      createRuntime("u3", createMockBaseStore())
    );

    expect(result._rerankerWeights.config.topK).toBe(15);
    expect(result._rerankerWeights.config.topM).toBe(6);
    expect(result._rerankerWeights.config.temperature).toBe(0.7);
    expect(result._rerankerWeights.weights.queryTransform.length).toBe(8);
    expect(result._rerankerWeights.weights.memoryTransform.length).toBe(8);
  });

  test("falls back to initialized state when store read fails", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const failingStore = createFailingMockBaseStore("get");
    const hook = createRetrospectiveBeforeAgent({
      userIdExtractor: (runtime) => runtime.context?.userId ?? "",
      rerankerConfig: { embeddingDimension: 4 },
    });

    const result = await hook(
      { messages: [new HumanMessage("hello")] },
      createRuntime("u4", failingStore)
    );

    expect(result._rerankerWeights.weights.queryTransform.length).toBe(4);
    expect(result._retrievedMemories).toEqual([]);
  });
});
