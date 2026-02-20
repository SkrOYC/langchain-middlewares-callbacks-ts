import { describe, expect, test } from "bun:test";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { SerializedMessage } from "@/schemas";
import { createFailingMockBaseStore } from "@/tests/fixtures/mock-base-store";
import { createSerializedMessage } from "@/tests/helpers/messages";

/**
 * Tests for beforeAgent hook error scenarios
 *
 * These tests verify that beforeAgent gracefully handles errors:
 * 1. Store load failure → initializes in-memory state
 * 2. Store save failure → continues with in-memory weights
 * 3. Missing userId → continues with in-memory initialization
 */

describe("beforeAgent Hook Error Scenarios", () => {
  // Sample state for testing
  const sampleState = {
    messages: [
      createSerializedMessage("human", "Hello"),
    ] as SerializedMessage[],
  };

  test("should handle store get failure gracefully", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const failingStore = createFailingMockBaseStore("get");

    const middleware = createRetrospectiveBeforeAgent({
      store: failingStore,
      userIdExtractor: (runtime: { context: { userId: string } }) =>
        runtime.context.userId,
    });

    const runtime = {
      context: { userId: "user1" },
    };

    const result = await middleware.beforeAgent(sampleState, runtime);

    // Should still return initialized state despite store failure
    expect(result).toBeDefined();
    expect(result._rerankerWeights).toBeDefined();
    expect(result._rerankerWeights.weights).toBeDefined();
    expect(result._rerankerWeights.weights.queryTransform).toBeInstanceOf(
      Array
    );
    expect(result._rerankerWeights.weights.memoryTransform).toBeInstanceOf(
      Array
    );
    expect(result._retrievedMemories).toEqual([]);
    expect(result._citations).toEqual([]);
    expect(result._turnCountInSession).toBe(0);
  });

  test("should handle missing userId gracefully", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const mockStore: BaseStore = {
      async get() {
        return await Promise.resolve(null);
      },

      async put() {
        return await Promise.resolve();
      },

      async delete() {
        return await Promise.resolve();
      },

      async batch() {
        return await Promise.resolve([]);
      },

      async search() {
        return await Promise.resolve([]);
      },

      async listNamespaces() {
        return await Promise.resolve([]);
      },
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: () => undefined as unknown as string,
    });

    const runtime = {
      context: { userId: undefined },
    };

    const result = await middleware.beforeAgent(sampleState, runtime);

    // Should initialize in-memory state when userId is missing
    expect(result).toBeDefined();
    expect(result._rerankerWeights).toBeDefined();
    expect(result._retrievedMemories).toEqual([]);
    expect(result._citations).toEqual([]);
    expect(result._turnCountInSession).toBe(0);
  });

  test("should handle userIdExtractor throwing error", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const mockStore: BaseStore = {
      async get() {
        return await Promise.resolve(null);
      },

      async put() {
        return await Promise.resolve();
      },

      async delete() {
        return await Promise.resolve();
      },

      async batch() {
        return await Promise.resolve([]);
      },

      async search() {
        return await Promise.resolve([]);
      },

      async listNamespaces() {
        return await Promise.resolve([]);
      },
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: () => {
        throw new Error("userIdExtractor failed");
      },
    });

    const runtime = {
      context: { userId: "user1" },
    };

    const result = await middleware.beforeAgent(sampleState, runtime);

    // Should initialize in-memory state when userIdExtractor throws
    expect(result).toBeDefined();
    expect(result._rerankerWeights).toBeDefined();
    expect(result._retrievedMemories).toEqual([]);
    expect(result._citations).toEqual([]);
    expect(result._turnCountInSession).toBe(0);
  });
});
