import type { Document } from "@langchain/core/documents";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";

import type { MemoryEntry, RetrievedMemory } from "@/schemas/index";

/**
 * Interface for document metadata stored in VectorStore
 * Includes rawDialogue to preserve original conversation context
 */
interface MemoryDocumentMetadata {
  id: string;
  sessionId: string;
  turnReferences: number[];
  timestamp: number;
  rawDialogue: string;
  [key: string]: unknown;
}

/**
 * Finds similar memories in the VectorStore for a given new memory.
 *
 * This function implements the similarity search step of Prospective Reflection.
 * It uses the VectorStore to find the Top-K most semantically similar memories
 * to the newly extracted memory, which are then used for merge/add decisions.
 *
 * @param newMemory - The newly extracted MemoryEntry to find similar memories for
 * @param vectorStore - The VectorStore interface for similarity search
 * @param topK - Number of similar memories to retrieve (default: 5)
 * @returns Array of RetrievedMemory objects with relevance scores
 *
 * @example
 * ```typescript
 * const similar = await findSimilarMemories(
 *   newMemory,
 *   vectorStore,
 *   5
 * );
 * ```
 */
export async function findSimilarMemories(
  newMemory: MemoryEntry,
  vectorStore: VectorStoreInterface,
  topK = 5
): Promise<RetrievedMemory[]> {
  try {
    // Use the topicSummary as the query for similarity search
    const query = newMemory.topicSummary;

    // Perform similarity search with the specified topK
    const results = await vectorStore.similaritySearch(query, topK);

    // Convert VectorStore results to RetrievedMemory format
    // Note: embeddings are not returned by VectorStore.similaritySearch
    const retrievedMemories: RetrievedMemory[] = results.map(
      (result: Document) => {
        const metadata = result.metadata as MemoryDocumentMetadata;

        return {
          id: metadata.id,
          topicSummary: result.pageContent,
          rawDialogue: metadata.rawDialogue,
          timestamp: metadata.timestamp,
          sessionId: metadata.sessionId,
          // embedding omitted - not returned by VectorStore.similaritySearch
          turnReferences: metadata.turnReferences || [],
          // relevanceScore: Not available from standard VectorStoreInterface
          // Some implementations return this in metadata or via extended interfaces
          relevanceScore: (result.metadata as { score?: number }).score ?? -1,
        };
      }
    );

    return retrievedMemories;
  } catch (error) {
    // Graceful degradation: return empty array on error
    console.warn(
      "[similarity-search] Error during similarity search, returning empty array:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}
