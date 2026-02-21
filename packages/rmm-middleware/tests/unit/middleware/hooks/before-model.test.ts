import { describe, expect, test } from "bun:test";
import { Document } from "@langchain/core/documents";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RetrievedMemory, RmmRuntimeContext } from "@/schemas";
import { createInMemoryVectorStore } from "@/tests/fixtures/in-memory-vector-store";
import { createMockEmbeddings } from "@/tests/helpers/mock-embeddings";

describe("beforeModel hook", () => {
  test("exports createRetrospectiveBeforeModel", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );
    expect(typeof createRetrospectiveBeforeModel).toBe("function");
  });

  test("increments turn count and preserves memories when no human query", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const embeddings = createMockEmbeddings();
    const vectorStore = createInMemoryVectorStore(embeddings);
    const hook = createRetrospectiveBeforeModel({
      vectorStore,
      embeddings,
      topK: 3,
    });

    const existingMemories: RetrievedMemory[] = [
      {
        id: "m-1",
        topicSummary: "existing",
        rawDialogue: "existing",
        timestamp: Date.now(),
        sessionId: "s-1",
        turnReferences: [0],
        relevanceScore: 0.5,
      },
    ];

    const result = await hook(
      {
        messages: [new SystemMessage("only system message")],
        _rerankerWeights: {
          weights: { queryTransform: [[0]], memoryTransform: [[0]] },
          config: {
            topK: 3,
            topM: 2,
            temperature: 0.5,
            learningRate: 0.001,
            baseline: 0.5,
          },
        },
        _retrievedMemories: existingMemories,
        _turnCountInSession: 4,
      },
      { context: {} } as { context: RmmRuntimeContext }
    );

    expect(result._turnCountInSession).toBe(5);
    expect(result._retrievedMemories).toEqual(existingMemories);
  });

  test("retrieves memories and populates embeddings", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const embeddings = createMockEmbeddings();
    const vectorStore = createInMemoryVectorStore(embeddings);

    await vectorStore.addDocuments([
      new Document({
        pageContent: "User likes hiking",
        metadata: { id: "m-1", rawDialogue: "hiking", sessionId: "s-1" },
      }),
      new Document({
        pageContent: "User prefers coffee",
        metadata: { id: "m-2", rawDialogue: "coffee", sessionId: "s-1" },
      }),
    ]);

    const hook = createRetrospectiveBeforeModel({
      vectorStore,
      embeddings,
      topK: 2,
    });

    const result = await hook(
      {
        messages: [new HumanMessage("What do you remember about me?")],
        _rerankerWeights: {
          weights: { queryTransform: [[0]], memoryTransform: [[0]] },
          config: {
            topK: 2,
            topM: 1,
            temperature: 0.5,
            learningRate: 0.001,
            baseline: 0.5,
          },
        },
        _retrievedMemories: [],
        _turnCountInSession: 0,
      },
      { context: {} } as { context: RmmRuntimeContext }
    );

    expect(result._turnCountInSession).toBe(1);
    expect(result._retrievedMemories?.length).toBeGreaterThan(0);
    expect(result._retrievedMemories?.[0]?.embedding?.length).toBe(1536);
  });

  test("handles vector store failures gracefully", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const embeddings = createMockEmbeddings();
    const failingStore = createInMemoryVectorStore(embeddings, {
      failSimilaritySearch: true,
    });

    const existingMemories: RetrievedMemory[] = [
      {
        id: "m-keep",
        topicSummary: "keep",
        rawDialogue: "keep",
        timestamp: Date.now(),
        sessionId: "s-1",
        turnReferences: [0],
        relevanceScore: 0.2,
      },
    ];

    const hook = createRetrospectiveBeforeModel({
      vectorStore: failingStore,
      embeddings,
      topK: 5,
    });

    const result = await hook(
      {
        messages: [new HumanMessage("trigger search")],
        _rerankerWeights: {
          weights: { queryTransform: [[0]], memoryTransform: [[0]] },
          config: {
            topK: 5,
            topM: 2,
            temperature: 0.5,
            learningRate: 0.001,
            baseline: 0.5,
          },
        },
        _retrievedMemories: existingMemories,
        _turnCountInSession: 2,
      },
      { context: {} } as { context: RmmRuntimeContext }
    );

    expect(result._turnCountInSession).toBe(3);
    expect(result._retrievedMemories).toEqual(existingMemories);
  });
});
