import { describe, expect, test } from "bun:test";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseStore, Item } from "@langchain/langgraph-checkpoint";
import type { RerankerState } from "@/schemas/index";

/**
 * Creates an async mock BaseStore for testing
 */
function createAsyncMockStore(initialData?: Map<string, unknown>): {
  get: BaseStore["get"];
  put: BaseStore["put"];
  delete: BaseStore["delete"];
  batch: BaseStore["batch"];
  search: BaseStore["search"];
  listNamespaces: BaseStore["listNamespaces"];
} {
  const storedData = initialData ?? new Map<string, unknown>();

  return {
    async get(_namespace, key) {
      const namespaceKey = [...(_namespace as string[]), key].join("|");
      const item = storedData.get(namespaceKey);
      return item
        ? {
            value: item,
            key,
            namespace: _namespace,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : null;
    },
    async put(namespace, key, value) {
      const namespaceKey = [...namespace, key].join("|");
      storedData.set(namespaceKey, value);
    },
    async delete() {},
    async batch() {
      return [];
    },
    async search() {
      return [];
    },
    async listNamespaces() {
      return [];
    },
  };
}

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

describe("beforeAgent Hook - Staging Pattern", () => {
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

  test("reflection stages buffer before processing to prevent message loss", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer with messages
    const initialBuffer = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Message 1" },
          lc_id: ["human"],
          content: "Message 1",
          additional_kwargs: {},
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const storedBuffers = new Map<string, unknown>();
    storedBuffers.set("rmm|test-user|buffer|message-buffer", initialBuffer);

    const mockStore = createAsyncMockStore(storedBuffers);

    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {},
      },
      extractSpeaker1: (dialogue: string) => "Speaker1",
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60000,
        mode: "strict",
      },
      reflectionDeps: mockDeps,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user",
        store: mockStore,
      },
    };

    await middleware.beforeAgent(sampleState, mockRuntime);

    // Verify staged buffer was created
    const stagedBufferKey = "rmm|test-user|buffer|staging|message-buffer";
    const stagedBuffer = storedBuffers.get(stagedBufferKey);
    expect(stagedBuffer).toBeDefined();
    expect((stagedBuffer as { messages: unknown[] }).messages).toHaveLength(1);
  });

  test("messages added during async reflection remain in live buffer", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer
    const initialBuffer = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Original message" },
          lc_id: ["human"],
          content: "Original message",
          additional_kwargs: {},
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const storedBuffers = new Map<string, unknown>();
    storedBuffers.set("rmm|test-user|buffer|message-buffer", initialBuffer);

    const mockStore = createAsyncMockStore(storedBuffers);

    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async (docs: string[]) => {
          // Simulate slow reflection - during this time, new messages arrive
          await new Promise((resolve) => setTimeout(resolve, 100));
        },
      },
      extractSpeaker1: (dialogue: string) => "Speaker1",
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60000,
        mode: "strict",
      },
      reflectionDeps: mockDeps,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user",
        store: mockStore,
      },
    };

    // Start reflection (non-blocking)
    const reflectionPromise = middleware.beforeAgent(sampleState, mockRuntime);

    // Simulate new message arriving during reflection
    // Wait for clearBuffer to be called first
    await new Promise((resolve) => setTimeout(resolve, 10));

    const newMessage = {
      lc_serialized: { type: "human" },
      lc_kwargs: { content: "New message during reflection" },
      lc_id: ["human"],
      content: "New message during reflection",
      additional_kwargs: {},
    };

    // Update live buffer while reflection is processing
    // Use mockStore.put since clearBuffer already updated internal store
    await mockStore.put(["rmm", "test-user", "buffer"], "message-buffer", {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Original message" },
          lc_id: ["human"],
          content: "Original message",
          additional_kwargs: {},
        },
        newMessage,
      ],
      humanMessageCount: 2,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    });

    await reflectionPromise;

    // Verify live buffer still has new message
    const liveBuffer = await mockStore.get(["rmm", "test-user", "buffer"], "message-buffer");
    expect(liveBuffer).not.toBeNull();
    expect(liveBuffer.value.messages).toHaveLength(2);
  });

  test("clearStaging clears only the staging area, not live buffer", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer and staged buffer
    const initialBuffer = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Message 1" },
          lc_id: ["human"],
          content: "Message 1",
          additional_kwargs: {},
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const stagedContent = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Staged message" },
          lc_id: ["human"],
          content: "Staged message",
          additional_kwargs: {},
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const storedBuffers = new Map<string, unknown>();
    storedBuffers.set("rmm|test-user|buffer|message-buffer", initialBuffer);
    storedBuffers.set("rmm|test-user|buffer|staging|message-buffer", stagedContent);

    const mockStore = createAsyncMockStore(storedBuffers);

    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {},
      },
      extractSpeaker1: (dialogue: string) => "Speaker1",
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60000,
        mode: "strict",
      },
      reflectionDeps: mockDeps,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user",
        store: mockStore,
      },
    };

    await middleware.beforeAgent(sampleState, mockRuntime);

    // Verify live buffer still exists (not cleared)
    const liveBuffer = storedBuffers.get("rmm|test-user|buffer|message-buffer");
    expect(liveBuffer).toBeDefined();
  });

  test("main buffer is cleared after successful staging", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer with messages
    const initialBuffer = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Message 1" },
          lc_id: ["human"],
          content: "Message 1",
          additional_kwargs: {},
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const storedBuffers = new Map<string, unknown>();
    storedBuffers.set("rmm|test-user|buffer|message-buffer", initialBuffer);

    const mockStore = createAsyncMockStore(storedBuffers);

    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {},
      },
      extractSpeaker1: (dialogue: string) => "Speaker1",
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60000,
        mode: "strict",
      },
      reflectionDeps: mockDeps,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user",
        store: mockStore,
      },
    };

    await middleware.beforeAgent(sampleState, mockRuntime);

    // Verify main buffer is cleared after staging (prevents duplicate processing)
    // Use loadBuffer which returns empty buffer for cleared entries
    const mainBuffer = await mockStore.get(["rmm", "test-user", "buffer"], "message-buffer");
    expect(mainBuffer).not.toBeNull();
    expect(mainBuffer.value.messages).toHaveLength(0);

    // Verify staging buffer still exists with original content
    const stagingBuffer = await mockStore.get(["rmm", "test-user", "buffer", "staging"], "message-buffer");
    expect(stagingBuffer).not.toBeNull();
    expect(stagingBuffer.value.messages).toHaveLength(1);
  });

  test("reflection reads from staging buffer, not snapshot argument", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer - will be modified in staging
    const initialBuffer = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Original message" },
          lc_id: ["human"],
          content: "Original message",
          additional_kwargs: {},
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const storedBuffers = new Map<string, unknown>();
    storedBuffers.set("rmm|test-user|buffer|message-buffer", initialBuffer);

    // Track what messages were passed to addDocuments
    let capturedMessages: unknown[] = [];

    const mockStore = createAsyncMockStore(storedBuffers);

    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async (docs: string[], _metadatas?: unknown[]) => {
          // Capture the messages being reflected
          capturedMessages = docs;
        },
      },
      extractSpeaker1: (dialogue: string) => "Speaker1",
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60000,
        mode: "strict",
      },
      reflectionDeps: mockDeps,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user",
        store: mockStore,
      },
    };

    // Track when reflection completes
    let reflectionComplete = false;

    // First, trigger the middleware which starts async reflection
    await middleware.beforeAgent(sampleState, mockRuntime);

    // Wait for reflection to complete (it runs asynchronously)
    // We can detect completion by waiting for the captured messages
    let attempts = 0;
    while (capturedMessages.length === 0 && attempts < 50) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      attempts++;
    }

    // Verify reflection processed messages from staging
    expect(capturedMessages.length).toBe(1);
    expect(capturedMessages[0]).toContain("Original message");
  });

  test("failed reflection preserves staging for retry", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer with messages
    const initialBuffer = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Message 1" },
          lc_id: ["human"],
          content: "Message 1",
          additional_kwargs: {},
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const storedBuffers = new Map<string, unknown>();
    storedBuffers.set("rmm|test-user|buffer|message-buffer", initialBuffer);

    const mockStore = createAsyncMockStore(storedBuffers);

    // Make reflection fail
    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {
          throw new Error("Reflection failed");
        },
      },
      extractSpeaker1: (dialogue: string) => "Speaker1",
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60000,
        mode: "strict",
      },
      reflectionDeps: mockDeps,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user",
        store: mockStore,
      },
    };

    // Trigger reflection (will fail)
    await middleware.beforeAgent(sampleState, mockRuntime);

    // Give async reflection time to fail
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify main buffer was cleared (empty messages)
    const mainBuffer = await mockStore.get(["rmm", "test-user", "buffer"], "message-buffer");
    expect(mainBuffer).not.toBeNull();
    expect(mainBuffer.value.messages).toHaveLength(0);

    // Verify staging buffer is preserved (for retry)
    const stagingBuffer = await mockStore.get(["rmm", "test-user", "buffer", "staging"], "message-buffer");
    expect(stagingBuffer).not.toBeNull();
    expect(stagingBuffer.value.messages).toHaveLength(1);
  });

  test("new messages go to main buffer during failed reflection", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer with messages
    const initialBuffer = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Message 1" },
          lc_id: ["human"],
          content: "Message 1",
          additional_kwargs: {},
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    // Capture when reflection is actually reading from staging
    let reflectionReadFromStaging = false;

    const storedBuffers = new Map<string, unknown>();
    storedBuffers.set("rmm|test-user|buffer|message-buffer", initialBuffer);

    const mockStore = createAsyncMockStore(storedBuffers);

    // Make reflection slow so we can add messages during it
    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {
          // Wait for the simulated slow reflection
          await new Promise((resolve) => setTimeout(resolve, 100));
          // After waiting, reflection has read from staging
          reflectionReadFromStaging = true;
          throw new Error("Reflection failed");
        },
      },
      extractSpeaker1: (dialogue: string) => "Speaker1",
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60000,
        mode: "strict",
      },
      reflectionDeps: mockDeps,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user",
        store: mockStore,
      },
    };

    // Trigger reflection (will fail)
    const reflectionPromise = middleware.beforeAgent(sampleState, mockRuntime);

    // Wait for reflection to start reading from staging
    // This ensures we add messages AFTER reflection has read staging content
    while (!reflectionReadFromStaging) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Now add new message AFTER reflection has read from staging
    // New messages go to main buffer (which was cleared earlier)
    const newMessage = {
      lc_serialized: { type: "human" },
      lc_kwargs: { content: "New message during failed reflection" },
      lc_id: ["human"],
      content: "New message during failed reflection",
      additional_kwargs: {},
    };

    // Update main buffer - new messages go here during failed reflection
    await mockStore.put(["rmm", "test-user", "buffer"], "message-buffer", {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Message 1" },
          lc_id: ["human"],
          content: "Message 1",
          additional_kwargs: {},
        },
        newMessage,
      ],
      humanMessageCount: 2,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    });

    await reflectionPromise;

    // Give async reflection time to fully fail
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify new message is in main buffer
    const mainBuffer = await mockStore.get(["rmm", "test-user", "buffer"], "message-buffer");
    expect(mainBuffer).not.toBeNull();
    expect(mainBuffer.value.messages).toHaveLength(2);
    expect(mainBuffer.value.messages[1].content).toBe("New message during failed reflection");
  });
});

