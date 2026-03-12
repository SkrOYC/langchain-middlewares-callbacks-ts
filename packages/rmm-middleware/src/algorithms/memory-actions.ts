import type { Document } from "@langchain/core/documents";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";

import type { MemoryEntry, RetrievedMemory } from "@/schemas/index";
import { getLogger } from "@/utils/logger";

const logger = getLogger("memory-actions");

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
  // Create a LangChain Document from the MemoryEntry
  // Note: rawDialogue is stored in metadata to preserve original context
  const document: Document = {
    pageContent: memory.topicSummary,
    metadata: {
      id: memory.id,
      sessionId: memory.sessionId,
      timestamp: memory.timestamp,
      sessionDate: memory.sessionDate,
      turnReferences: memory.turnReferences,
      rawDialogue: memory.rawDialogue,
    },
  };

  // Add the document to the VectorStore
  // Errors are propagated to allow retry logic at higher levels
  await vectorStore.addDocuments([document]);
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
 * @param newMemory - The newly extracted memory that triggered the merge
 * @param mergedSummary - The new merged summary content
 * @param vectorStore - The VectorStore interface for document storage
 * @returns Promise that resolves when the memory is updated
 *
 * @example
 * ```typescript
 * await mergeMemory(existingMemory, newMemory, "Updated summary content", vectorStore);
 * ```
 */
export async function mergeMemory(
  existingMemory: MemoryEntry | RetrievedMemory,
  newMemory: MemoryEntry,
  mergedSummary: string,
  vectorStore: VectorStoreInterface
): Promise<void> {
  const existingId = existingMemory.id;

  const mergedRawDialogue = mergeRawDialogue(
    existingMemory.rawDialogue,
    newMemory.rawDialogue
  );
  const mergedTurnReferences = mergeTurnReferences(
    existingMemory.turnReferences,
    newMemory.turnReferences
  );

  // Reconstruct metadata from the passed-in memory object.
  // This avoids the unreliable similaritySearch fallback.
  const updatedMetadata = {
    id: existingMemory.id,
    sessionId: existingMemory.sessionId,
    // Preserve the original evidence and append the new evidence so merged
    // summaries remain backed by the full raw dialogue cited at generation time.
    rawDialogue: mergedRawDialogue,
    turnReferences: mergedTurnReferences,
    sessionDate: existingMemory.sessionDate ?? newMemory.sessionDate,
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
      logger.warn(`Delete failed for memory: ${existingId}, attempting upsert`);
    }
  } else {
    logger.warn(
      "VectorStore does not support delete method, merge may create duplicate"
    );
  }

  // Add the updated document (upsert behavior for most VectorStores)
  // Errors are propagated to allow retry logic at higher levels
  await vectorStore.addDocuments([updatedDoc]);
}

function mergeRawDialogue(existingRaw: string, incomingRaw: string): string {
  const normalizedExisting = existingRaw.trim();
  const normalizedIncoming = incomingRaw.trim();

  if (normalizedExisting === "") {
    return normalizedIncoming;
  }
  if (normalizedIncoming === "") {
    return normalizedExisting;
  }

  // Keep merge logic simple and stable: if the incoming evidence block is
  // already present verbatim, do not append it again.
  if (normalizedExisting.includes(normalizedIncoming)) {
    return normalizedExisting;
  }

  return `${normalizedExisting}\n${normalizedIncoming}`;
}

function mergeTurnReferences(
  existingReferences: number[],
  incomingReferences: number[]
): number[] {
  return Array.from(
    new Set([...existingReferences, ...incomingReferences])
  ).sort((left, right) => left - right);
}
