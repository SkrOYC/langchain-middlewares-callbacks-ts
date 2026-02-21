import { describe, expect, test } from "bun:test";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { FakeToolCallingModel } from "langchain";
import type { RmmRuntimeContext } from "@/schemas";
import { createDefaultRerankerState } from "@/schemas";
import { createMockEmbeddings } from "@/tests/helpers/mock-embeddings";

describe("wrapModelCall hook", () => {
  function createRerankerState(
    configOverrides: { topK?: number; topM?: number } = {}
  ) {
    const base = createDefaultRerankerState(1536);
    return {
      ...base,
      config: {
        ...base.config,
        ...configOverrides,
      },
    };
  }

  test("exports createRetrospectiveWrapModelCall", async () => {
    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );
    expect(typeof createRetrospectiveWrapModelCall).toBe("function");
  });

  test("passes through when no retrieved memories", async () => {
    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const hook = createRetrospectiveWrapModelCall({
      embeddings: createMockEmbeddings(),
      embeddingDimension: 1536,
    });

    let called = false;
    const handler: Parameters<typeof hook>[1] = (request) => {
      called = true;
      expect(request.messages.length).toBe(1);
      return new AIMessage("ok");
    };

    const request = {
      model: new FakeToolCallingModel(),
      messages: [new HumanMessage("hello")],
      systemPrompt: "",
      systemMessage: new SystemMessage(""),
      tools: [],
      state: {
        messages: [new HumanMessage("hello")],
        _rerankerWeights: createRerankerState({ topK: 5, topM: 2 }),
        _retrievedMemories: [],
        _citations: [],
      },
      runtime: {
        context: {} as RmmRuntimeContext,
      },
    } as Parameters<typeof hook>[0];

    const result = await hook(request, handler);
    expect(called).toBe(true);
    expect(result.content).toBe("ok");
  });

  test("injects ephemeral message and stores citations in context", async () => {
    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const hook = createRetrospectiveWrapModelCall({
      embeddings: createMockEmbeddings(),
      embeddingDimension: 1536,
    });

    const runtimeContext: RmmRuntimeContext = {};
    let seenMessages = 0;

    const handler: Parameters<typeof hook>[1] = (request) => {
      seenMessages = request.messages.length;
      return new AIMessage("Use memory [0]");
    };

    const request = {
      model: new FakeToolCallingModel(),
      messages: [new HumanMessage("what do you remember?")],
      systemPrompt: "",
      systemMessage: new SystemMessage(""),
      tools: [],
      state: {
        messages: [new HumanMessage("what do you remember?")],
        _rerankerWeights: createRerankerState({ topK: 3, topM: 1 }),
        _retrievedMemories: [
          {
            id: "m-1",
            topicSummary: "User likes hiking",
            rawDialogue: "hiking",
            timestamp: Date.now(),
            sessionId: "s-1",
            turnReferences: [0],
            relevanceScore: 0.9,
            embedding: new Array(1536).fill(0),
          },
        ],
        _citations: [],
      },
      runtime: {
        context: runtimeContext,
      },
    } as Parameters<typeof hook>[0];

    await hook(request, handler);

    expect(seenMessages).toBe(2);
    expect(runtimeContext._citations?.length).toBe(1);
    expect(runtimeContext._citations?.[0]?.reward).toBe(1);
  });

  test("returns empty citations for malformed citation output", async () => {
    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const hook = createRetrospectiveWrapModelCall({
      embeddings: createMockEmbeddings(),
      embeddingDimension: 1536,
    });

    const runtimeContext: RmmRuntimeContext = {};

    const request = {
      model: new FakeToolCallingModel(),
      messages: [new HumanMessage("hello")],
      systemPrompt: "",
      systemMessage: new SystemMessage(""),
      tools: [],
      state: {
        messages: [new HumanMessage("hello")],
        _rerankerWeights: createRerankerState({ topK: 3, topM: 1 }),
        _retrievedMemories: [
          {
            id: "m-1",
            topicSummary: "User likes hiking",
            rawDialogue: "hiking",
            timestamp: Date.now(),
            sessionId: "s-1",
            turnReferences: [0],
            relevanceScore: 0.9,
            embedding: new Array(1536).fill(0),
          },
        ],
        _citations: [],
      },
      runtime: {
        context: runtimeContext,
      },
    } as Parameters<typeof hook>[0];

    const handler: Parameters<typeof hook>[1] = () =>
      new AIMessage("bad citation [x]");

    await hook(request, handler);
    expect(runtimeContext._citations).toEqual([]);
  });
});
