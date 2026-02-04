import { describe, expect, test } from "bun:test";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { RerankerState } from "@/schemas/index";

/**
 * Tests for beforeAgent hook
 *
 * These tests verify that beforeAgent:
 * 1. Loads weights from BaseStore when they exist
 * 2. Initializes new weights with N(0, 0.01) when none exist
 * 3. Resets transient state fields
 * 4. Handles BaseStore failure gracefully
 */

interface BeforeAgentRuntime {
  context: {
    userId: string;
    store: BaseStore;
  };
}

interface BeforeAgentState {
  messages: BaseMessage[];
}

describe("beforeAgent Hook", () => {
  // Sample state for testing
  const sampleState: BeforeAgentState = {
    messages: [
      {
        lc_serialized: { type: "human" },
        lc_kwargs: { content: "Hello" },
        lc_id: ["human"],
        content: "Hello",
        additional_kwargs: {},
      },
    ],
  };

  test("should export createRetrospectiveBeforeAgent function", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );
    expect(typeof createRetrospectiveBeforeAgent).toBe("function");
  });

  test("loads weights from BaseStore when they exist", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const existingWeights: RerankerState = {
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
    };

    const mockStore: BaseStore = {
      get(_namespace, key) {
        if (key === "reranker") {
          return { value: existingWeights };
        }
        return null;
      },
      put() {
        // intentionally empty mock
      },
      delete() {
        // intentionally empty mock
      },
      batch() {
        return [];
      },
      search() {
        return [];
      },
      listNamespaces() {
        return [];
      },
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user-123",
        store: mockStore,
      },
    };

    const result = await middleware.beforeAgent(sampleState, mockRuntime);

    expect(result).not.toBeNull();
    expect(result._rerankerWeights).toBeDefined();
    expect(result._rerankerWeights?.weights.queryTransform).toBeDefined();
    expect(result._rerankerWeights?.weights.memoryTransform).toBeDefined();
    expect(result._rerankerWeights?.config.topK).toBe(20);
  });

  test("initializes new weights with N(0, 0.01) when none exist", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const mockStore: BaseStore = {
      get() {
        return null; // No existing weights
      },
      put() {
        // intentionally empty mock
      },
      delete() {
        // intentionally empty mock
      },
      batch() {
        return [];
      },
      search() {
        return [];
      },
      listNamespaces() {
        return [];
      },
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "new-user",
        store: mockStore,
      },
    };

    const result = await middleware.beforeAgent(sampleState, mockRuntime);

    expect(result).not.toBeNull();
    expect(result._rerankerWeights).toBeDefined();
    expect(result._rerankerWeights?.weights.queryTransform).toBeDefined();
    expect(result._rerankerWeights?.weights.memoryTransform).toBeDefined();
    expect(result._rerankerWeights?.config.topK).toBe(20);
    expect(result._rerankerWeights?.config.topM).toBe(5);
    expect(result._rerankerWeights?.config.temperature).toBe(0.5);

    // Verify matrices have correct dimensions (1536x1536)
    expect(result._rerankerWeights?.weights.queryTransform.length).toBe(1536);
    for (const row of result._rerankerWeights?.weights.queryTransform ?? []) {
      expect(row.length).toBe(1536);
    }
  });

  test("resets transient state fields", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const mockStore: BaseStore = {
      get() {
        return null;
      },
      put() {
        // intentionally empty mock
      },
      delete() {
        // intentionally empty mock
      },
      batch() {
        return [];
      },
      search() {
        return [];
      },
      listNamespaces() {
        return [];
      },
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user",
        store: mockStore,
      },
    };

    const result = await middleware.beforeAgent(sampleState, mockRuntime);

    expect(result._rerankerWeights).toBeDefined();
    expect(result._retrievedMemories).toEqual([]);
    expect(result._citations).toEqual([]);
    expect(result._turnCountInSession).toBe(0);
  });

  test("handles BaseStore failure gracefully", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const mockStore: BaseStore = {
      get() {
        throw new Error("Simulated BaseStore failure");
      },
      put() {
        // intentionally empty mock
      },
      delete() {
        // intentionally empty mock
      },
      batch() {
        return [];
      },
      search() {
        return [];
      },
      listNamespaces() {
        return [];
      },
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user",
        store: mockStore,
      },
    };

    // Should not throw, should return initialized weights
    const result = await middleware.beforeAgent(sampleState, mockRuntime);

    expect(result).not.toBeNull();
    expect(result._rerankerWeights).toBeDefined();
    expect(result._rerankerWeights?.weights.queryTransform).toBeDefined();
    expect(result._rerankerWeights?.weights.memoryTransform).toBeDefined();
  });
});
