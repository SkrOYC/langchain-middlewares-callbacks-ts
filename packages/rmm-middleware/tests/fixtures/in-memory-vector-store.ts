import type { Document } from "@langchain/core/documents";
import type { Embeddings } from "@langchain/core/embeddings";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";

/**
 * Options for creating an InMemoryVectorStore with failure simulation
 */
export interface InMemoryVectorStoreOptions {
  /**
   * If true, similaritySearch will throw an error (for error testing)
   * @default false
   */
  failSimilaritySearch?: boolean;

  /**
   * If true, addDocuments will throw an error (for error testing)
   * @default false
   */
  failAddDocuments?: boolean;
}

/**
 * In-memory implementation of VectorStoreInterface for testing
 *
 * This implementation:
 * - Stores documents and their embeddings in-memory
 * - Computes cosine similarity for retrieval
 * - Supports failure simulation for error testing
 * - Is NOT intended for production use
 *
 * @param embeddings - Embeddings instance for encoding queries/documents
 * @param options - Optional configuration for failure simulation
 * @returns VectorStoreInterface implementation
 *
 * @example
 * ```typescript
 * const vectorStore = createInMemoryVectorStore(embeddings);
 * await vectorStore.addDocuments(documents);
 * const results = await vectorStore.similaritySearch("query", 5);
 * ```
 */
export function createInMemoryVectorStore(
  embeddings: Embeddings,
  options: InMemoryVectorStoreOptions = {}
): VectorStoreInterface {
  const { failSimilaritySearch = false, failAddDocuments = false } = options;

  const documents: Document[] = [];
  const vectors: number[][] = [];

  /**
   * Computes cosine similarity between two vectors
   */
  function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vector dimensions must match");
    }

    const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] ?? 0), 0);
    const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  // Helper to create serializable
  function createSerializable() {
    return {
      lc_namespace: ["langchain", "vectorstores", "in-memory"],
      lc_serializable: false,
      lc_kwargs: {},
      lc_attributes: {},
    };
  }

  return {
    /**
     * Adds documents to the in-memory store
     */
    async addDocuments(docs: Document[]): Promise<string[] | undefined> {
      if (failAddDocuments) {
        throw new Error("Simulated addDocuments failure (for error testing)");
      }

      const newVectors = await embeddings.embedDocuments(
        docs.map((d) => d.pageContent)
      );

      // Ensure newVectors is an array of vectors
      if (!Array.isArray(newVectors)) {
        console.warn(
          "[InMemoryVectorStore] embedDocuments returned non-array, skipping documents"
        );
        return undefined;
      }

      documents.push(...docs);
      vectors.push(...newVectors);

      // Return document IDs (using index as ID)
      const startId = documents.length - docs.length;
      return docs.map((_, i) => `doc-${startId + i}`);
    },

    /**
     * Searches for similar documents based on query embedding
     */
    async similaritySearch(query: string, k: number): Promise<Document[]> {
      if (failSimilaritySearch) {
        throw new Error(
          "Simulated similaritySearch failure (for error testing)"
        );
      }

      if (documents.length === 0) {
        return [];
      }

      const queryVector = await embeddings.embedQuery(query);

      // Compute similarity scores
      const scoredDocs = documents
        .map((doc, index) => {
          const vector = vectors[index];
          if (!vector) {
            return null;
          }
          return {
            doc,
            similarity: cosineSimilarity(queryVector, vector),
          };
        })
        .filter(
          (item): item is { doc: Document; similarity: number } => item !== null
        );

      // Sort by similarity (descending)
      scoredDocs.sort((a, b) => b.similarity - a.similarity);

      // Return top k documents
      return scoredDocs.slice(0, k).map((item) => item.doc);
    },

    /**
     * Not implemented - throws error if called
     */
    similaritySearchWithScore(): Promise<[Document, number][]> {
      throw new Error(
        "similaritySearchWithScore not implemented in InMemoryVectorStore"
      );
    },

    /**
     * Not implemented - throws error if called
     */
    addVectors(): Promise<string[] | undefined> {
      throw new Error("addVectors not implemented in InMemoryVectorStore");
    },

    /**
     * Not implemented - throws error if called
     */
    delete(): Promise<void> {
      throw new Error("delete not implemented in InMemoryVectorStore");
    },

    // Required properties for VectorStoreInterface
    embeddings,
    _vectorstoreType(): string {
      return "in-memory";
    },
    FilterType: {} as never,
    similaritySearchVectorWithScore(): Promise<[Document, number][]> {
      throw new Error("similaritySearchVectorWithScore not implemented");
    },

    // Serialization
    ...createSerializable(),

    // asRetriever method
    asRetriever(k?: number) {
      return {
        vectorStore: this,
        k,
        invoke: (query: string) => {
          return this.similaritySearch(query, k ?? 4);
        },
      };
    },

    // Serialization methods
    toJSON() {
      return {
        ...createSerializable(),
      };
    },

    toJSONNotImplemented() {
      return {
        ...createSerializable(),
      };
    },
  };
}
