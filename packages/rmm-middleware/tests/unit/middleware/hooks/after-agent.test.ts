import { describe, expect, test } from "bun:test";
import type { BaseMessage } from "@langchain/core/messages";

// Constants for test configuration
const ELEVEN_MINUTES_MS = 11 * 60 * 1000;

/**
 * Tests for afterAgent hook
 *
 * These tests verify that afterAgent:
 * 1. Full pipeline executes successfully
 * 2. No memories extracted → no VectorStore calls
 * 3. Error handling works (aborts gracefully)
 */

interface AfterAgentState {
  messages: BaseMessage[];
}

describe("afterAgent Hook", () => {
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

  test("full pipeline executes successfully", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    // Mock dependencies
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

    let addDocumentsCalled = false;

    const mockVectorStore = {
      similaritySearch: () => [],
      addDocuments: () => {
        addDocumentsCalled = true;
      },
    };

    // Mock BaseStore for message buffer persistence
    // Pre-populate with a buffer that has an old timestamp to trigger inactivity
    const storeData = new Map();
    storeData.set("rmm|test-user|buffer|message-buffer", {
      value: {
        messages: [],
        humanMessageCount: 0,
        lastMessageTimestamp: Date.now() - ELEVEN_MINUTES_MS,
        createdAt: Date.now() - ELEVEN_MINUTES_MS,
      },
    });

    const mockStore = {
      get: async (namespace: string[], key: string) => {
        const fullKey = [...namespace, key].join("|");
        return await Promise.resolve(storeData.get(fullKey) ?? null);
      },
      put: async (namespace: string[], key: string, value: unknown) => {
        const fullKey = [...namespace, key].join("|");
        storeData.set(fullKey, { value });
        return await Promise.resolve();
      },
    };

    const mockRuntime = {
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
        minInactivityMs: 600_000, // 10 minutes
        maxInactivityMs: 1_800_000, // 30 minutes
        mode: "strict" as const,
        maxBufferSize: 100,
      },
    };

    const result = await afterAgent(sampleState, mockRuntime, mockDeps);

    expect(result).not.toBeNull();
    expect(addDocumentsCalled).toBe(true);
  });

  test("no memories extracted → no VectorStore calls", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    // Mock dependencies that return NO_TRAIT
    const mockSummarizationModel = {
      invoke: () => {
        const content = "NO_TRAIT";
        return { content, text: content };
      },
    };

    const mockEmbeddings = {
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    let vectorStoreCalled = false;

    const mockVectorStore = {
      similaritySearch: () => {
        vectorStoreCalled = true;
        return [];
      },
      addDocuments: () => {
        vectorStoreCalled = true;
      },
    };

    const mockRuntime2 = {
      context: {
        summarizationModel: mockSummarizationModel,
        embeddings: mockEmbeddings,
      },
    };

    const mockDeps2 = {
      vectorStore: mockVectorStore,
      extractSpeaker1: (dialogue: string) => `Prompt for: ${dialogue}`,
    };

    const result2 = await afterAgent(sampleState, mockRuntime2, mockDeps2);

    expect(result2).not.toBeNull();
    expect(vectorStoreCalled).toBe(false);
  });

  test("empty messages returns without processing", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const emptyState = {
      messages: [],
    };

    let modelCalled = false;

    const mockSummarizationModel = {
      invoke: () => {
        modelCalled = true;
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
      addDocuments: () => {
        // intentionally empty mock
      },
    };

    const mockRuntime3 = {
      context: {
        summarizationModel: mockSummarizationModel,
        embeddings: mockEmbeddings,
      },
    };

    const mockDeps3 = {
      vectorStore: mockVectorStore,
      extractSpeaker1: (dialogue: string) => `Prompt for: ${dialogue}`,
    };

    const result3 = await afterAgent(emptyState, mockRuntime3, mockDeps3);

    expect(result3).not.toBeNull();
    expect(modelCalled).toBe(false);
  });

  test("error handling works (aborts gracefully)", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    // Mock LLM that returns invalid content (triggers error handling)
    const mockSummarizationModel = {
      invoke: () => {
        const content = "not valid json that will fail";
        return { content, text: content };
      },
    };

    const mockEmbeddings = {
      embedDocuments: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
    };

    const mockVectorStore = {
      similaritySearch: () => [],
      addDocuments: () => {
        // intentionally empty mock
      },
    };

    const mockRuntime4 = {
      context: {
        summarizationModel: mockSummarizationModel,
        embeddings: mockEmbeddings,
      },
    };

    const mockDeps4 = {
      vectorStore: mockVectorStore,
      extractSpeaker1: (dialogue: string) => `Prompt for: ${dialogue}`,
    };

    // Should not throw, should return empty object
    const result4 = await afterAgent(sampleState, mockRuntime4, mockDeps4);

    expect(result4).not.toBeNull();
    expect(Object.keys(result4).length).toBe(0);
  });

  test("handles multiple memories correctly", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    // Mock dependencies that return multiple memories
    const mockSummarizationModel = {
      invoke: () => {
        const content = JSON.stringify({
          extracted_memories: [
            { summary: "User enjoys hiking", reference: [0] },
            { summary: "User likes running", reference: [2] },
            { summary: "User is a developer", reference: [1] },
          ],
        });
        return { content, text: content };
      },
    };

    const mockEmbeddings = {
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    let memoriesProcessed = 0;

    const mockVectorStore = {
      similaritySearch: () => [],
      addDocuments: () => {
        memoriesProcessed += 1;
      },
    };

    // Mock BaseStore for message buffer persistence
    // Pre-populate with a buffer that has an old timestamp to trigger inactivity
    const storeData = new Map();
    storeData.set("rmm|test-user|buffer|message-buffer", {
      value: {
        messages: [],
        humanMessageCount: 0,
        lastMessageTimestamp: Date.now() - ELEVEN_MINUTES_MS,
        createdAt: Date.now() - ELEVEN_MINUTES_MS,
      },
    });

    const mockStore = {
      get: async (namespace: string[], key: string) => {
        const fullKey = [...namespace, key].join("|");
        return await Promise.resolve(storeData.get(fullKey) ?? null);
      },
      put: async (namespace: string[], key: string, value: unknown) => {
        const fullKey = [...namespace, key].join("|");
        storeData.set(fullKey, { value });
        return await Promise.resolve();
      },
    };

    const mockRuntime5 = {
      context: {
        summarizationModel: mockSummarizationModel,
        embeddings: mockEmbeddings,
      },
    };

    const mockDeps5 = {
      vectorStore: mockVectorStore,
      extractSpeaker1: (dialogue: string) => `Prompt for: ${dialogue}`,
      userId: "test-user",
      store: mockStore,
      reflectionConfig: {
        minTurns: 2,
        maxTurns: 50,
        minInactivityMs: 600_000, // 10 minutes
        maxInactivityMs: 1_800_000, // 30 minutes
        mode: "strict" as const,
        maxBufferSize: 100,
      },
    };

    const result5 = await afterAgent(sampleState, mockRuntime5, mockDeps5);

    expect(result5).not.toBeNull();
    expect(memoriesProcessed).toBe(3);
  });

  test("handles merge decisions correctly", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    // Track call count to distinguish between extraction and decision
    let callCount = 0;

    // Mock dependencies for extraction that returns a memory
    const mockSummarizationModel = {
      invoke: (_input: string) => {
        callCount++;
        if (callCount === 1) {
          // First call: extraction response
          const content = JSON.stringify({
            extracted_memories: [
              { summary: "User enjoys outdoor activities", reference: [0] },
            ],
          });
          return { content, text: content };
        }
        // Second call: decision response
        const content = "Merge(0, User enjoys outdoor activities and hiking)";
        return { content, text: content };
      },
    };

    const mockEmbeddings = {
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    let addCalled = false;

    const mockVectorStore = {
      similaritySearch: () => [
        {
          pageContent: "User likes hiking",
          metadata: {
            id: "existing-memory-1",
            sessionId: "session-123",
            timestamp: Date.now() - 100_000,
            turnReferences: [0],
          },
        },
      ],
      delete: () => {
        // intentionally empty mock
      },
      addDocuments: () => {
        addCalled = true;
      },
    };

    // Mock BaseStore for message buffer persistence
    // Pre-populate with a buffer that has an old timestamp to trigger inactivity
    const storeData = new Map();
    storeData.set("rmm|test-user|buffer|message-buffer", {
      value: {
        messages: [],
        humanMessageCount: 0,
        lastMessageTimestamp: Date.now() - ELEVEN_MINUTES_MS,
        createdAt: Date.now() - ELEVEN_MINUTES_MS,
      },
    });

    const mockStore = {
      get: async (namespace: string[], key: string) => {
        const fullKey = [...namespace, key].join("|");
        return await Promise.resolve(storeData.get(fullKey) ?? null);
      },
      put: async (namespace: string[], key: string, value: unknown) => {
        const fullKey = [...namespace, key].join("|");
        storeData.set(fullKey, { value });
        return await Promise.resolve();
      },
    };

    const mockRuntime6 = {
      context: {
        summarizationModel: mockSummarizationModel,
        embeddings: mockEmbeddings,
      },
    };

    const mockDeps6 = {
      vectorStore: mockVectorStore,
      extractSpeaker1: (dialogue: string) => `Prompt for: ${dialogue}`,
      updateMemory: (history: string[], newSummary: string) =>
        `Update prompt for: ${history.length} memories, new: ${newSummary}`,
      userId: "test-user",
      store: mockStore,
      reflectionConfig: {
        minTurns: 2,
        maxTurns: 50,
        minInactivityMs: 600_000, // 10 minutes
        maxInactivityMs: 1_800_000, // 30 minutes
        mode: "strict" as const,
        maxBufferSize: 100,
      },
    };

    const result6 = await afterAgent(sampleState, mockRuntime6, mockDeps6);

    expect(result6).not.toBeNull();
    expect(addCalled).toBe(true);
  });

  test("returns empty object on success", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    // Mock dependencies
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
      addDocuments: () => {
        // intentionally empty mock
      },
    };

    const mockRuntime7 = {
      context: {
        summarizationModel: mockSummarizationModel,
        embeddings: mockEmbeddings,
      },
    };

    const mockDeps7 = {
      vectorStore: mockVectorStore,
      extractSpeaker1: (dialogue: string) => `Prompt for: ${dialogue}`,
    };

    const result7 = await afterAgent(sampleState, mockRuntime7, mockDeps7);

    expect(result7).toEqual({});
  });

  test("relaxed mode triggers reflection when turns threshold met without inactivity", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    // Mock dependencies
    const mockSummarizationModel = {
      invoke: () => {
        const content = JSON.stringify({
          extracted_memories: [
            { summary: "User enjoys testing", reference: [0] },
          ],
        });
        return { content, text: content };
      },
    };

    const mockEmbeddings = {
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    let addDocumentsCalled = false;

    const mockVectorStore = {
      similaritySearch: () => [],
      addDocuments: () => {
        addDocumentsCalled = true;
      },
    };

    // Mock store with VERY recent timestamp (no inactivity)
    const storeData = new Map();
    storeData.set("rmm|test-user|buffer|message-buffer", {
      value: {
        messages: [],
        humanMessageCount: 0,
        lastMessageTimestamp: Date.now() - 1000, // 1 second ago (no inactivity)
        createdAt: Date.now() - 1000,
      },
    });

    const mockStore = {
      get: async (namespace: string[], key: string) => {
        const fullKey = [...namespace, key].join("|");
        return await Promise.resolve(storeData.get(fullKey) ?? null);
      },
      put: async (namespace: string[], key: string, value: unknown) => {
        const fullKey = [...namespace, key].join("|");
        storeData.set(fullKey, { value });
        return await Promise.resolve();
      },
    };

    const mockRuntime = {
      context: {
        summarizationModel: mockSummarizationModel,
        embeddings: mockEmbeddings,
      },
    };

    // Use relaxed mode - should trigger with just turn count, no inactivity needed
    const mockDeps = {
      vectorStore: mockVectorStore,
      extractSpeaker1: (dialogue: string) => `Prompt for: ${dialogue}`,
      userId: "test-user",
      store: mockStore,
      reflectionConfig: {
        minTurns: 2,
        maxTurns: 50,
        minInactivityMs: 600_000, // 10 minutes (not met)
        maxInactivityMs: 1_800_000,
        mode: "relaxed" as const, // OR logic - turns only
        maxBufferSize: 100,
      },
    };

    const result = await afterAgent(sampleState, mockRuntime, mockDeps);

    // Relaxed mode should trigger because minTurns (2) is met, even though inactivity is not
    expect(result).not.toBeNull();
    expect(addDocumentsCalled).toBe(true);
  });
});
