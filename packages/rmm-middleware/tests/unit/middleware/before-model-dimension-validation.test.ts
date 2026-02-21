import { describe, expect, test } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import { createInMemoryVectorStore } from "@/tests/fixtures/in-memory-vector-store";
import { createMockEmbeddings } from "@/tests/helpers/mock-embeddings";

function createState() {
  return {
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
    _turnCountInSession: 0,
  };
}

describe("beforeModel dimension validation", () => {
  test("throws when embeddings dimension is too small", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const embeddings = createMockEmbeddings(512);
    const hook = createRetrospectiveBeforeModel({
      vectorStore: createInMemoryVectorStore(embeddings),
      embeddings,
      topK: 20,
    });

    await expect(hook(createState(), { context: {} } as never)).rejects.toThrow(
      "Embedding dimension mismatch"
    );
  });

  test("throws when embeddings dimension is too large", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const embeddings = createMockEmbeddings(2048);
    const hook = createRetrospectiveBeforeModel({
      vectorStore: createInMemoryVectorStore(embeddings),
      embeddings,
      topK: 20,
    });

    await expect(hook(createState(), { context: {} } as never)).rejects.toThrow(
      "Embedding dimension mismatch"
    );
  });

  test("includes expected dimension in the error", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const embeddings = createMockEmbeddings(512);
    const hook = createRetrospectiveBeforeModel({
      vectorStore: createInMemoryVectorStore(embeddings),
      embeddings,
      topK: 20,
    });

    await expect(hook(createState(), { context: {} } as never)).rejects.toThrow(
      "1536"
    );
  });

  test("passes with 1536-dimensional embeddings", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const embeddings = createMockEmbeddings(1536);
    const hook = createRetrospectiveBeforeModel({
      vectorStore: createInMemoryVectorStore(embeddings),
      embeddings,
      topK: 20,
    });

    await expect(
      hook(createState(), { context: {} } as never)
    ).resolves.toBeDefined();
  });
});
