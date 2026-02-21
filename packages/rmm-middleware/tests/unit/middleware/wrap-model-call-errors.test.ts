import { describe, expect, test } from "bun:test";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { FakeToolCallingModel } from "langchain";
import { createRetrospectiveWrapModelCall } from "@/middleware/hooks/wrap-model-call";
import {
  createMockEmbeddings,
  createMockEmbeddingsWithFailure,
} from "@/tests/helpers/mock-embeddings";

/**
 * Tests for wrapModelCall hook error scenarios
 *
 * These tests verify that wrapModelCall gracefully handles errors:
 * 1. Embeddings failure -> calls handler normally (no memory injection)
 * 2. Missing human query -> calls handler normally
 * 3. Empty/missing retrieved memories -> calls handler directly
 */

describe("wrapModelCall Hook Error Scenarios", () => {
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

  function createRequest(
    _hook: ReturnType<typeof createRetrospectiveWrapModelCall>,
    overrides: {
      request?: Partial<Parameters<typeof _hook>[0]>;
      state?: Partial<Parameters<typeof _hook>[0]["state"]>;
    } = {}
  ): Parameters<typeof _hook>[0] {
    const baseMessages = [new HumanMessage({ content: "What is RMM?" })];
    const stateOverrides = overrides.state ?? {};
    const requestOverrides = overrides.request ?? {};

    const baseRequest: Parameters<typeof _hook>[0] = {
      model: new FakeToolCallingModel(),
      messages: baseMessages,
      systemPrompt: "",
      systemMessage: new SystemMessage(""),
      tools: [],
      state: {
        messages: baseMessages,
        _rerankerWeights: createValidRerankerState(),
        _retrievedMemories: createMockMemories(5),
        _citations: [],
        _turnCountInSession: 1,
        ...stateOverrides,
      },
      runtime: {
        context: {},
      },
    };

    return {
      ...baseRequest,
      ...requestOverrides,
      state: {
        ...baseRequest.state,
        ...stateOverrides,
      },
    };
  }

  test("should handle embeddings embedQuery failure gracefully", async () => {
    const hook = createRetrospectiveWrapModelCall({
      embeddings: createMockEmbeddingsWithFailure(true),
      embeddingDimension: 1536,
    });

    let handlerCalled = false;
    const handler: Parameters<typeof hook>[1] = () => {
      handlerCalled = true;
      return new AIMessage("Response about RMM");
    };

    const result = await hook(createRequest(hook), handler);

    expect(handlerCalled).toBe(true);
    expect(result.content).toBe("Response about RMM");
  });

  test("should handle requests without a human query gracefully", async () => {
    const hook = createRetrospectiveWrapModelCall({
      embeddings: createMockEmbeddings(),
      embeddingDimension: 1536,
    });

    let handlerCalled = false;
    const handler: Parameters<typeof hook>[1] = () => {
      handlerCalled = true;
      return new AIMessage("Response");
    };

    const request = createRequest(hook, {
      request: {
        messages: [new SystemMessage("System only")],
      },
      state: {
        messages: [new SystemMessage("System only")],
      },
    });

    const result = await hook(request, handler);

    expect(handlerCalled).toBe(true);
    expect(result.content).toBe("Response");
  });

  test("should handle empty retrieved memories array", async () => {
    const hook = createRetrospectiveWrapModelCall({
      embeddings: createMockEmbeddings(),
      embeddingDimension: 1536,
    });

    let handlerCalled = false;
    const handler: Parameters<typeof hook>[1] = () => {
      handlerCalled = true;
      return new AIMessage("Response");
    };

    const result = await hook(
      createRequest(hook, {
        state: {
          _retrievedMemories: [],
        },
      }),
      handler
    );

    expect(handlerCalled).toBe(true);
    expect(result.content).toBe("Response");
  });

  test("should handle missing retrieved memories gracefully", async () => {
    const hook = createRetrospectiveWrapModelCall({
      embeddings: createMockEmbeddings(),
      embeddingDimension: 1536,
    });

    let handlerCalled = false;
    const handler: Parameters<typeof hook>[1] = () => {
      handlerCalled = true;
      return new AIMessage("Response");
    };

    const result = await hook(
      createRequest(hook, {
        state: {
          _retrievedMemories: undefined,
        },
      }),
      handler
    );

    expect(handlerCalled).toBe(true);
    expect(result.content).toBe("Response");
  });
});
