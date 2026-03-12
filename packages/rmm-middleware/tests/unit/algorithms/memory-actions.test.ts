import { describe, expect, test } from "bun:test";

/**
 * Tests for memory action functions (addMemory and mergeMemory)
 *
 * These tests verify that:
 * 1. addMemory adds documents to VectorStore correctly
 * 2. mergeMemory updates existing documents in VectorStore
 */

describe("Memory Actions", () => {
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

  const createIncomingMemory = (overrides: Record<string, unknown> = {}) => ({
    id: "new-memory-123",
    topicSummary: "User enjoys mountain trails",
    rawDialogue: "* Speaker 1: I hiked a new trail yesterday.",
    timestamp: Date.now(),
    sessionId: "session-789",
    embedding: [],
    turnReferences: [1, 2],
    ...overrides,
  });

  describe("addMemory", () => {
    test("should export addMemory function", async () => {
      const { addMemory } = await import("@/algorithms/memory-actions");
      expect(typeof addMemory).toBe("function");
    });

    test("adds document to VectorStore", async () => {
      const { addMemory } = await import("@/algorithms/memory-actions");

      const addedDocuments: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
      }> = [];

      // Mock VectorStore that captures added documents
      const mockVectorStore = {
        addDocuments: (
          docs: Array<{
            pageContent: string;
            metadata: Record<string, unknown>;
          }>
        ) => {
          addedDocuments.push(...docs);
        },
      };

      await addMemory(sampleMemory as any, mockVectorStore as any);

      expect(addedDocuments.length).toBe(1);
      const firstDoc = addedDocuments[0];
      expect(firstDoc?.pageContent).toBe(sampleMemory.topicSummary);
    });

    test("includes correct metadata in document", async () => {
      const { addMemory } = await import("@/algorithms/memory-actions");

      const addedDocuments: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
      }> = [];

      const mockVectorStore = {
        addDocuments: (
          docs: Array<{
            pageContent: string;
            metadata: Record<string, unknown>;
          }>
        ) => {
          addedDocuments.push(...docs);
        },
      };

      await addMemory(sampleMemory as any, mockVectorStore as any);

      expect(addedDocuments.length).toBe(1);
      const metadata = addedDocuments[0]?.metadata;
      expect(metadata?.id).toBe(sampleMemory.id);
      expect(metadata?.sessionId).toBe(sampleMemory.sessionId);
      expect(metadata?.timestamp).toBe(sampleMemory.timestamp);
      expect(metadata?.turnReferences).toEqual(sampleMemory.turnReferences);
    });

    test("propagates VectorStore errors for retry handling", async () => {
      const { addMemory } = await import("@/algorithms/memory-actions");

      // Mock VectorStore that throws error
      const mockVectorStoreError = {
        addDocuments: () => {
          throw new Error("VectorStore connection failed");
        },
      };

      // Errors should propagate to allow retry logic at higher levels
      await expect(
        addMemory(sampleMemory as any, mockVectorStoreError as any)
      ).rejects.toThrow("VectorStore connection failed");
    });

    test("creates document with topicSummary as pageContent", async () => {
      const { addMemory } = await import("@/algorithms/memory-actions");

      const addedDocuments: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
      }> = [];

      const mockVectorStore = {
        addDocuments: (
          docs: Array<{
            pageContent: string;
            metadata: Record<string, unknown>;
          }>
        ) => {
          addedDocuments.push(...docs);
        },
      };

      await addMemory(sampleMemory as any, mockVectorStore as any);

      const firstDoc = addedDocuments[0];
      expect(firstDoc?.pageContent).toBe(sampleMemory.topicSummary);
    });
  });

  describe("mergeMemory", () => {
    test("should export mergeMemory function", async () => {
      const { mergeMemory } = await import("@/algorithms/memory-actions");
      expect(typeof mergeMemory).toBe("function");
    });

    test("updates existing document in VectorStore", async () => {
      const { mergeMemory } = await import("@/algorithms/memory-actions");

      const existingId = "existing-memory-456";
      const mergedSummary = "User enjoys outdoor activities including hiking";

      // Create existing memory object
      const existingMemory = {
        id: existingId,
        topicSummary: "Old content",
        rawDialogue: "* Speaker 1: Original dialogue",
        timestamp: Date.now() - 100_000,
        sessionId: "session-123",
        embedding: [],
        turnReferences: [0],
      };
      const newMemory = createIncomingMemory();

      const addedDocuments: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
      }> = [];

      // Mock delete
      const mockDelete = (_options: { ids: string[] }) => {
        // intentionally empty mock
      };

      // Mock addDocuments to capture added documents
      const mockAddDocuments = (
        docs: Array<{
          pageContent: string;
          metadata: Record<string, unknown>;
        }>
      ) => {
        addedDocuments.push(...docs);
      };

      const mockVectorStore = {
        delete: mockDelete,
        addDocuments: mockAddDocuments,
      };

      await mergeMemory(
        existingMemory,
        newMemory as any,
        mergedSummary,
        mockVectorStore as any
      );

      expect(addedDocuments.length).toBe(1);
      const firstDoc = addedDocuments[0];
      expect(firstDoc?.pageContent).toBe(mergedSummary);
    });

    test("includes existing metadata in updated document", async () => {
      const { mergeMemory } = await import("@/algorithms/memory-actions");

      const existingId = "existing-memory-456";
      const existingMetadata = {
        id: existingId,
        sessionId: "session-123",
        timestamp: Date.now() - 100_000,
        turnReferences: [0],
        rawDialogue: "* Speaker 1: Original dialogue",
      };
      const mergedSummary = "Updated summary";

      // Create a memory object with the existing data
      const existingMemory = {
        id: existingId,
        topicSummary: "Old content",
        rawDialogue: "* Speaker 1: Original dialogue",
        timestamp: existingMetadata.timestamp,
        sessionId: "session-123",
        embedding: [],
        turnReferences: [0],
      };
      const newMemory = createIncomingMemory();

      // similaritySearch is no longer used - keeping for reference only
      const mockSimilaritySearch = () => {
        return [
          {
            pageContent: "Old content",
            metadata: existingMetadata,
          },
        ];
      };

      const addedMetadata: Record<string, unknown>[] = [];

      // Mock delete
      const mockDelete = (_options: { ids: string[] }) => {
        // intentionally empty mock
      };

      // Mock addDocuments to capture metadata
      const mockAddDocuments = (
        docs: Array<{
          pageContent: string;
          metadata: Record<string, unknown>;
        }>
      ) => {
        const firstDoc = docs[0];
        if (firstDoc) {
          addedMetadata.push(firstDoc.metadata);
        }
      };

      const mockVectorStore = {
        similaritySearch: mockSimilaritySearch,
        delete: mockDelete,
        addDocuments: mockAddDocuments,
      };

      await mergeMemory(
        existingMemory,
        newMemory as any,
        mergedSummary,
        mockVectorStore as any
      );

      // The updated document should preserve existing metadata while appending
      // the new evidence used to justify the merge.
      expect(addedMetadata.length).toBe(1);
      const firstMetadata = addedMetadata[0];
      expect(firstMetadata?.sessionId).toBe(existingMetadata.sessionId);
      expect(firstMetadata?.turnReferences).toEqual([0, 1, 2]);
      expect(firstMetadata?.rawDialogue).toBe(
        [existingMemory.rawDialogue, newMemory.rawDialogue].join("\n")
      );
    });

    test("propagates VectorStore errors for retry handling", async () => {
      const { mergeMemory } = await import("@/algorithms/memory-actions");

      // Create a memory object
      const existingMemory = {
        id: "existing-id",
        topicSummary: "Old content",
        rawDialogue: "Test raw dialogue",
        timestamp: Date.now(),
        sessionId: "session-123",
        embedding: [],
        turnReferences: [0],
      };
      const newMemory = createIncomingMemory();

      // Mock VectorStore that throws error on addDocuments
      const mockVectorStoreError = {
        addDocuments: () => {
          throw new Error("VectorStore connection failed");
        },
        delete: () => {
          // intentionally empty mock
        },
      };

      // Errors should propagate to allow retry logic at higher levels
      await expect(
        mergeMemory(
          existingMemory,
          newMemory as any,
          "merged summary",
          mockVectorStoreError as any
        )
      ).rejects.toThrow("VectorStore connection failed");
    });

    test("uses provided existingId in update", async () => {
      const { mergeMemory } = await import("@/algorithms/memory-actions");

      const existingId = "specific-existing-id-789";
      const mergedSummary = "Merged content";

      // Create existing memory object
      const existingMemory = {
        id: existingId,
        topicSummary: "Old content",
        rawDialogue: "Test raw dialogue",
        timestamp: Date.now(),
        sessionId: "session-123",
        embedding: [],
        turnReferences: [0],
      };
      const newMemory = createIncomingMemory();

      const deletedIds: string[][] = [];

      // Mock delete to capture deleted IDs
      const mockDelete = (options: { ids: string[] }) => {
        deletedIds.push(options.ids);
      };

      // Mock addDocuments
      const mockAddDocuments = () => {
        // intentionally empty mock
      };

      // similaritySearch is no longer used - pass the full memory object
      const mockSimilaritySearch = () => {
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

      const mockVectorStore = {
        similaritySearch: mockSimilaritySearch,
        delete: mockDelete,
        addDocuments: mockAddDocuments,
      };

      await mergeMemory(
        existingMemory,
        newMemory as any,
        mergedSummary,
        mockVectorStore as any
      );

      expect(deletedIds.length).toBe(1);
      expect(deletedIds[0]?.[0]).toBe(existingId);
    });

    test("uses provided mergedSummary as pageContent", async () => {
      const { mergeMemory } = await import("@/algorithms/memory-actions");

      const existingId = "existing-id";
      const mergedSummary = "This is the merged summary content";

      // Create existing memory object
      const existingMemory = {
        id: existingId,
        topicSummary: "Old content",
        rawDialogue: "Test raw dialogue",
        timestamp: Date.now(),
        sessionId: "session-123",
        embedding: [],
        turnReferences: [0],
      };
      const newMemory = createIncomingMemory();

      const addedContent: string[] = [];

      // Mock delete
      const mockDelete = (_options: { ids: string[] }) => {
        // intentionally empty mock
      };

      // Mock addDocuments to capture pageContent
      const mockAddDocuments = (
        docs: Array<{
          pageContent: string;
          metadata: Record<string, unknown>;
        }>
      ) => {
        const firstDoc = docs[0];
        if (firstDoc) {
          addedContent.push(firstDoc.pageContent);
        }
      };

      const mockVectorStore = {
        delete: mockDelete,
        addDocuments: mockAddDocuments,
      };

      await mergeMemory(
        existingMemory,
        newMemory as any,
        mergedSummary,
        mockVectorStore as any
      );

      expect(addedContent.length).toBe(1);
      expect(addedContent[0]).toBe(mergedSummary);
    });

    test("always merges when memory object is provided", async () => {
      const { mergeMemory } = await import("@/algorithms/memory-actions");

      // Create a memory object to merge
      const existingMemory = {
        id: "memory-to-merge",
        topicSummary: "Original summary",
        rawDialogue: "Original raw dialogue",
        timestamp: Date.now(),
        sessionId: "session-123",
        embedding: [],
        turnReferences: [0],
      };
      const newMemory = createIncomingMemory({
        rawDialogue: "Fresh raw dialogue",
        turnReferences: [3],
      });

      const mergedSummary = "Updated summary content";

      let addDocumentsCalled = false;
      const addedContent: string[] = [];

      // Mock addDocuments to verify it's called with merged content
      const mockAddDocuments = (
        docs: Array<{
          pageContent: string;
          metadata: Record<string, unknown>;
        }>
      ) => {
        addDocumentsCalled = true;
        const firstDoc = docs[0];
        if (firstDoc) {
          addedContent.push(firstDoc.pageContent);
        }
      };

      const mockDelete = (_options: { ids: string[] }) => {
        // intentionally empty mock
      };

      const mockVectorStore = {
        delete: mockDelete,
        addDocuments: mockAddDocuments,
      };

      await mergeMemory(
        existingMemory,
        newMemory as any,
        mergedSummary,
        mockVectorStore as any
      );

      // With the new signature, we always merge when given a memory object
      expect(addDocumentsCalled).toBe(true);
      expect(addedContent[0]).toBe(mergedSummary);
    });

    test("deduplicates repeated raw dialogue blocks and turn references", async () => {
      const { mergeMemory } = await import("@/algorithms/memory-actions");

      const existingMemory = {
        id: "memory-dedupe",
        topicSummary: "Original summary",
        rawDialogue: "* Speaker 1: I run every morning.",
        timestamp: Date.now(),
        sessionId: "session-123",
        embedding: [],
        turnReferences: [0, 1],
      };
      const newMemory = createIncomingMemory({
        rawDialogue: "* Speaker 1: I run every morning.",
        turnReferences: [1, 2],
      });

      const addedDocuments: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
      }> = [];

      const mockVectorStore = {
        delete: (_options: { ids: string[] }) => {
          // intentionally empty mock
        },
        addDocuments: (
          docs: Array<{
            pageContent: string;
            metadata: Record<string, unknown>;
          }>
        ) => {
          addedDocuments.push(...docs);
        },
      };

      await mergeMemory(
        existingMemory as any,
        newMemory as any,
        "Merged summary",
        mockVectorStore as any
      );

      const metadata = addedDocuments[0]?.metadata;
      expect(metadata?.rawDialogue).toBe(existingMemory.rawDialogue);
      expect(metadata?.turnReferences).toEqual([0, 1, 2]);
    });
  });
});
