import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import type { Document } from "@langchain/core/documents";

import type { MemoryEntry, RetrievedMemory } from "../../schemas/index.js";

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
    // Note: rawDialogue is stored in metadata to preserve original context
    const document: Document = {
      pageContent: memory.topicSummary,
      metadata: {
        id: memory.id,
        sessionId: memory.sessionId,
        timestamp: memory.timestamp,
        turnReferences: memory.turnReferences,
        rawDialogue: memory.rawDialogue,
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
 * @param existingMemory - The existing memory object (MemoryEntry or RetrievedMemory) to update
 * @param mergedSummary - The new merged summary content
 * @param vectorStore - The VectorStore interface for document storage
 * @returns Promise that resolves when the memory is updated
 *
 * @example
 * ```typescript
 * await mergeMemory(existingMemory, "Updated summary content", vectorStore);
 * ```
 */
export async function mergeMemory(
  existingMemory: MemoryEntry | RetrievedMemory,
  mergedSummary: string,
  vectorStore: VectorStoreInterface
): Promise<void> {
  try {
    const existingId = existingMemory.id;

    // Reconstruct metadata from the passed-in memory object.
    // This avoids the unreliable similaritySearch fallback.
    const updatedMetadata = {
      id: existingMemory.id,
      sessionId: existingMemory.sessionId,
      // rawDialogue should be preserved from the memory object
      rawDialogue: (existingMemory as MemoryEntry).rawDialogue || mergedSummary,
      turnReferences: existingMemory.turnReferences,
      timestamp: Date.now(), // Update timestamp on merge
    };

    const updatedDoc: Document = {
      pageContent: mergedSummary,
      metadata: updatedMetadata,
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
