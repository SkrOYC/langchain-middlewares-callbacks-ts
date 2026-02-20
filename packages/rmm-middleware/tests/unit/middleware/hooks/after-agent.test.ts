import { describe, expect, test } from "bun:test";
import type { BaseMessage } from "@langchain/core/messages";
import type { Item } from "@langchain/langgraph-checkpoint";

// Constants for test configuration
const ONE_MINUTE_MS = 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Tests for afterAgent hook - Append-Only Behavior
 *
 * These tests verify that afterAgent:
 * 1. Appends new messages to existing buffer
 * 2. Updates humanMessageCount correctly
 * 3. Persists buffer to BaseStore
 * 4. Does NOT check triggers (now handled by beforeAgent)
 */

interface AfterAgentState {
  messages: BaseMessage[];
}

interface AfterAgentRuntime {
  context: {
    summarizationModel: {
      invoke: (input: string) => { content: string; text: string };
    };
    embeddings: {
      embedDocuments: (texts: string[]) => Promise<number[][]>;
    };
  };
}

// ============================================================================
// Mock Store Factory
// ============================================================================

function createMockStore(existingBuffer?: Record<string, unknown>): {
  get: (namespace: string[], key: string) => Promise<Item | null>;
  put: (namespace: string[], key: string, value: unknown) => Promise<void>;
} {
  const storeData = new Map<string, Item>();

  if (existingBuffer) {
    const updatedAt = new Date(Date.now() - FIVE_MINUTES_MS);
    storeData.set("rmm|test-user|buffer|message-buffer", {
      value: existingBuffer,
      key: "message-buffer",
      namespace: ["rmm", "test-user", "buffer"],
      created_at: updatedAt,
      updated_at: updatedAt,
    });
  }

  return {
    get: async (namespace: string[], key: string) => {
      const fullKey = [...namespace, key].join("|");
      return await Promise.resolve(storeData.get(fullKey) ?? null);
    },
    put: async (namespace: string[], key: string, value: unknown) => {
      const fullKey = [...namespace, key].join("|");
      storeData.set(fullKey, {
        value,
        key,
        namespace,
        created_at: new Date(),
        updated_at: new Date(),
      });
      return await Promise.resolve();
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("afterAgent Hook - Append Only", () => {
  // Sample state for testing - using BaseMessage instances
  const sampleState: AfterAgentState = {
    messages: [
      {
        type: "human",
        data: { content: "Hello, I went hiking this weekend", role: "human" },
      },
      {
        type: "ai",
        data: { content: "That sounds great!", role: "ai" },
      },
      {
        type: "human",
        data: {
          content: "It was amazing, I love being outdoors",
          role: "human",
        },
      },
      {
        type: "ai",
        data: { content: "What else do you enjoy?", role: "ai" },
      },
    ] as unknown as BaseMessage[],
  };

  test("should export afterAgent function", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");
    expect(typeof afterAgent).toBe("function");
  });

  test("appends messages to empty buffer", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    // Mock dependencies (not used for triggers, only for reflection deps)
    const mockSummarizationModel = {
      invoke: () => {
        const content = JSON.stringify({
          extracted_memories: [
            { summary: "User enjoys hiking", reference: [0] },
          ],
        });
        return { content, text: content };
      },
    };

    const mockEmbeddings = {
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    const mockVectorStore = {
      similaritySearch: () => [],
      addDocuments: () => undefined,
    };

    // Mock store starts with empty buffer
    const mockStore = createMockStore();

    const mockRuntime: AfterAgentRuntime = {
      context: {
        summarizationModel: mockSummarizationModel,
        embeddings: mockEmbeddings,
      },
    };

    const mockDeps = {
      vectorStore: mockVectorStore,
      userId: "test-user",
      store: mockStore,
    };

    // Call afterAgent with sample messages
    const result = await afterAgent(
      sampleState as RmmMiddlewareState & { messages: BaseMessage[] },
      mockRuntime as never,
      mockDeps as never
    );

    expect(result).toEqual({});

    // Verify buffer was saved
    const savedItem = await mockStore.get(
      ["rmm", "test-user", "buffer"],
      "message-buffer"
    );
    expect(savedItem).not.toBeNull();
    expect(savedItem?.value.messages).toHaveLength(4);
  });

  test("appends messages to existing buffer", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const mockVectorStore = {
      similaritySearch: () => [],
      addDocuments: () => undefined,
    };

    // Mock store with existing buffer
    const existingBuffer = {
      messages: [
        {
          data: { content: "Previous message", role: "human", name: "" },
          type: "human",
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now() - ONE_MINUTE_MS,
      createdAt: Date.now() - ONE_MINUTE_MS,
    };
    const mockStore = createMockStore(existingBuffer);

    const mockRuntime = {
      context: {},
    };

    const mockDeps = {
      vectorStore: mockVectorStore,
      userId: "test-user",
      store: mockStore,
    };

    await afterAgent(
      sampleState as RmmMiddlewareState & { messages: BaseMessage[] },
      mockRuntime as never,
      mockDeps as never
    );

    // Verify buffer has both old and new messages
    const savedItem = await mockStore.get(
      ["rmm", "test-user", "buffer"],
      "message-buffer"
    );
    expect(savedItem).not.toBeNull();
    expect(savedItem?.value.messages).toHaveLength(5);
  });

  test("persists buffer to BaseStore", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const mockVectorStore = {
      similaritySearch: () => [],
      addDocuments: () => undefined,
    };

    const mockStore = createMockStore();

    const mockRuntime = {
      context: {},
    };

    const mockDeps = {
      vectorStore: mockVectorStore,
      userId: "test-user",
      store: mockStore,
    };

    await afterAgent(
      sampleState as RmmMiddlewareState & { messages: BaseMessage[] },
      mockRuntime as never,
      mockDeps as never
    );

    // Verify buffer was persisted
    const savedItem = await mockStore.get(
      ["rmm", "test-user", "buffer"],
      "message-buffer"
    );
    expect(savedItem).not.toBeNull();
    expect(savedItem?.value.messages).toHaveLength(4);
  });

  test("updates humanMessageCount correctly when appending", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const mockVectorStore = {
      similaritySearch: () => [],
      addDocuments: () => undefined,
    };

    const mockStore = createMockStore();

    const mockRuntime = {
      context: {},
    };

    const mockDeps = {
      vectorStore: mockVectorStore,
      userId: "test-user",
      store: mockStore,
    };

    await afterAgent(
      sampleState as RmmMiddlewareState & { messages: BaseMessage[] },
      mockRuntime as never,
      mockDeps as never
    );

    // Verify humanMessageCount is correct (2 human messages in sampleState)
    const savedItem = await mockStore.get(
      ["rmm", "test-user", "buffer"],
      "message-buffer"
    );
    expect(savedItem).not.toBeNull();
    expect(savedItem?.value.humanMessageCount).toBe(2);
  });

  test("skips when no messages in state", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const emptyState = { messages: [] };

    const result = await afterAgent(
      emptyState as RmmMiddlewareState & { messages: BaseMessage[] },
      {} as never,
      undefined
    );

    expect(result).toEqual({});
  });

  test("skips when no store or userId provided", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const result = await afterAgent(
      sampleState as RmmMiddlewareState & { messages: BaseMessage[] },
      {} as never,
      {}
    );

    expect(result).toEqual({});
  });
});

// Import type for TypeScript
import type { RmmMiddlewareState } from "@/schemas";
