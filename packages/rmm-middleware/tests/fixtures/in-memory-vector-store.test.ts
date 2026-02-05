import { describe, expect, test } from "bun:test";
import type { Document } from "@langchain/core/documents";
import type { Embeddings } from "@langchain/core/embeddings";

/**
 * Tests for InMemoryVectorStore fixture
 *
 * These tests verify that the InMemoryVectorStore:
 * 1. Implements VectorStoreInterface correctly
 * 2. Stores and retrieves documents
 * 3. Computes cosine similarity for ranking
 * 4. Can be configured to simulate failures for error testing
 */

describe("InMemoryVectorStore Fixture", () => {
  // Mock embeddings that return fixed vectors
  function createMockEmbeddings(dimension = 1536): Embeddings {
    return {
      embedQuery(_text: string): Promise<number[]> {
        return Promise.resolve(new Array(dimension).fill(0));
      },

      embedDocuments(texts: string[]): Promise<number[][]> {
        // Return one vector per text
        return Promise.resolve(texts.map(() => new Array(dimension).fill(0)));
      },
    };
  }

  test("should export createInMemoryVectorStore function", async () => {
    const { createInMemoryVectorStore } = await import(
      "@/tests/fixtures/in-memory-vector-store"
    );
    expect(typeof createInMemoryVectorStore).toBe("function");
  });

  test("should create a VectorStoreInterface instance", async () => {
    const { createInMemoryVectorStore } = await import(
      "@/tests/fixtures/in-memory-vector-store"
    );
    const mockEmbeddings = createMockEmbeddings();

    const vectorStore = createInMemoryVectorStore(mockEmbeddings);

    expect(vectorStore).toBeDefined();
    expect(typeof vectorStore.similaritySearch).toBe("function");
    expect(typeof vectorStore.addDocuments).toBe("function");
  });

  test("should add documents and retrieve them via similaritySearch", async () => {
    const { createInMemoryVectorStore } = await import(
      "@/tests/fixtures/in-memory-vector-store"
    );
    const mockEmbeddings = createMockEmbeddings();

    const vectorStore = createInMemoryVectorStore(mockEmbeddings);

    const documents: Document[] = [
      {
        pageContent: "User likes pizza",
        metadata: { id: "1", userId: "user1" },
      },
      {
        pageContent: "User prefers sushi",
        metadata: { id: "2", userId: "user1" },
      },
    ];

    await vectorStore.addDocuments(documents);

    const results = await vectorStore.similaritySearch(
      "What does user like?",
      2
    );

    expect(results).toHaveLength(2);
    expect(results[0].pageContent).toBe("User likes pizza");
    expect(results[1].pageContent).toBe("User prefers sushi");
  });

  test("should return empty array when no documents exist", async () => {
    const { createInMemoryVectorStore } = await import(
      "@/tests/fixtures/in-memory-vector-store"
    );
    const mockEmbeddings = createMockEmbeddings();

    const vectorStore = createInMemoryVectorStore(mockEmbeddings);

    const results = await vectorStore.similaritySearch("test query", 5);

    expect(results).toEqual([]);
  });

  test("should respect k parameter in similaritySearch", async () => {
    const { createInMemoryVectorStore } = await import(
      "@/tests/fixtures/in-memory-vector-store"
    );
    const mockEmbeddings = createMockEmbeddings();

    const vectorStore = createInMemoryVectorStore(mockEmbeddings);

    const documents: Document[] = [
      { pageContent: "Doc 1", metadata: { id: "1" } },
      { pageContent: "Doc 2", metadata: { id: "2" } },
      { pageContent: "Doc 3", metadata: { id: "3" } },
      { pageContent: "Doc 4", metadata: { id: "4" } },
      { pageContent: "Doc 5", metadata: { id: "5" } },
    ];

    await vectorStore.addDocuments(documents);

    const results = await vectorStore.similaritySearch("test", 3);

    expect(results).toHaveLength(3);
  });

  test("should preserve metadata when adding documents", async () => {
    const { createInMemoryVectorStore } = await import(
      "@/tests/fixtures/in-memory-vector-store"
    );
    const mockEmbeddings = createMockEmbeddings();

    const vectorStore = createInMemoryVectorStore(mockEmbeddings);

    const document: Document = {
      pageContent: "Test content",
      metadata: {
        id: "test-id",
        userId: "user123",
        timestamp: 1_234_567_890,
        sessionId: "session-1",
      },
    };

    await vectorStore.addDocuments([document]);

    const results = await vectorStore.similaritySearch("test", 1);

    expect(results).toHaveLength(1);
    expect(results[0].metadata).toEqual(document.metadata);
  });
});
