import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import type { Document } from "@langchain/core/documents";

import type { MemoryEntry } from "../../schemas/index.js";

/**
 * Adds a new memory to the VectorStore.
 *
 * This function creates a LangChain Document from the MemoryEntry and adds it
 * to the VectorStore for future similarity search retrieval.
 *
 * @param memory - The MemoryEntry to add to the memory bank
 * @param vectorStore - The VectorStore interface for document storage
 * @returns Promise that resolves when the memory is added
 *
 * @example
 * ```typescript
 * await addMemory(memoryEntry, vectorStore);
 * ```
 */
export async function addMemory(
  memory: MemoryEntry,
  vectorStore: VectorStoreInterface
): Promise<void> {
  try {
    // Create a LangChain Document from the MemoryEntry
    const document: Document = {
      pageContent: memory.topicSummary,
      metadata: {
        id: memory.id,
        sessionId: memory.sessionId,
        timestamp: memory.timestamp,
        turnReferences: memory.turnReferences,
      },
    };

    // Add the document to the VectorStore
    await vectorStore.addDocuments([document]);
  } catch (error) {
    // Graceful degradation: log warning but don't throw
    console.warn(
      "[memory-actions] Error adding memory, continuing:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Merges/updates an existing memory in the VectorStore.
 *
 * This function updates an existing memory entry with new content.
 * The merged summary replaces the old content while preserving metadata.
 *
 * Note: This implementation uses delete+add pattern since VectorStoreInterface
 * doesn't have a direct update method. This may not work with all VectorStore
 * implementations. Some backends (Pinecone, etc.) support upsert which handles
 * this automatically. Others may require custom implementations.
 *
 * @param existingId - The ID of the existing memory to update
 * @param mergedSummary - The new merged summary content
 * @param vectorStore - The VectorStore interface for document storage
 * @returns Promise that resolves when the memory is updated
 *
 * @example
 * ```typescript
 * await mergeMemory("existing-id", "Updated summary content", vectorStore);
 * ```
 */
export async function mergeMemory(
  existingId: string,
  mergedSummary: string,
  vectorStore: VectorStoreInterface
): Promise<void> {
  try {
    // For merge operations, we need to:
    // 1. First retrieve the existing document to get its metadata
    // 2. Update the pageContent with the merged summary
    // 3. Store it back with the same metadata

    // Perform similarity search to find the existing document
    // Note: This is a fallback approach since VectorStoreInterface doesn't
    // provide a direct fetch-by-ID method. If the target document isn't in
    // the top-K results, the merge will silently fail.
    const results = await vectorStore.similaritySearch(mergedSummary, {
      k: 10,
    });

    // Find the document with matching ID
    const existingDoc = results.find(
      (doc) => (doc.metadata as { id: string }).id === existingId
    );

    if (!existingDoc) {
      console.warn(
        `[memory-actions] Could not find existing memory with id: ${existingId} in top-K results, merge skipped`
      );
      return;
    }

    // Update the document with merged content
    const updatedDoc: Document = {
      pageContent: mergedSummary,
      metadata: {
        ...existingDoc.metadata,
        timestamp: Date.now(), // Update timestamp on merge
      },
    };

    // Delete the old document and add the updated one
    // Note: This delete+add pattern may not work with all VectorStore backends.
    // Some implementations don't support delete, or require different signatures.
    if (typeof vectorStore.delete === "function") {
      try {
        await vectorStore.delete({ ids: [existingId] });
      } catch {
        // If delete fails, we still attempt to add - some backends
        // handle ID conflicts by upserting (overwriting) automatically
        console.warn(
          `[memory-actions] Delete failed for memory: ${existingId}, attempting upsert`
        );
      }
    } else {
      console.warn(
        `[memory-actions] VectorStore does not support delete method, merge may create duplicate`
      );
    }

    // Add the updated document (upsert behavior for most VectorStores)
    await vectorStore.addDocuments([updatedDoc]);
  } catch (error) {
    // Graceful degradation: log warning but don't throw
    console.warn(
      "[memory-actions] Error merging memory, continuing:",
      error instanceof Error ? error.message : String(error)
    );
  }
}
