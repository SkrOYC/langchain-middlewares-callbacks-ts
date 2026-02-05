import { describe, expect, test } from "bun:test";
import { createMockEmbeddings } from "@/tests/helpers/mock-embeddings";

/**
 * Tests for wrapModelCall hook embedding dimension validation
 *
 * These tests verify that dimension mismatch throws ConfigurationError:
 * 1. Mismatched dimension in wrapModelCall → throws ConfigurationError
 * 2. Valid dimension → initializes successfully
 */

describe("wrapModelCall Hook Dimension Validation", () => {
  test("should throw ConfigurationError when embeddings dimension is too small", async () => {
    const dimensionTooSmall = 512;

    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const wrongDimensionEmbeddings = createMockEmbeddings(dimensionTooSmall);

    const middleware = createRetrospectiveWrapModelCall({
      embeddings: wrongDimensionEmbeddings,
    });

    // Create a mock handler
    const mockHandler = async () =>
      ({
        content: "Response",
        text: "Response",
      }) satisfies { content: string; text: string };

    const request = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Hello" },
          lc_id: ["human"],
          content: "Hello",
          additional_kwargs: {},
        },
      ],
      state: {
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
        _retrievedMemories: Array.from({ length: 5 }, (_, i) => ({
          id: `memory-${i}`,
          topicSummary: `Topic ${i}`,
          rawDialogue: `Dialogue ${i}`,
          timestamp: Date.now(),
          sessionId: "session-1",
          turnReferences: [1],
          relevanceScore: 1.0,
          embedding: new Array(512).fill(0),
        })),
        _citations: [],
        _turnCountInSession: 1,
      },
      runtime: {
        context: {},
      },
    };

    await expect(
      middleware.wrapModelCall(request, mockHandler)
    ).rejects.toThrow("Embedding dimension mismatch");
  });

  test("should throw ConfigurationError when embeddings dimension is too large", async () => {
    const dimensionTooLarge = 2048;

    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const wrongDimensionEmbeddings = createMockEmbeddings(dimensionTooLarge);

    const middleware = createRetrospectiveWrapModelCall({
      embeddings: wrongDimensionEmbeddings,
    });

    // Create a mock handler
    const mockHandler = async () =>
      ({
        content: "Response",
        text: "Response",
      }) satisfies { content: string; text: string };

    const request = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Hello" },
          lc_id: ["human"],
          content: "Hello",
          additional_kwargs: {},
        },
      ],
      state: {
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
        _retrievedMemories: Array.from({ length: 5 }, (_, i) => ({
          id: `memory-${i}`,
          topicSummary: `Topic ${i}`,
          rawDialogue: `Dialogue ${i}`,
          timestamp: Date.now(),
          sessionId: "session-1",
          turnReferences: [1],
          relevanceScore: 1.0,
          embedding: new Array(2048).fill(0),
        })),
        _citations: [],
        _turnCountInSession: 1,
      },
      runtime: {
        context: {},
      },
    };

    await expect(
      middleware.wrapModelCall(request, mockHandler)
    ).rejects.toThrow("Embedding dimension mismatch");
  });

  test("should throw ConfigurationError with expected 1536 dimension in error message", async () => {
    const wrongDimension = 512;

    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const wrongDimensionEmbeddings = createMockEmbeddings(wrongDimension);

    const middleware = createRetrospectiveWrapModelCall({
      embeddings: wrongDimensionEmbeddings,
    });

    // Create a mock handler
    const mockHandler = async () =>
      ({
        content: "Response",
        text: "Response",
      }) satisfies { content: string; text: string };

    const request = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Hello" },
          lc_id: ["human"],
          content: "Hello",
          additional_kwargs: {},
        },
      ],
      state: {
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
        _retrievedMemories: Array.from({ length: 5 }, (_, i) => ({
          id: `memory-${i}`,
          topicSummary: `Topic ${i}`,
          rawDialogue: `Dialogue ${i}`,
          timestamp: Date.now(),
          sessionId: "session-1",
          turnReferences: [1],
          relevanceScore: 1.0,
          embedding: new Array(512).fill(0),
        })),
        _citations: [],
        _turnCountInSession: 1,
      },
      runtime: {
        context: {},
      },
    };

    await expect(
      middleware.wrapModelCall(request, mockHandler)
    ).rejects.toThrow("1536");
  });

  test("should throw ConfigurationError when actual dimension is included in error message", async () => {
    const wrongDimension = 2048;

    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const wrongDimensionEmbeddings = createMockEmbeddings(wrongDimension);

    const middleware = createRetrospectiveWrapModelCall({
      embeddings: wrongDimensionEmbeddings,
    });

    // Create a mock handler
    const mockHandler = async () =>
      ({
        content: "Response",
        text: "Response",
      }) satisfies { content: string; text: string };

    const request = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Hello" },
          lc_id: ["human"],
          content: "Hello",
          additional_kwargs: {},
        },
      ],
      state: {
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
        _retrievedMemories: Array.from({ length: 5 }, (_, i) => ({
          id: `memory-${i}`,
          topicSummary: `Topic ${i}`,
          rawDialogue: `Dialogue ${i}`,
          timestamp: Date.now(),
          sessionId: "session-1",
          turnReferences: [1],
          relevanceScore: 1.0,
          embedding: new Array(2048).fill(0),
        })),
        _citations: [],
        _turnCountInSession: 1,
      },
      runtime: {
        context: {},
      },
    };

    await expect(
      middleware.wrapModelCall(request, mockHandler)
    ).rejects.toThrow("2048");
  });

  test("should initialize successfully with correct 1536 dimension", async () => {
    const correctDimension = 1536;

    const { createRetrospectiveWrapModelCall } = await import(
      "@/middleware/hooks/wrap-model-call"
    );

    const correctDimensionEmbeddings = createMockEmbeddings(correctDimension);

    const middleware = createRetrospectiveWrapModelCall({
      embeddings: correctDimensionEmbeddings,
    });

    // Create a mock handler
    const mockHandler = async () =>
      ({
        content: "Response",
        text: "Response",
      }) satisfies { content: string; text: string };

    const request = {
      messages: [],
      state: {
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
        _retrievedMemories: Array.from({ length: 5 }, (_, i) => ({
          id: `memory-${i}`,
          topicSummary: `Topic ${i}`,
          rawDialogue: `Dialogue ${i}`,
          timestamp: Date.now(),
          sessionId: "session-1",
          turnReferences: [1],
          relevanceScore: 1.0,
          embedding: new Array(1536).fill(0),
        })),
        _citations: [],
        _turnCountInSession: 1,
      },
      runtime: {
        context: {},
      },
    };

    await expect(
      middleware.wrapModelCall(request, mockHandler)
    ).resolves.toBeDefined();
  });
});