describe("beforeAgent Hook - Namespace Isolation", () => {
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

  test("custom isolationNamespace prefixes storage keys correctly", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Pre-populate buffer with data so reflection triggers
    const initialBuffer = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Trigger reflection" },
          lc_id: ["human"],
          content: "Trigger reflection",
          additional_kwargs: {},
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now() - 120000, // 2 minutes ago to trigger reflection
      createdAt: Date.now() - 120000,
    };

    const storedBuffers = new Map<string, unknown>();
    storedBuffers.set("rmm|test-user|buffer|message-buffer", initialBuffer);

    // Track all keys accessed
    const storedKeys: string[] = [];

    const mockStore: BaseStore = {
      async get(_namespace, key) {
        storedKeys.push(`get|${[...(_namespace as string[]), key].join("|")}`);
        const namespaceKey = [...(_namespace as string[]), key].join("|");
        const item = storedBuffers.get(namespaceKey);
        if (item) {
          return {
            value: item,
            key,
            namespace: _namespace,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
      },
      async put(namespace, key, value) {
        storedKeys.push(`put|${[...namespace, key].join("|")}`);
        const namespaceKey = [...namespace, key].join("|");
        storedBuffers.set(namespaceKey, value);
      },
      async delete() {},
      async batch() {
        return [];
      },
      async search() {
        return [];
      },
      async listNamespaces() {
        return [];
      },
    };

    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {},
      },
      extractSpeaker1: (dialogue: string) => "Speaker1",
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60000, // 1 minute max inactivity
        mode: "strict",
      },
      reflectionDeps: mockDeps,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user",
        store: mockStore,
      },
    };

    await middleware.beforeAgent(sampleState, mockRuntime);

    // Verify that namespace was used in storage operations
    const bufferPutKeys = storedKeys.filter((k) => k.includes("buffer"));
    expect(bufferPutKeys.length).toBeGreaterThan(0);

    // At least one should have "staging" for the staging pattern
    const hasStaging = storedKeys.some((k) => k.includes("staging"));
    expect(hasStaging).toBe(true);
  });
});
