import type { DocumentInterface } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import {
  VectorStore,
  type VectorStoreInterface,
} from "@langchain/core/vectorstores";

export interface InMemoryVectorStoreOptions {
  failSimilaritySearch?: boolean;
  failAddDocuments?: boolean;
}

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

class InMemoryVectorStore extends VectorStore {
  private readonly documents: DocumentInterface[] = [];
  private readonly vectors: number[][] = [];
  private readonly failSimilaritySearch: boolean;
  private readonly failAddDocuments: boolean;

  constructor(
    embeddings: EmbeddingsInterface,
    options: InMemoryVectorStoreOptions = {}
  ) {
    super(embeddings, {});
    this.failSimilaritySearch = options.failSimilaritySearch ?? false;
    this.failAddDocuments = options.failAddDocuments ?? false;
  }

  _vectorstoreType(): string {
    return "in-memory";
  }

  addVectors(
    vectors: number[][],
    documents: DocumentInterface[]
  ): Promise<string[]> {
    if (this.failAddDocuments) {
      throw new Error("Simulated addDocuments failure (for error testing)");
    }

    this.vectors.push(...vectors);
    this.documents.push(...documents);

    const startId = this.documents.length - documents.length;
    return Promise.resolve(documents.map((_, i) => `doc-${startId + i}`));
  }

  async addDocuments(documents: DocumentInterface[]): Promise<string[]> {
    if (this.failAddDocuments) {
      throw new Error("Simulated addDocuments failure (for error testing)");
    }

    const vectors = await this.embeddings.embedDocuments(
      documents.map((d) => d.pageContent)
    );

    return this.addVectors(vectors, documents);
  }

  similaritySearchVectorWithScore(
    query: number[],
    k: number
  ): Promise<[DocumentInterface, number][]> {
    if (this.failSimilaritySearch) {
      throw new Error("Simulated similaritySearch failure (for error testing)");
    }

    if (this.documents.length === 0) {
      return Promise.resolve([]);
    }

    const scored = this.documents
      .map((document, index) => {
        const vector = this.vectors[index];
        if (!vector) {
          return null;
        }

        return [document, cosineSimilarity(query, vector)] as [
          DocumentInterface,
          number,
        ];
      })
      .filter((entry): entry is [DocumentInterface, number] => entry !== null)
      .sort((a, b) => b[1] - a[1]);

    return Promise.resolve(scored.slice(0, k));
  }
}

export function createInMemoryVectorStore(
  embeddings: EmbeddingsInterface,
  options: InMemoryVectorStoreOptions = {}
): VectorStoreInterface {
  return new InMemoryVectorStore(embeddings, options);
}
