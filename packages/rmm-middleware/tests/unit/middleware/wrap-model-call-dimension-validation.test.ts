import { describe, expect, test } from "bun:test";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { createMockEmbeddings } from "@/tests/helpers/mock-embeddings";

function createRequest<T extends (...args: any[]) => any>(
  _hook: T
): Parameters<T>[0] {
  return {
    model: {} as never,
    messages: [new HumanMessage("Hello")],
    systemPrompt: "",
    systemMessage: new SystemMessage(""),
    tools: [],
    state: {
      messages: [new HumanMessage("Hello")],
      _rerankerWeights: {
        weights: {
          queryTransform: [[0]],
          memoryTransform: [[0]],
        },
        config: {
          topK: 20,
          topM: 5,
          temperature: 0.5,
          learningRate: 0.001,
          baseline: 0.5,
        },
      },
      _retrievedMemories: [],
      _citations: [],
    },
    runtime: {
      context: {},
    },
  } as Parameters<T>[0];
}

describe("wrapModelCall dimension validation", () => {
  test("throws when embeddings dimension is too small", async () => {
    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const hook = createRetrospectiveWrapModelCall({
      embeddings: createMockEmbeddings(512),
      embeddingDimension: 512,
    });

    const handler: Parameters<typeof hook>[1] = () => new AIMessage("ok");

    await expect(hook(createRequest(hook), handler)).rejects.toThrow(
      "Embedding dimension mismatch"
    );
  });

  test("throws when embeddings dimension is too large", async () => {
    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const hook = createRetrospectiveWrapModelCall({
      embeddings: createMockEmbeddings(2048),
      embeddingDimension: 2048,
    });

    const handler: Parameters<typeof hook>[1] = () => new AIMessage("ok");

    await expect(hook(createRequest(hook), handler)).rejects.toThrow(
      "Embedding dimension mismatch"
    );
  });

  test("includes expected dimension in error message", async () => {
    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const hook = createRetrospectiveWrapModelCall({
      embeddings: createMockEmbeddings(512),
      embeddingDimension: 512,
    });

    const handler: Parameters<typeof hook>[1] = () => new AIMessage("ok");

    await expect(hook(createRequest(hook), handler)).rejects.toThrow("1536");
  });

  test("passes with 1536-dimensional embeddings", async () => {
    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const hook = createRetrospectiveWrapModelCall({
      embeddings: createMockEmbeddings(1536),
      embeddingDimension: 1536,
    });

    const handler: Parameters<typeof hook>[1] = () => new AIMessage("ok");

    await expect(hook(createRequest(hook), handler)).resolves.toBeDefined();
  });
});
