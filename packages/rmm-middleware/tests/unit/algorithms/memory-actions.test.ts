import { describe, expect, test } from "bun:test";

/**
 * Tests for memory action functions (addMemory and mergeMemory)
 *
 * These tests verify that:
 * 1. addMemory adds documents to VectorStore correctly
 * 2. mergeMemory updates existing documents in VectorStore
 */

describe("Memory Actions", () => {
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

  describe("addMemory", () => {
    test("should export addMemory function", async () => {
      const { addMemory } = await import(
        "../../../src/algorithms/memory-actions.ts"
      );
      expect(typeof addMemory).toBe("function");
    });

    test("adds document to VectorStore", async () => {
      const { addMemory } = await import(
        "../../../src/algorithms/memory-actions.ts"
      );

      const addedDocuments: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
      }> = [];

      // Mock VectorStore that captures added documents
      const mockVectorStore = {
        addDocuments: async (docs: Array<{
          pageContent: string;
          metadata: Record<string, unknown>;
        }>) => {
          addedDocuments.push(...docs);
        },
      };

      await addMemory(
        sampleMemory as any,
        mockVectorStore as any
      );

      expect(addedDocuments.length).toBe(1);
      expect(addedDocuments[0].pageContent).toBe(sampleMemory.topicSummary);
    });

    test("includes correct metadata in document", async () => {
      const { addMemory } = await import(
        "../../../src/algorithms/memory-actions.ts"
      );

      const addedDocuments: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
      }> = [];

      const mockVectorStore = {
        addDocuments: async (docs: Array<{
          pageContent: string;
          metadata: Record<string, unknown>;
        }>) => {
          addedDocuments.push(...docs);
        },
      };

      await addMemory(
        sampleMemory as any,
        mockVectorStore as any
      );

      expect(addedDocuments.length).toBe(1);
      const metadata = addedDocuments[0].metadata;
      expect(metadata.id).toBe(sampleMemory.id);
      expect(metadata.sessionId).toBe(sampleMemory.sessionId);
      expect(metadata.timestamp).toBe(sampleMemory.timestamp);
      expect(metadata.turnReferences).toEqual(sampleMemory.turnReferences);
    });

    test("handles VectorStore errors gracefully", async () => {
      await suppressWarnings(async () => {
        const { addMemory } = await import(
          "../../../src/algorithms/memory-actions.ts"
        );

        // Mock VectorStore that throws error
        const mockVectorStoreError = {
          addDocuments: async () => {
            throw new Error("VectorStore connection failed");
          },
        };

        // Should not throw, errors are caught internally
        let errorThrown = false;
        try {
          await addMemory(sampleMemory as any, mockVectorStoreError as any);
        } catch {
          errorThrown = true;
        }
        expect(errorThrown).toBe(false);
      });
    });

    test("creates document with topicSummary as pageContent", async () => {
      const { addMemory } = await import(
        "../../../src/algorithms/memory-actions.ts"
      );

      const addedDocuments: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
      }> = [];

      const mockVectorStore = {
        addDocuments: async (docs: Array<{
          pageContent: string;
          metadata: Record<string, unknown>;
        }>) => {
          addedDocuments.push(...docs);
        },
      };

      await addMemory(
        sampleMemory as any,
        mockVectorStore as any
      );

      expect(addedDocuments[0].pageContent).toBe(sampleMemory.topicSummary);
    });
  });

  describe("mergeMemory", () => {
    test("should export mergeMemory function", async () => {
      const { mergeMemory } = await import(
        "../../../src/algorithms/memory-actions.ts"
      );
      expect(typeof mergeMemory).toBe("function");
    });

    test("updates existing document in VectorStore", async () => {
      const { mergeMemory } = await import(
        "../../../src/algorithms/memory-actions.ts"
      );

      const existingId = "existing-memory-456";
      const mergedSummary = "User enjoys outdoor activities including hiking";

      // Mock similarity search to return the existing document
      const mockSimilaritySearch = async () => {
        return [
          {
            pageContent: "Old content",
            metadata: {
              id: existingId,
              sessionId: "session-123",
              timestamp: Date.now() - 100000,
              turnReferences: [0],
            },
          },
        ];
      };

      const addedDocuments: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
      }> = [];

      // Mock delete
      const mockDelete = async (_options: { ids: string[] }) => {};

      // Mock addDocuments to capture added documents
      const mockAddDocuments = async (docs: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
      }>) => {
        addedDocuments.push(...docs);
      };

      const mockVectorStore = {
        similaritySearch: mockSimilaritySearch,
        delete: mockDelete,
        addDocuments: mockAddDocuments,
      };

      await mergeMemory(
        existingId,
        mergedSummary,
        mockVectorStore as any
      );

      expect(addedDocuments.length).toBe(1);
      expect(addedDocuments[0].pageContent).toBe(mergedSummary);
    });

    test("includes existing metadata in updated document", async () => {
      const { mergeMemory } = await import(
        "../../../src/algorithms/memory-actions.ts"
      );

      const existingId = "existing-memory-456";
      const existingMetadata = {
        id: existingId,
        sessionId: "session-123",
        timestamp: Date.now() - 100000,
        turnReferences: [0],
      };
      const mergedSummary = "Updated summary";

      // Mock similarity search to return the existing document
      const mockSimilaritySearch = async () => {
        return [
          {
            pageContent: "Old content",
            metadata: existingMetadata,
          },
        ];
      };

      const addedMetadata: Array<Record<string, unknown>> = [];

      // Mock delete
      const mockDelete = async (_options: { ids: string[] }) => {};

      // Mock addDocuments to capture metadata
      const mockAddDocuments = async (docs: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
      }>) => {
        addedMetadata.push(docs[0].metadata);
      };

      const mockVectorStore = {
        similaritySearch: mockSimilaritySearch,
        delete: mockDelete,
        addDocuments: mockAddDocuments,
      };

      await mergeMemory(
        existingId,
        mergedSummary,
        mockVectorStore as any
      );

      // The updated document should preserve metadata
      expect(addedMetadata.length).toBe(1);
      expect(addedMetadata[0].sessionId).toBe(existingMetadata.sessionId);
      expect(addedMetadata[0].turnReferences).toEqual(
        existingMetadata.turnReferences
      );
    });

    test("handles VectorStore errors gracefully", async () => {
      await suppressWarnings(async () => {
        const { mergeMemory } = await import(
          "../../../src/algorithms/memory-actions.ts"
        );

        // Mock VectorStore that throws error
        const mockVectorStoreError = {
          similaritySearch: async () => {
            throw new Error("VectorStore connection failed");
          },
        };

        // Should not throw, errors are caught internally
        let errorThrown = false;
        try {
          await mergeMemory(
            "existing-id",
            "merged summary",
            mockVectorStoreError as any
          );
        } catch {
          errorThrown = true;
        }
        expect(errorThrown).toBe(false);
      });
    });

    test("uses provided existingId in update", async () => {
      const { mergeMemory } = await import(
        "../../../src/algorithms/memory-actions.ts"
      );

      const existingId = "specific-existing-id-789";
      const mergedSummary = "Merged content";

      // Mock similarity search to return the existing document
      const mockSimilaritySearch = async () => {
        return [
          {
            pageContent: "Old content",
            metadata: {
              id: existingId,
              sessionId: "session-123",
              timestamp: Date.now(),
              turnReferences: [0],
            },
          },
        ];
      };

      const deletedIds: string[][] = [];

      // Mock delete to capture deleted IDs
      const mockDelete = async (options: { ids: string[] }) => {
        deletedIds.push(options.ids);
      };

      // Mock addDocuments
      const mockAddDocuments = async () => {};

      const mockVectorStore = {
        similaritySearch: mockSimilaritySearch,
        delete: mockDelete,
        addDocuments: mockAddDocuments,
      };

      await mergeMemory(
        existingId,
        mergedSummary,
        mockVectorStore as any
      );

      expect(deletedIds.length).toBe(1);
      expect(deletedIds[0][0]).toBe(existingId);
    });

    test("uses provided mergedSummary as pageContent", async () => {
      const { mergeMemory } = await import(
        "../../../src/algorithms/memory-actions.ts"
      );

      const existingId = "existing-id";
      const mergedSummary = "This is the merged summary content";

      // Mock similarity search to return the existing document
      const mockSimilaritySearch = async () => {
        return [
          {
            pageContent: "Old content",
            metadata: {
              id: existingId,
              sessionId: "session-123",
              timestamp: Date.now(),
              turnReferences: [0],
            },
          },
        ];
      };

      const addedContent: string[] = [];

      // Mock delete
      const mockDelete = async (_options: { ids: string[] }) => {};

      // Mock addDocuments to capture pageContent
      const mockAddDocuments = async (docs: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
      }>) => {
        addedContent.push(docs[0].pageContent);
      };

      const mockVectorStore = {
        similaritySearch: mockSimilaritySearch,
        delete: mockDelete,
        addDocuments: mockAddDocuments,
      };

      await mergeMemory(
        existingId,
        mergedSummary,
        mockVectorStore as any
      );

      expect(addedContent.length).toBe(1);
      expect(addedContent[0]).toBe(mergedSummary);
    });

    test("does not update when document not found", async () => {
      await suppressWarnings(async () => {
        const { mergeMemory } = await import(
          "../../../src/algorithms/memory-actions.ts"
        );

        const existingId = "non-existent-id";
        const mergedSummary = "This should not be added";

        // Mock similarity search to return empty array
        const mockSimilaritySearch = async () => {
          return [];
        };

        let addDocumentsCalled = false;

        // Mock addDocuments to verify it's not called
        const mockAddDocuments = async () => {
          addDocumentsCalled = true;
        };

        const mockVectorStore = {
          similaritySearch: mockSimilaritySearch,
          delete: async (_options: { ids: string[] }) => {},
          addDocuments: mockAddDocuments,
        };

        await mergeMemory(
          existingId,
          mergedSummary,
          mockVectorStore as any
        );

        expect(addDocumentsCalled).toBe(false);
      });
    });
  });
});
