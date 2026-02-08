import { describe, expect, test } from "bun:test";
import type { Embeddings } from "@langchain/core/embeddings";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import type { RerankerState, RetrievedMemory } from "@/schemas/index";
import { createTestMessages } from "@/tests/helpers/messages";

/**
 * Tests for beforeModel hook
 *
 * These tests verify that beforeModel:
 * 1. Extracts query from last human message
 * 2. Retrieves Top-K from VectorStore
 * 3. Stores RetrievedMemory array with scores
 * 4. Increments turn counter
 * 5. Handles empty query and VectorStore failures gracefully
 */

interface BeforeModelRuntime {
  context: {
    vectorStore: VectorStoreInterface;
    embeddings: Embeddings;
  };
}

interface BeforeModelState {
  messages: BaseMessage[];
  _rerankerWeights: RerankerState;
  _retrievedMemories: RetrievedMemory[];
  _citations: unknown[];
  _turnCountInSession: number;
}

describe("beforeModel Hook", () => {
  // Sample state with messages for testing using proper LangChain messages
  const sampleMessages = createTestMessages([
    { type: "human", content: "Hello, I went hiking this weekend" },
    { type: "ai", content: "That sounds great!" },
    { type: "human", content: "What do you know about hiking trails?" },
  ]);

  const sampleState: BeforeModelState = {
    messages: sampleMessages,
    _rerankerWeights: {
      weights: {
        queryTransform: [],
        memoryTransform: [],
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
    _turnCountInSession: 0,
  };

  test("should export createRetrospectiveBeforeModel function", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );
    expect(typeof createRetrospectiveBeforeModel).toBe("function");
  });

  test("extracts query from last human message", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const mockVectorStore: VectorStoreInterface = {
      similaritySearch(query, k) {
        // Should be called with the last human message content
        expect(query).toBe("What do you know about hiking trails?");
        expect(k).toBe(20);
        return [];
      },
      addDocuments() {
        // intentionally empty mock
      },
      delete() {
        // intentionally empty mock
      },
    };

    const middleware = createRetrospectiveBeforeModel({
      vectorStore: mockVectorStore,
      embeddings: {} as Embeddings,
      topK: 20,
    });

    const mockRuntime: BeforeModelRuntime = {
      context: {
        vectorStore: mockVectorStore,
        embeddings: {} as Embeddings,
      },
    };

    const result = await middleware.beforeModel(sampleState, mockRuntime);

    expect(result).not.toBeNull();
  });

  test("retrieves Top-K from VectorStore", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const mockVectorStore: VectorStoreInterface = {
      similaritySearch(_query, k) {
        expect(k).toBe(10); // Custom topK
        return [
          {
            pageContent: "User enjoys mountain hiking",
            metadata: {
              id: "memory-1",
              sessionId: "session-1",
              timestamp: Date.now(),
              turnReferences: [0],
              rawDialogue: "User: I love hiking in the mountains",
            },
          },
          {
            pageContent: "User prefers morning hikes",
            metadata: {
              id: "memory-2",
              sessionId: "session-1",
              timestamp: Date.now(),
              turnReferences: [1],
              rawDialogue: "User: I prefer hiking in the morning",
            },
          },
        ];
      },
      addDocuments() {
        // intentionally empty mock
      },
      delete() {
        // intentionally empty mock
      },
    };

    const middleware = createRetrospectiveBeforeModel({
      vectorStore: mockVectorStore,
      embeddings: {} as Embeddings,
      topK: 10,
    });

    const mockRuntime: BeforeModelRuntime = {
      context: {
        vectorStore: mockVectorStore,
        embeddings: {} as Embeddings,
      },
    };

    const result = await middleware.beforeModel(sampleState, mockRuntime);

    expect(result._retrievedMemories).toBeDefined();
    expect(result._retrievedMemories?.length).toBe(2);
    expect(result._retrievedMemories?.[0].id).toBe("memory-1");
    expect(result._retrievedMemories?.[0].topicSummary).toBe(
      "User enjoys mountain hiking"
    );
    expect(result._retrievedMemories?.[1].id).toBe("memory-2");
  });

  test("stores RetrievedMemory array with scores", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const mockVectorStore: VectorStoreInterface = {
      similaritySearch(_query, _k) {
        return [
          {
            pageContent: "Memory about hiking",
            metadata: {
              id: "test-memory-id",
              sessionId: "session-123",
              timestamp: Date.now() - 100_000,
              turnReferences: [0],
              rawDialogue: "Raw dialogue content",
              score: 0.85,
            },
          },
        ];
      },
      addDocuments() {
        // intentionally empty mock
      },
      delete() {
        // intentionally empty mock
      },
    };

    const middleware = createRetrospectiveBeforeModel({
      vectorStore: mockVectorStore,
      embeddings: {} as Embeddings,
    });

    const mockRuntime: BeforeModelRuntime = {
      context: {
        vectorStore: mockVectorStore,
        embeddings: {} as Embeddings,
      },
    };

    const result = await middleware.beforeModel(sampleState, mockRuntime);

    expect(result._retrievedMemories).toBeDefined();
    expect(result._retrievedMemories?.length).toBe(1);
    expect(result._retrievedMemories?.[0].id).toBe("test-memory-id");
    expect(result._retrievedMemories?.[0].relevanceScore).toBe(0.85);
    expect(result._retrievedMemories?.[0].sessionId).toBe("session-123");
    expect(result._retrievedMemories?.[0].turnReferences).toEqual([0]);
  });

  test("increments turn counter", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const mockVectorStore: VectorStoreInterface = {
      similaritySearch() {
        return [];
      },
      addDocuments() {
        // intentionally empty mock
      },
      delete() {
        // intentionally empty mock
      },
    };

    const middleware = createRetrospectiveBeforeModel({
      vectorStore: mockVectorStore,
      embeddings: {} as Embeddings,
    });

    const mockRuntime: BeforeModelRuntime = {
      context: {
        vectorStore: mockVectorStore,
        embeddings: {} as Embeddings,
      },
    };

    // Initial state has _turnCountInSession = 0
    const stateWithCounter = { ...sampleState, _turnCountInSession: 5 };
    const result = await middleware.beforeModel(stateWithCounter, mockRuntime);

    expect(result._turnCountInSession).toBe(6);
  });

  test("handles empty query gracefully", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    let vectorStoreCalled = false;
    const mockVectorStore: VectorStoreInterface = {
      similaritySearch() {
        vectorStoreCalled = true;
        return [];
      },
      addDocuments() {
        // intentionally empty mock
      },
      delete() {
        // intentionally empty mock
      },
    };

    const middleware = createRetrospectiveBeforeModel({
      vectorStore: mockVectorStore,
      embeddings: {} as Embeddings,
    });

    const mockRuntime: BeforeModelRuntime = {
      context: {
        vectorStore: mockVectorStore,
        embeddings: {} as Embeddings,
      },
    };

    // State with only AI message (no human message to extract)
    const emptyQueryState: BeforeModelState = {
      ...sampleState,
      messages: [
        {
          lc_serialized: { type: "ai" },
          lc_kwargs: { content: "Hello!" },
          lc_id: ["ai"],
          content: "Hello!",
          additional_kwargs: {},
        },
      ],
    };

    const result = await middleware.beforeModel(emptyQueryState, mockRuntime);

    expect(vectorStoreCalled).toBe(false);
    // When no query is found, existing memories should be preserved (empty array if none)
    expect(result._retrievedMemories).toEqual([]);
    // Turn counter should still increment
    expect(result._turnCountInSession).toBe(1);
  });

  test("populates embedding field on retrieved memories for reranking (Equation 1)", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const dim = 1536;
    const mockEmbedding = new Array(dim).fill(0.01);

    const mockVectorStore: VectorStoreInterface = {
      similaritySearch(_query, _k) {
        return [
          {
            pageContent: "User enjoys hiking",
            metadata: {
              id: "mem-1",
              sessionId: "s-1",
              timestamp: Date.now(),
              turnReferences: [0],
              rawDialogue: "I love hiking",
              score: 0.9,
            },
          },
          {
            pageContent: "User likes cooking",
            metadata: {
              id: "mem-2",
              sessionId: "s-1",
              timestamp: Date.now(),
              turnReferences: [1],
              rawDialogue: "I cook often",
              score: 0.7,
            },
          },
        ];
      },
      addDocuments() {
        // No-op for this test - documents are tracked via capturedDocuments
      },
      delete() {
        // No-op for this test - deletions are tracked via capturedDocuments
      },
    };

    // Mock embeddings that returns predictable vectors
    const mockEmbeddings = {
      embedQuery: async (_text: string) => mockEmbedding,
      embedDocuments: async (texts: string[]) =>
        texts.map(() => [...mockEmbedding]),
    } as unknown as Embeddings;

    const middleware = createRetrospectiveBeforeModel({
      vectorStore: mockVectorStore,
      embeddings: mockEmbeddings,
      topK: 10,
    });

    const mockRuntime: BeforeModelRuntime = {
      context: {
        vectorStore: mockVectorStore,
        embeddings: mockEmbeddings,
      },
    };

    const result = await middleware.beforeModel(sampleState, mockRuntime);

    expect(result._retrievedMemories).toBeDefined();
    expect(result._retrievedMemories?.length).toBe(2);

    // Each retrieved memory must have its embedding populated
    // so Equation 1 (m'_i = m_i + W_m·m_i) can be applied in wrap-model-call
    for (const mem of result._retrievedMemories ?? []) {
      expect(mem.embedding).toBeDefined();
      expect(mem.embedding?.length).toBe(dim);
    }
  });

  test("handles VectorStore failure gracefully", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const mockVectorStore: VectorStoreInterface = {
      similaritySearch() {
        throw new Error("VectorStore connection failed");
      },
      addDocuments() {
        // intentionally empty mock
      },
      delete() {
        // intentionally empty mock
      },
    };

    const middleware = createRetrospectiveBeforeModel({
      vectorStore: mockVectorStore,
      embeddings: {} as Embeddings,
    });

    const mockRuntime: BeforeModelRuntime = {
      context: {
        vectorStore: mockVectorStore,
        embeddings: {} as Embeddings,
      },
    };

    // Should not throw, should return with empty memories
    const result = await middleware.beforeModel(sampleState, mockRuntime);

    expect(result).not.toBeNull();
    expect(result._turnCountInSession).toBe(1);
  });
});
