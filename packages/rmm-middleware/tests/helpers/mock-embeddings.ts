import type { Embeddings } from "@langchain/core/embeddings";

/**
 * Creates a mock Embeddings instance for testing
 *
 * This helper creates mock embeddings that return deterministic
 * vectors of specified dimensions, useful for testing dimension
 * validation and other embedding-dependent functionality.
 *
 * @param dimension - The dimension of vectors to return (default: 1536)
 * @returns Mock Embeddings instance
 *
 * @example
 * ```typescript
 * const mockEmbeddings = createMockEmbeddings(1536);
 * const vector = await mockEmbeddings.embedQuery("test");
 * // vector.length === 1536
 * ```
 */
export function createMockEmbeddings(dimension = 1536): Embeddings {
  return {
    caller: () => "mock-embeddings",
    embedQuery(_text: string): Promise<number[]> {
      return Promise.resolve(new Array(dimension).fill(0));
    },

    embedDocuments(texts: string[]): Promise<number[][]> {
      return Promise.resolve(texts.map(() => new Array(dimension).fill(0)));
    },
  };
}

/**
 * Creates a mock Embeddings instance that can simulate failures
 *
 * This variant allows configuring the mock to throw errors,
 * useful for testing error handling paths.
 *
 * @param shouldFail - Whether embedQuery should throw an error
 * @returns Mock Embeddings instance
 *
 * @example
 * ```typescript
 * const failingEmbeddings = createMockEmbeddingsWithFailure(true);
 * await failingEmbeddings.embedQuery("test"); // throws
 * ```
 */
export function createMockEmbeddingsWithFailure(
  shouldFail = false
): Embeddings {
  return {
    caller: () => "mock-embeddings-failing",
    async embedQuery(_text: string): Promise<number[]> {
      if (shouldFail) {
        const error = new Error("embedQuery failed");
        return await Promise.reject(error);
      }
      return await Promise.resolve(new Array(1536).fill(0));
    },

    async embedDocuments(_texts: string[]): Promise<number[][]> {
      return await Promise.resolve(_texts.map(() => new Array(1536).fill(0)));
    },
  };
}
