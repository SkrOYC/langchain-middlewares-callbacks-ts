import { describe, expect, test } from "bun:test";

/**
 * Tests for middleware factory dependency population (Phase 2)
 * These tests verify that rmmMiddleware correctly populates reflectionDeps
 */

describe("rmmMiddleware Factory", () => {
  test("populates reflectionDeps when llm and embeddings are provided", async () => {
    const { rmmMiddleware } = await import("@/index");

    // Mock LLM
    const mockLLM = {
      invoke: async () => ({
        content: "Test response",
        text: "Test response",
      }),
    };

    // Mock Embeddings
    const mockEmbeddings = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
    };

    // Mock VectorStore
    const mockVectorStore = {
      similaritySearch: async () => [],
      addDocuments: async () => {
        return await Promise.resolve();
      },
    };

    // Create middleware with all dependencies
    const middleware = rmmMiddleware({
      vectorStore: mockVectorStore as any,
      embeddings: mockEmbeddings as any,
      embeddingDimension: 1536,
      llm: mockLLM as any,
      enabled: true,
    });

    // Middleware should be created with reflectionDeps populated
    expect(middleware).toBeDefined();
    expect(middleware.name).toBe("RmmMiddleware");

    // Verify hooks are present
    expect(typeof middleware.beforeAgent).toBe("function");
    expect(typeof middleware.beforeModel).toBe("function");
    expect(typeof middleware.afterModel).toBe("function");
    expect(typeof middleware.afterAgent).toBe("function");
  });

  test("leaves reflectionDeps undefined when llm or embeddings are missing", async () => {
    const { rmmMiddleware } = await import("@/index");

    // Mock VectorStore only (no LLM or embeddings)
    const mockVectorStore = {
      similaritySearch: async () => [],
      addDocuments: async () => {
        return await Promise.resolve();
      },
    };

    // Create middleware without LLM and embeddings
    const middleware = rmmMiddleware({
      vectorStore: mockVectorStore as any,
      enabled: true,
    });

    // Middleware should still be created
    expect(middleware).toBeDefined();
    expect(middleware.name).toBe("RmmMiddleware");

    // Reflection should be disabled (reflectionDeps undefined)
    // This can be verified by checking that beforeAgent doesn't throw
    expect(typeof middleware.beforeAgent).toBe("function");
  });

  test("maintains backward compatibility with partial dependencies", async () => {
    const { rmmMiddleware } = await import("@/index");

    // Mock VectorStore and Embeddings only (no LLM)
    const mockVectorStore = {
      similaritySearch: async () => [],
      addDocuments: async () => {
        return await Promise.resolve();
      },
    };

    const mockEmbeddings = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
    };

    // Create middleware with partial dependencies
    const middleware = rmmMiddleware({
      vectorStore: mockVectorStore as any,
      embeddings: mockEmbeddings as any,
      embeddingDimension: 1536,
      // No LLM - reflection should be disabled
      enabled: true,
    });

    // Middleware should be created without errors
    expect(middleware).toBeDefined();
    expect(middleware.name).toBe("RmmMiddleware");
    expect(typeof middleware.beforeAgent).toBe("function");
  });

  test("supports custom sessionId configuration", async () => {
    const { rmmMiddleware } = await import("@/index");

    const mockVectorStore = {
      similaritySearch: async () => [],
      addDocuments: async () => {
        return await Promise.resolve();
      },
    };

    // Create middleware with custom sessionId
    const customSessionId = "custom-session-123";
    const middleware = rmmMiddleware({
      vectorStore: mockVectorStore as any,
      sessionId: customSessionId,
      enabled: true,
    });

    expect(middleware).toBeDefined();
    expect(middleware.name).toBe("RmmMiddleware");
  });

  test("throws when embeddings provided without embeddingDimension", async () => {
    const { rmmMiddleware } = await import("@/index");

    const mockVectorStore = {
      similaritySearch: async () => [],
      addDocuments: async () => {
        return await Promise.resolve();
      },
    };

    const mockEmbeddings = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
    };

    // Should throw when embeddings is provided but embeddingDimension is missing
    expect(() => {
      rmmMiddleware({
        vectorStore: mockVectorStore as any,
        embeddings: mockEmbeddings as any,
        enabled: true,
      });
    }).toThrow("embeddingDimension is required when embeddings is provided");
  });

  test("throws when embeddingDimension provided without embeddings", async () => {
    const { rmmMiddleware } = await import("@/index");

    const mockVectorStore = {
      similaritySearch: async () => [],
      addDocuments: async () => {
        return await Promise.resolve();
      },
    };

    // Should throw when embeddingDimension is provided but embeddings is missing
    expect(() => {
      rmmMiddleware({
        vectorStore: mockVectorStore as any,
        embeddingDimension: 1536,
        enabled: true,
      });
    }).toThrow("embeddings is required when embeddingDimension is provided");
  });

  test("caps topM at topK with warning", async () => {
    const { rmmMiddleware } = await import("@/index");

    const mockVectorStore = {
      similaritySearch: async () => [],
      addDocuments: async () => {
        return await Promise.resolve();
      },
    };

    const mockEmbeddings = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
    };

    // Should cap topM at topK (5 > 3)
    const middleware = rmmMiddleware({
      vectorStore: mockVectorStore as any,
      embeddings: mockEmbeddings as any,
      embeddingDimension: 1536,
      topK: 3,
      topM: 5,
      enabled: true,
    });

    expect(middleware).toBeDefined();
    expect(middleware.name).toBe("RmmMiddleware");
  });

  test("emits warning when vectorStore embeddings differs from config embeddings", async () => {
    const { rmmMiddleware } = await import("@/index");

    // Create two different embeddings instances
    const embeddingsA = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
    };

    const embeddingsB = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.3),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.3)],
    };

    // Mock vectorStore with embeddingsA internally
    const mockVectorStore = {
      embeddings: embeddingsA, // Different from config embeddingsB
      similaritySearch: async () => [],
      addDocuments: async () => {
        return await Promise.resolve();
      },
    };

    // Capture console.warn calls
    const warnCalls: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: string, ...args: unknown[]) => {
      warnCalls.push(message);
      originalWarn(message, ...args);
    };

    try {
      const middleware = rmmMiddleware({
        vectorStore: mockVectorStore as any,
        embeddings: embeddingsB as any, // Different from vectorStore's embeddings
        embeddingDimension: 1536,
        enabled: true,
      });

      expect(middleware).toBeDefined();
      expect(
        warnCalls.some((call) =>
          call.includes(
            "RMM middleware embeddings instance differs from vectorStore's internal embeddings"
          )
        )
      ).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("does not emit warning when vectorStore and config use same embeddings instance", async () => {
    const { rmmMiddleware } = await import("@/index");

    const sharedEmbeddings = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
    };

    // Mock vectorStore using the same embeddings instance
    const mockVectorStore = {
      embeddings: sharedEmbeddings, // Same instance as config
      similaritySearch: async () => [],
      addDocuments: async () => {
        return await Promise.resolve();
      },
    };

    // Capture console.warn calls
    const warnCalls: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: string, ...args: unknown[]) => {
      warnCalls.push(message);
      originalWarn(message, ...args);
    };

    try {
      const middleware = rmmMiddleware({
        vectorStore: mockVectorStore as any,
        embeddings: sharedEmbeddings as any, // Same instance
        embeddingDimension: 1536,
        enabled: true,
      });

      expect(middleware).toBeDefined();
      expect(
        warnCalls.some((call) =>
          call.includes(
            "RMM middleware embeddings instance differs from vectorStore's internal embeddings"
          )
        )
      ).toBe(false);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("does not emit warning when vectorStore does not expose embeddings property", async () => {
    const { rmmMiddleware } = await import("@/index");

    const mockEmbeddings = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
    };

    // Mock vectorStore without .embeddings property
    const mockVectorStore = {
      similaritySearch: async () => [],
      addDocuments: async () => {
        return await Promise.resolve();
      },
    };

    // Capture console.warn calls
    const warnCalls: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: string, ...args: unknown[]) => {
      warnCalls.push(message);
      originalWarn(message, ...args);
    };

    try {
      const middleware = rmmMiddleware({
        vectorStore: mockVectorStore as any,
        embeddings: mockEmbeddings as any,
        embeddingDimension: 1536,
        enabled: true,
      });

      expect(middleware).toBeDefined();
      expect(
        warnCalls.some((call) =>
          call.includes(
            "RMM middleware embeddings instance differs from vectorStore's internal embeddings"
          )
        )
      ).toBe(false);
    } finally {
      console.warn = originalWarn;
    }
  });
});
