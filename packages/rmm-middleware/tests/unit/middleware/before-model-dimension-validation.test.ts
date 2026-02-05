import { describe, expect, test } from "bun:test";
import { createMockEmbeddings } from "@/tests/helpers/mock-embeddings";

/**
 * Tests for beforeModel hook embedding dimension validation
 *
 * These tests verify that dimension mismatch throws ConfigurationError:
 * 1. Mismatched dimension in beforeModel → throws ConfigurationError
 * 2. Valid dimension → initializes successfully
 */

describe("beforeModel Hook Dimension Validation", () => {
  test("should throw ConfigurationError when embeddings dimension is too small", async () => {
    const dimensionTooSmall = 512;

    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const wrongDimensionEmbeddings = createMockEmbeddings(dimensionTooSmall);
    const mockVectorStore = {
      async similaritySearch(_query: string, _k: number) {
        return await Promise.resolve([]);
      },
    };

    const middleware = createRetrospectiveBeforeModel({
      vectorStore: mockVectorStore,
      embeddings: wrongDimensionEmbeddings,
      topK: 20,
    });

    const state = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Hello" },
          lc_id: ["human"],
          content: "Hello",
          additional_kwargs: {},
        },
      ],
      _rerankerWeights: {
        weights: {
          queryTransform: Array.from({ length: 1536 }, () =>
            Array.from({ length: 1536 }, () => 0.01)
          ),
          memoryTransform: Array.from({ length: 1536 }, () =>
            Array.from({ length: 1536 }, () => 0.01)
          ),
        },
        config: {
          topK: 20,
          topM: 5,
          temperature: 0.5,
          learningRate: 0.001,
          baseline: 0.5,
        },
      },
      _retrievedMemories: [],
      _citations: [],
      _turnCountInSession: 0,
    };

    await expect(
      middleware.beforeModel(state, { context: {} })
    ).rejects.toThrow("Embedding dimension mismatch");
  });

  test("should throw ConfigurationError when embeddings dimension is too large", async () => {
    const dimensionTooLarge = 2048;

    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const wrongDimensionEmbeddings = createMockEmbeddings(dimensionTooLarge);
    const mockVectorStore = {
      async similaritySearch(_query: string, _k: number) {
        return await Promise.resolve([]);
      },
    };

    const middleware = createRetrospectiveBeforeModel({
      vectorStore: mockVectorStore,
      embeddings: wrongDimensionEmbeddings,
      topK: 20,
    });

    const state = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Hello" },
          lc_id: ["human"],
          content: "Hello",
          additional_kwargs: {},
        },
      ],
      _rerankerWeights: {
        weights: {
          queryTransform: Array.from({ length: 1536 }, () =>
            Array.from({ length: 1536 }, () => 0.01)
          ),
          memoryTransform: Array.from({ length: 1536 }, () =>
            Array.from({ length: 1536 }, () => 0.01)
          ),
        },
        config: {
          topK: 20,
          topM: 5,
          temperature: 0.5,
          learningRate: 0.001,
          baseline: 0.5,
        },
      },
      _retrievedMemories: [],
      _citations: [],
      _turnCountInSession: 0,
    };

    await expect(
      middleware.beforeModel(state, { context: {} })
    ).rejects.toThrow("Embedding dimension mismatch");
  });

  test("should throw ConfigurationError with expected 1536 dimension in error message", async () => {
    const wrongDimension = 512;

    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const wrongDimensionEmbeddings = createMockEmbeddings(wrongDimension);
    const mockVectorStore = {
      async similaritySearch(_query: string, _k: number) {
        return await Promise.resolve([]);
      },
    };

    const middleware = createRetrospectiveBeforeModel({
      vectorStore: mockVectorStore,
      embeddings: wrongDimensionEmbeddings,
      topK: 20,
    });

    const state = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Hello" },
          lc_id: ["human"],
          content: "Hello",
          additional_kwargs: {},
        },
      ],
      _rerankerWeights: {
        weights: {
          queryTransform: Array.from({ length: 1536 }, () =>
            Array.from({ length: 1536 }, () => 0.01)
          ),
          memoryTransform: Array.from({ length: 1536 }, () =>
            Array.from({ length: 1536 }, () => 0.01)
          ),
        },
        config: {
          topK: 20,
          topM: 5,
          temperature: 0.5,
          learningRate: 0.001,
          baseline: 0.5,
        },
      },
      _retrievedMemories: [],
      _citations: [],
      _turnCountInSession: 0,
    };

    await expect(
      middleware.beforeModel(state, { context: {} })
    ).rejects.toThrow("1536");
  });

  test("should throw ConfigurationError when actual dimension is included in error message", async () => {
    const wrongDimension = 2048;

    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const wrongDimensionEmbeddings = createMockEmbeddings(wrongDimension);
    const mockVectorStore = {
      async similaritySearch(_query: string, _k: number) {
        return await Promise.resolve([]);
      },
    };

    const middleware = createRetrospectiveBeforeModel({
      vectorStore: mockVectorStore,
      embeddings: wrongDimensionEmbeddings,
      topK: 20,
    });

    const state = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Hello" },
          lc_id: ["human"],
          content: "Hello",
          additional_kwargs: {},
        },
      ],
      _rerankerWeights: {
        weights: {
          queryTransform: Array.from({ length: 1536 }, () =>
            Array.from({ length: 1536 }, () => 0.01)
          ),
          memoryTransform: Array.from({ length: 1536 }, () =>
            Array.from({ length: 1536 }, () => 0.01)
          ),
        },
        config: {
          topK: 20,
          topM: 5,
          temperature: 0.5,
          learningRate: 0.001,
          baseline: 0.5,
        },
      },
      _retrievedMemories: [],
      _citations: [],
      _turnCountInSession: 0,
    };

    await expect(
      middleware.beforeModel(state, { context: {} })
    ).rejects.toThrow("2048");
  });

  test("should initialize successfully with correct 1536 dimension", async () => {
    const correctDimension = 1536;

    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const correctDimensionEmbeddings = createMockEmbeddings(correctDimension);
    const mockVectorStore = {
      async similaritySearch(_query: string, _k: number) {
        return await Promise.resolve([]);
      },
    };

    const middleware = createRetrospectiveBeforeModel({
      vectorStore: mockVectorStore,
      embeddings: correctDimensionEmbeddings,
      topK: 20,
    });

    const state = {
      messages: [],
      _rerankerWeights: {
        weights: {
          queryTransform: Array.from({ length: 1536 }, () =>
            Array.from({ length: 1536 }, () => 0.01)
          ),
          memoryTransform: Array.from({ length: 1536 }, () =>
            Array.from({ length: 1536 }, () => 0.01)
          ),
        },
        config: {
          topK: 20,
          topM: 5,
          temperature: 0.5,
          learningRate: 0.001,
          baseline: 0.5,
        },
      },
      _retrievedMemories: [],
      _citations: [],
      _turnCountInSession: 0,
    };

    await expect(
      middleware.beforeModel(state, { context: {} })
    ).resolves.toBeDefined();
  });

  test("should validate only once across multiple calls", async () => {
    const { createRetrospectiveBeforeModel } = await import(
      "@/middleware/hooks/before-model"
    );

    const correctDimensionEmbeddings = createMockEmbeddings(1536);

    // Track how many times validation is called
    let validationCount = 0;
    const originalEmbedQuery = correctDimensionEmbeddings.embedQuery;
    correctDimensionEmbeddings.embedQuery = async (text: string) => {
      validationCount++;
      return await originalEmbedQuery(text);
    };

    const mockVectorStore = {
      async similaritySearch(_query: string, _k: number) {
        return await Promise.resolve([]);
      },
    };

    const middleware = createRetrospectiveBeforeModel({
      vectorStore: mockVectorStore,
      embeddings: correctDimensionEmbeddings,
      topK: 20,
    });

    const state = {
      messages: [],
      _rerankerWeights: {
        weights: {
          queryTransform: Array.from({ length: 1536 }, () =>
            Array.from({ length: 1536 }, () => 0.01)
          ),
          memoryTransform: Array.from({ length: 1536 }, () =>
            Array.from({ length: 1536 }, () => 0.01)
          ),
        },
        config: {
          topK: 20,
          topM: 5,
          temperature: 0.5,
          learningRate: 0.001,
          baseline: 0.5,
        },
      },
      _retrievedMemories: [],
      _citations: [],
      _turnCountInSession: 0,
    };

    // Call hook multiple times
    await middleware.beforeModel(state, { context: {} });
    await middleware.beforeModel(state, { context: {} });
    await middleware.beforeModel(state, { context: {} });

    // Validation should only happen once (on first call)
    expect(validationCount).toBe(1);
  });
});
