import { describe, expect, test } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import type { Runtime } from "langchain";
import type { RmmRuntimeContext } from "@/schemas";
import {
  createFailingMockBaseStore,
  createMockBaseStore,
} from "@/tests/fixtures/mock-base-store";

describe("beforeAgent error handling", () => {
  test("continues with initialized state when store.get fails", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const hook = createRetrospectiveBeforeAgent({
      userIdExtractor: (runtime) => runtime.context?.userId ?? "",
      rerankerConfig: { embeddingDimension: 4 },
    });

    const result = await hook({ messages: [new HumanMessage("hello")] }, {
      context: { userId: "u1" },
      store: createFailingMockBaseStore("get"),
    } as Runtime<RmmRuntimeContext>);

    expect(result._rerankerWeights.weights.queryTransform.length).toBe(4);
    expect(result._retrievedMemories).toEqual([]);
    expect(result._citations).toEqual([]);
  });

  test("continues when userId is missing", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const hook = createRetrospectiveBeforeAgent({
      userIdExtractor: () => "",
      rerankerConfig: { embeddingDimension: 4 },
    });

    const result = await hook({ messages: [new HumanMessage("hello")] }, {
      context: {},
      store: createMockBaseStore(),
    } as Runtime<RmmRuntimeContext>);

    expect(result._rerankerWeights.weights.queryTransform.length).toBe(4);
    expect(result._turnCountInSession).toBe(0);
  });

  test("handles throwing userIdExtractor", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const hook = createRetrospectiveBeforeAgent({
      userIdExtractor: () => {
        throw new Error("boom");
      },
      rerankerConfig: { embeddingDimension: 4 },
    });

    const result = await hook({ messages: [new HumanMessage("hello")] }, {
      context: { userId: "u1" },
      store: createMockBaseStore(),
    } as Runtime<RmmRuntimeContext>);

    expect(result._rerankerWeights.weights.queryTransform.length).toBe(4);
    expect(result._retrievedMemories).toEqual([]);
  });
});
