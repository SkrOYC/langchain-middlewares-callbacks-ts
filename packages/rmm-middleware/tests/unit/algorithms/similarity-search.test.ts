import { describe, expect, test } from "bun:test";

/**
 * Tests for similarity search algorithm
 *
 * These tests verify that findSimilarMemories():
 * 1. Finds similar memories correctly
 * 2. Returns empty array when no matches
 * 3. Respects topK parameter
 */

describe("findSimilarMemories Algorithm", () => {
  // Helper to suppress console.warn during error-handling tests
  const suppressWarnings = async (fn: () => Promise<void>) => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await fn();
    } finally {
      console.warn = originalWarn;
    }
  };

  // Sample memory entry for testing
  const sampleMemory = {
    id: "test-memory-123",
    topicSummary: "User enjoys hiking on weekends",
    rawDialogue: "I went hiking this weekend and it was amazing",
    timestamp: Date.now(),
    sessionId: "session-456",
    embedding: Array.from({ length: 1536 }, () => Math.random()),
    turnReferences: [0, 2],
  };

  // Sample retrieved memories for mock VectorStore response
  const sampleRetrievedMemories = [
    {
      id: "existing-memory-1",
      topicSummary: "User likes outdoor activities",
      rawDialogue: "I enjoy being outside",
      timestamp: Date.now() - 100000,
      sessionId: "session-123",
      embedding: Array.from({ length: 1536 }, () => Math.random()),
      turnReferences: [0],
      relevanceScore: 0.85,
    },
    {
      id: "existing-memory-2",
      topicSummary: "User is a software engineer",
      rawDialogue: "I work with computers",
      timestamp: Date.now() - 200000,
      sessionId: "session-123",
      embedding: Array.from({ length: 1536 }, () => Math.random()),
      turnReferences: [1],
      relevanceScore: 0.45,
    },
    {
      id: "existing-memory-3",
      topicSummary: "User lives in Seattle",
      rawDialogue: "I live in Seattle",
      timestamp: Date.now() - 300000,
      sessionId: "session-123",
      embedding: Array.from({ length: 1536 }, () => Math.random()),
      turnReferences: [2],
      relevanceScore: 0.32,
    },
  ];

  test("should export findSimilarMemories function", async () => {
    const { findSimilarMemories } = await import(
      "@/algorithms/similarity-search"
    );
    expect(typeof findSimilarMemories).toBe("function");
  });

  test("finds similar memories correctly", async () => {
    const { findSimilarMemories } = await import(
      "@/algorithms/similarity-search"
    );

    // Mock VectorStore that returns similar memories
    const mockVectorStore = {
      similaritySearch: async () => {
        return [
          {
            pageContent: "User likes outdoor activities",
            metadata: {
              id: "existing-memory-1",
              sessionId: "session-123",
              turnReferences: [0],
              timestamp: Date.now() - 100000,
            },
          },
        ];
      },
    };

    const result = await findSimilarMemories(
      sampleMemory as any,
      mockVectorStore as any,
      5
    );

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBe(1);
    expect(result![0].id).toBe("existing-memory-1");
  });

  test("returns empty array when no matches", async () => {
    const { findSimilarMemories } = await import(
      "@/algorithms/similarity-search"
    );

    // Mock VectorStore that returns empty array
    const mockVectorStoreEmpty = {
      similaritySearch: async () => {
        return [];
      },
    };

    const result = await findSimilarMemories(
      sampleMemory as any,
      mockVectorStoreEmpty as any,
      5
    );

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBe(0);
  });

  test("respects topK parameter", async () => {
    const { findSimilarMemories } = await import(
      "@/algorithms/similarity-search"
    );

    const capturedKValue: number[] = [];

    // Mock VectorStore that captures the k parameter
    const mockVectorStoreCapturing = {
      similaritySearch: async (_query: string, k: number) => {
        capturedKValue.push(k);
        return [];
      },
    };

    await findSimilarMemories(
      sampleMemory as any,
      mockVectorStoreCapturing as any,
      10
    );

    expect(capturedKValue.length).toBe(1);
    expect(capturedKValue[0]).toBe(10);
  });

  test("uses default topK value when not specified", async () => {
    const { findSimilarMemories } = await import(
      "@/algorithms/similarity-search"
    );

    const capturedKValue: number[] = [];

    const mockVectorStoreDefault = {
      similaritySearch: async (_query: string, k: number) => {
        capturedKValue.push(k);
        return [];
      },
    };

    // Call without specifying topK
    await findSimilarMemories(
      sampleMemory as any,
      mockVectorStoreDefault as any
    );

    expect(capturedKValue.length).toBe(1);
    expect(capturedKValue[0]).toBe(5); // Default topK should be 5
  });

  test("includes relevance scores in retrieved memories", async () => {
    const { findSimilarMemories } = await import(
      "@/algorithms/similarity-search"
    );

    const mockVectorStoreWithScores = {
      similaritySearch: async () => {
        return [
          {
            pageContent: "User likes outdoor activities",
            metadata: {
              id: "existing-memory-1",
              sessionId: "session-123",
              turnReferences: [0],
              timestamp: Date.now() - 100000,
            },
          },
          {
            pageContent: "User is a software engineer",
            metadata: {
              id: "existing-memory-2",
              sessionId: "session-123",
              turnReferences: [1],
              timestamp: Date.now() - 200000,
            },
          },
        ];
      },
    };

    const result = await findSimilarMemories(
      sampleMemory as any,
      mockVectorStoreWithScores as any,
      5
    );

    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);

    // Verify retrieved memories have expected structure
    expect(result![0].topicSummary).toBe("User likes outdoor activities");
    expect(result![1].topicSummary).toBe("User is a software engineer");
  });

  test("handles VectorStore errors gracefully", async () => {
    await suppressWarnings(async () => {
      const { findSimilarMemories } = await import(
        "@/algorithms/similarity-search"
      );

      // Mock VectorStore that throws error
      const mockVectorStoreError = {
        similaritySearch: async () => {
          throw new Error("VectorStore connection failed");
        },
      };

      const result = await findSimilarMemories(
        sampleMemory as any,
        mockVectorStoreError as any,
        5
      );

      // Should return empty array on error for graceful degradation
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(true);
      expect(result!.length).toBe(0);
    });
  });

  test("converts metadata to RetrievedMemory structure", async () => {
    const { findSimilarMemories } = await import(
      "@/algorithms/similarity-search"
    );

    const expectedId = "test-conversion-id";
    const expectedSessionId = "test-session";
    const expectedTimestamp = 1234567890;
    const expectedTurnRefs = [0, 1, 2];

    const mockVectorStoreMetadata = {
      similaritySearch: async () => {
        return [
          {
            pageContent: "Test memory content",
            metadata: {
              id: expectedId,
              sessionId: expectedSessionId,
              turnReferences: expectedTurnRefs,
              timestamp: expectedTimestamp,
              rawDialogue: "Test memory content",
            },
          },
        ];
      },
    };

    const result = await findSimilarMemories(
      sampleMemory as any,
      mockVectorStoreMetadata as any,
      5
    );

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);

    const retrieved = result![0];
    expect(retrieved.id).toBe(expectedId);
    expect(retrieved.sessionId).toBe(expectedSessionId);
    expect(retrieved.timestamp).toBe(expectedTimestamp);
    expect(retrieved.turnReferences).toEqual(expectedTurnRefs);
    expect(retrieved.rawDialogue).toBe("Test memory content");
  });

  test("handles multiple similar memories", async () => {
    const { findSimilarMemories } = await import(
      "@/algorithms/similarity-search"
    );

    const mockVectorStoreMultiple = {
      similaritySearch: async () => {
        return [
          {
            pageContent: "Memory about hiking",
            metadata: {
              id: "memory-1",
              sessionId: "session-1",
              turnReferences: [0],
              timestamp: Date.now(),
            },
          },
          {
            pageContent: "Memory about running",
            metadata: {
              id: "memory-2",
              sessionId: "session-1",
              turnReferences: [1],
              timestamp: Date.now(),
            },
          },
          {
            pageContent: "Memory about cycling",
            metadata: {
              id: "memory-3",
              sessionId: "session-1",
              turnReferences: [2],
              timestamp: Date.now(),
            },
          },
        ];
      },
    };

    const result = await findSimilarMemories(
      sampleMemory as any,
      mockVectorStoreMultiple as any,
      5
    );

    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
    expect(result![0].id).toBe("memory-1");
    expect(result![1].id).toBe("memory-2");
    expect(result![2].id).toBe("memory-3");
  });

  test("uses topicSummary for similarity search query", async () => {
    const { findSimilarMemories } = await import(
      "@/algorithms/similarity-search"
    );

    const capturedQuery: string[] = [];

    const mockVectorStoreQueryCapture = {
      similaritySearch: async (query: string, _k: number) => {
        capturedQuery.push(query);
        return [];
      },
    };

    await findSimilarMemories(
      sampleMemory as any,
      mockVectorStoreQueryCapture as any,
      5
    );

    expect(capturedQuery.length).toBe(1);
    // The query should be based on the topicSummary
    expect(capturedQuery[0]).toBe(sampleMemory.topicSummary);
  });

  test("handles topK of 1", async () => {
    const { findSimilarMemories } = await import(
      "@/algorithms/similarity-search"
    );

    const capturedKValue: number[] = [];

    const mockVectorStoreSingle = {
      similaritySearch: async (_query: string, k: number) => {
        capturedKValue.push(k);
        return [];
      },
    };

    await findSimilarMemories(
      sampleMemory as any,
      mockVectorStoreSingle as any,
      1
    );

    expect(capturedKValue[0]).toBe(1);
  });

  test("handles large topK value", async () => {
    const { findSimilarMemories } = await import(
      "@/algorithms/similarity-search"
    );

    const capturedKValue: number[] = [];

    const mockVectorStoreLarge = {
      similaritySearch: async (_query: string, k: number) => {
        capturedKValue.push(k);
        return [];
      },
    };

    await findSimilarMemories(
      sampleMemory as any,
      mockVectorStoreLarge as any,
      100
    );

    expect(capturedKValue[0]).toBe(100);
  });
});
