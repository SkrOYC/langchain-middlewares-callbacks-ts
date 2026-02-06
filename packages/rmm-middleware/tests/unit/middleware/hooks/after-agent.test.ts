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
  get: BaseStore["get"];
  put: BaseStore["put"];
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
  // Sample state for testing
  const sampleState: AfterAgentState = {
    messages: [
      {
        lc_serialized: { type: "human" },
        lc_kwargs: { content: "Hello, I went hiking this weekend" },
        lc_id: ["human"],
        content: "Hello, I went hiking this weekend",
        additional_kwargs: {},
      },
      {
        lc_serialized: { type: "ai" },
        lc_kwargs: { content: "That sounds great!" },
        lc_id: ["ai"],
        content: "That sounds great!",
        additional_kwargs: {},
      },
      {
        lc_serialized: { type: "human" },
        lc_kwargs: { content: "It was amazing, I love being outdoors" },
        lc_id: ["human"],
        content: "It was amazing, I love being outdoors",
        additional_kwargs: {},
      },
      {
        lc_serialized: { type: "ai" },
        lc_kwargs: { content: "What else do you enjoy?" },
        lc_id: ["ai"],
        content: "What else do you enjoy?",
        additional_kwargs: {},
      },
    ],
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
      extractSpeaker1: (dialogue: string) => `Prompt for: ${dialogue}`,
      userId: "test-user",
      store: mockStore,
      reflectionConfig: {
        minTurns: 2,
        maxTurns: 50,
        minInactivityMs: 600_000,
        maxInactivityMs: 1_800_000,
        mode: "strict" as const,
      },
    };

    const result = await afterAgent(sampleState, mockRuntime, mockDeps);

    expect(result).toEqual({});

    // Verify buffer was updated
    const savedItem = await mockStore.get(
      ["rmm", "test-user", "buffer"],
      "message-buffer"
    );
    expect(savedItem).not.toBeNull();
    expect(savedItem?.value.messages).toHaveLength(4);
    expect(savedItem?.value.humanMessageCount).toBe(2);
  });

  test("appends messages to existing buffer", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const mockSummarizationModel = {
      invoke: () => {
        const content = JSON.stringify({
          extracted_memories: [],
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

    // Mock store starts with existing buffer (2 messages)
    const existingBuffer = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Previous message" },
          lc_id: ["human"],
          content: "Previous message",
          additional_kwargs: {},
        },
        {
          lc_serialized: { type: "ai" },
          lc_kwargs: { content: "Previous response" },
          lc_id: ["ai"],
          content: "Previous response",
          additional_kwargs: {},
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now() - ONE_MINUTE_MS,
      createdAt: Date.now() - ONE_MINUTE_MS,
    };

    const mockStore = createMockStore(existingBuffer);

    const mockRuntime: AfterAgentRuntime = {
      context: {
        summarizationModel: mockSummarizationModel,
        embeddings: mockEmbeddings,
      },
    };

    const mockDeps = {
      vectorStore: mockVectorStore,
      extractSpeaker1: (dialogue: string) => `Prompt for: ${dialogue}`,
      userId: "test-user",
      store: mockStore,
      reflectionConfig: {
        minTurns: 2,
        maxTurns: 50,
        minInactivityMs: 600_000,
        maxInactivityMs: 1_800_000,
        mode: "strict" as const,
      },
    };

    const result = await afterAgent(sampleState, mockRuntime, mockDeps);

    expect(result).toEqual({});

    // Verify messages were appended
    const savedItem = await mockStore.get(
      ["rmm", "test-user", "buffer"],
      "message-buffer"
    );
    expect(savedItem).not.toBeNull();
    expect(savedItem?.value.messages).toHaveLength(6); // 2 old + 4 new
    expect(savedItem?.value.humanMessageCount).toBe(3); // 1 old + 2 new
  });

  test("handles empty messages gracefully", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const mockSummarizationModel = {
      invoke: () => {
        const content = "NO_TRAIT";
        return { content, text: content };
      },
    };

    const mockEmbeddings = {
      embedDocuments: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
    };

    const mockVectorStore = {
      similaritySearch: () => [],
      addDocuments: () => undefined,
    };

    const mockStore = createMockStore();

    const mockRuntime: AfterAgentRuntime = {
      context: {
        summarizationModel: mockSummarizationModel,
        embeddings: mockEmbeddings,
      },
    };

    const emptyState: AfterAgentState = {
      messages: [],
    };

    const mockDeps = {
      vectorStore: mockVectorStore,
      extractSpeaker1: (dialogue: string) => `Prompt for: ${dialogue}`,
      userId: "test-user",
      store: mockStore,
      reflectionConfig: {
        minTurns: 2,
        maxTurns: 50,
        minInactivityMs: 600_000,
        maxInactivityMs: 1_800_000,
        mode: "strict" as const,
      },
    };

    const result = await afterAgent(emptyState, mockRuntime, mockDeps);

    // Should return empty object when no messages
    expect(result).toEqual({});
  });

  test("persists buffer to BaseStore", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const mockSummarizationModel = {
      invoke: () => {
        const content = JSON.stringify({
          extracted_memories: [],
        });
        return { content, text: content };
      },
    };

    const mockEmbeddings = {
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    let putCalled = false;
    let savedValue: unknown;

    const mockVectorStore = {
      similaritySearch: () => [],
      addDocuments: () => undefined,
    };

    const mockStore = createMockStore();
    const originalPut = mockStore.put;

    mockStore.put = async (
      namespace: string[],
      key: string,
      value: unknown
    ) => {
      putCalled = true;
      savedValue = value;
      return await originalPut(namespace, key, value);
    };

    const mockRuntime: AfterAgentRuntime = {
      context: {
        summarizationModel: mockSummarizationModel,
        embeddings: mockEmbeddings,
      },
    };

    const mockDeps = {
      vectorStore: mockVectorStore,
      extractSpeaker1: (dialogue: string) => `Prompt for: ${dialogue}`,
      userId: "test-user",
      store: mockStore,
      reflectionConfig: {
        minTurns: 2,
        maxTurns: 50,
        minInactivityMs: 600_000,
        maxInactivityMs: 1_800_000,
        mode: "strict" as const,
      },
    };

    await afterAgent(sampleState, mockRuntime, mockDeps);

    // Verify put was called to persist buffer
    expect(putCalled).toBe(true);
    expect(savedValue).not.toBeNull();
    expect(savedValue).toHaveProperty("messages");
    expect(savedValue).toHaveProperty("humanMessageCount");
  });

  test("updates humanMessageCount correctly when appending", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const mockSummarizationModel = {
      invoke: () => {
        const content = JSON.stringify({
          extracted_memories: [],
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

    // Start with 3 human messages in buffer
    const existingBuffer = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Msg1" },
          lc_id: ["human"],
          content: "Msg1",
          additional_kwargs: {},
        },
        {
          lc_serialized: { type: "ai" },
          lc_kwargs: { content: "Resp1" },
          lc_id: ["ai"],
          content: "Resp1",
          additional_kwargs: {},
        },
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Msg2" },
          lc_id: ["human"],
          content: "Msg2",
          additional_kwargs: {},
        },
        {
          lc_serialized: { type: "ai" },
          lc_kwargs: { content: "Resp2" },
          lc_id: ["ai"],
          content: "Resp2",
          additional_kwargs: {},
        },
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Msg3" },
          lc_id: ["human"],
          content: "Msg3",
          additional_kwargs: {},
        },
      ],
      humanMessageCount: 3,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const mockStore = createMockStore(existingBuffer);

    // New messages: 1 human + 1 ai
    const newMessages: AfterAgentState = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "New msg" },
          lc_id: ["human"],
          content: "New msg",
          additional_kwargs: {},
        },
        {
          lc_serialized: { type: "ai" },
          lc_kwargs: { content: "New resp" },
          lc_id: ["ai"],
          content: "New resp",
          additional_kwargs: {},
        },
      ],
    };

    const mockRuntime: AfterAgentRuntime = {
      context: {
        summarizationModel: mockSummarizationModel,
        embeddings: mockEmbeddings,
      },
    };

    const mockDeps = {
      vectorStore: mockVectorStore,
      extractSpeaker1: (dialogue: string) => `Prompt for: ${dialogue}`,
      userId: "test-user",
      store: mockStore,
      reflectionConfig: {
        minTurns: 2,
        maxTurns: 50,
        minInactivityMs: 600_000,
        maxInactivityMs: 1_800_000,
        mode: "strict" as const,
      },
    };

    await afterAgent(newMessages, mockRuntime, mockDeps);

    // Verify humanMessageCount updated correctly (3 + 1 = 4)
    const savedItem = await mockStore.get(
      ["rmm", "test-user", "buffer"],
      "message-buffer"
    );
    expect(savedItem).not.toBeNull();
    expect(savedItem?.value.humanMessageCount).toBe(4);
  });
});
