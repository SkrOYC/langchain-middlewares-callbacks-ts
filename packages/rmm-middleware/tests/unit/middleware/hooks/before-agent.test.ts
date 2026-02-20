import { describe, expect, test } from "bun:test";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { RerankerState } from "@/schemas/index";
import { DEFAULT_REFLECTION_CONFIG } from "@/schemas/index";

/**
 * Helper to create test messages in SerializedMessage format
 */
function createTestMessage(type: "human" | "ai" | "system", content: string) {
  return {
    data: { content, role: type, name: "" },
    type,
  };
}

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
      return await Promise.resolve(
        item
          ? {
              value: item,
              key,
              namespace: _namespace,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : null
      );
    },
    async put(namespace, key, value) {
      const namespaceKey = [...namespace, key].join("|");
      storedData.set(namespaceKey, value);
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
    messages: [createTestMessage("human", "Hello")] as unknown as BaseMessage[],
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
    messages: [createTestMessage("human", "Hello")] as unknown as BaseMessage[],
  };

  test("reflection stages buffer before processing to prevent message loss", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer with messages
    const initialBuffer = {
      messages: [createTestMessage("human", "Message 1")],
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
        addDocuments: async () => {
          return await Promise.resolve();
        },
      },
      extractSpeaker1: (_dialogue: string) => "Speaker1",
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60_000,
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
      messages: [createTestMessage("human", "Original message")],
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
        addDocuments: async (_docs: string[]) => {
          // Simulate slow reflection - during this time, new messages arrive
          await new Promise((resolve) => setTimeout(resolve, 100));
        },
      },
      extractSpeaker1: (_dialogue: string) => "Speaker1",
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        ...DEFAULT_REFLECTION_CONFIG,
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60_000,
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

    const _newMessage = createTestMessage(
      "human",
      "New message during reflection"
    );

    // Update live buffer while reflection is processing
    // Use mockStore.put since clearBuffer already updated internal store
    await mockStore.put(["rmm", "test-user", "buffer"], "message-buffer", {
      messages: [
        createTestMessage("human", "Original message"),
        createTestMessage("human", "New message during reflection"),
      ],
      humanMessageCount: 2,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    });

    await reflectionPromise;

    // Verify live buffer still has new message
    const liveBuffer = await mockStore.get(
      ["rmm", "test-user", "buffer"],
      "message-buffer"
    );
    expect(liveBuffer).not.toBeNull();
    expect(liveBuffer.value.messages).toHaveLength(2);
  });

  test("clearStaging clears only the staging area, not live buffer", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer and staged buffer
    const initialBuffer = {
      messages: [createTestMessage("human", "Message 1")],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const stagedContent = {
      messages: [createTestMessage("human", "Staged message")],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const storedBuffers = new Map<string, unknown>();
    storedBuffers.set("rmm|test-user|buffer|message-buffer", initialBuffer);
    storedBuffers.set(
      "rmm|test-user|buffer|staging|message-buffer",
      stagedContent
    );

    const mockStore = createAsyncMockStore(storedBuffers);

    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {
          return await Promise.resolve();
        },
      },
      extractSpeaker1: (_dialogue: string) => "Speaker1",
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        ...DEFAULT_REFLECTION_CONFIG,
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60_000,
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
      messages: [createTestMessage("human", "Message 1")],
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
        addDocuments: async () => {
          return await Promise.resolve();
        },
      },
      extractSpeaker1: (_dialogue: string) => "Speaker1",
      llm: {
        invoke: async () => ({ text: "NO_TRAIT" }),
      },
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        ...DEFAULT_REFLECTION_CONFIG,
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60_000,
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
    const mainBufferKey = "rmm|test-user|buffer|message-buffer";
    const mainBuffer = storedBuffers.get(mainBufferKey) as
      | { messages: unknown[] }
      | undefined;
    expect(mainBuffer).toBeDefined();
    expect(mainBuffer.messages).toHaveLength(0);

    // Verify staging buffer still exists with original content
    const stagingBufferKey = "rmm|test-user|buffer|staging|message-buffer";
    const stagingBuffer = storedBuffers.get(stagingBufferKey) as
      | { messages: unknown[] }
      | undefined;
    expect(stagingBuffer).toBeDefined();
    expect(stagingBuffer.messages).toHaveLength(1);
  });

  test("reflection reads from staging buffer, not snapshot argument", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer - use proper StoredMessage format
    const initialBuffer = {
      messages: [
        {
          type: "human",
          data: {
            content: "Original message",
          },
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const storedBuffers = new Map<string, unknown>();
    storedBuffers.set("rmm|test-user|buffer|message-buffer", initialBuffer);

    // Track what documents were passed to addDocuments
    let capturedDocuments: Array<{
      pageContent: string;
      metadata?: Record<string, unknown>;
    }> = [];

    const mockStore = createAsyncMockStore(storedBuffers);

    // Mock LLM that returns valid extraction output
    const mockLLM = {
      invoke: () => {
        const content = JSON.stringify({
          extracted_memories: [
            {
              summary: "User message about Original message",
              reference: [0],
            },
          ],
        });
        return { content, text: content };
      },
    };

    // Mock embeddings
    const mockEmbeddings = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
    };

    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async (
          docs: Array<{
            pageContent: string;
            metadata?: Record<string, unknown>;
          }>
        ) => {
          // Capture the documents being reflected
          capturedDocuments = docs;
          return await Promise.resolve();
        },
      },
      extractSpeaker1: (_dialogue: string) => "Speaker1",
      llm: mockLLM as any,
      embeddings: mockEmbeddings as any,
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        ...DEFAULT_REFLECTION_CONFIG,
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60_000,
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

    // First, trigger the middleware which starts async reflection
    await middleware.beforeAgent(sampleState, mockRuntime);

    // Wait for reflection to complete (it runs asynchronously)
    // We can detect completion by waiting for the captured documents
    let attempts = 0;
    while (capturedDocuments.length === 0 && attempts < 50) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      attempts++;
    }

    // Verify reflection processed documents from staging
    expect(capturedDocuments.length).toBe(1);
    expect(capturedDocuments[0].pageContent).toContain("Original message");
    // Verify metadata structure
    expect(capturedDocuments[0].metadata).toBeDefined();
    expect(typeof capturedDocuments[0].metadata?.id).toBe("string");
    expect(typeof capturedDocuments[0].metadata?.sessionId).toBe("string");
    expect(typeof capturedDocuments[0].metadata?.timestamp).toBe("number");
  });

  test("failed memory extraction clears staging buffer on graceful degradation", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer with messages - use proper StoredMessage format
    const initialBuffer = {
      messages: [
        {
          type: "human",
          data: {
            content: "Message 1",
          },
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const storedBuffers = new Map<string, unknown>();
    storedBuffers.set("rmm|test-user|buffer|message-buffer", initialBuffer);

    const mockStore = createAsyncMockStore(storedBuffers);

    // Make reflection fail by having LLM throw an error
    const mockLLM = {
      invoke: () => {
        throw new Error("LLM failed");
      },
    };

    const mockEmbeddings = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
    };

    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {
          return await Promise.resolve();
        },
      },
      extractSpeaker1: (_dialogue: string) => "Speaker1",
      llm: mockLLM as any,
      embeddings: mockEmbeddings as any,
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60_000,
        mode: "strict",
        retryDelayMs: 100, // Short delay for faster test
        maxRetries: 3,
      },
      reflectionDeps: mockDeps,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user",
        store: mockStore,
      },
    };

    // Trigger reflection (will fail gracefully)
    await middleware.beforeAgent(sampleState, mockRuntime);

    // Give async reflection time to fail gracefully
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify main buffer was cleared (empty messages)
    const mainBuffer = await mockStore.get(
      ["rmm", "test-user", "buffer"],
      "message-buffer"
    );
    expect(mainBuffer).not.toBeNull();
    expect(mainBuffer.value.messages).toHaveLength(0);

    // Verify staging buffer was cleared (graceful degradation on null/empty extraction)
    // Note: According to acceptance criteria, when extractMemories returns null,
    // we clear staging (graceful degradation) rather than preserving for retry.
    // Retry is only for network/LLM timeout errors, not caught errors.
    const stagingBuffer = await mockStore.get(
      ["rmm", "test-user", "buffer", "staging"],
      "message-buffer"
    );
    // Staging should exist but have empty messages (cleared to empty buffer)
    expect(stagingBuffer).not.toBeNull();
    expect(stagingBuffer.value.messages).toHaveLength(0);
  });

  test("addDocuments failure triggers retry logic", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer with messages
    const initialBuffer = {
      messages: [
        {
          type: "human",
          data: {
            content: "Message 1",
          },
        },
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const storedBuffers = new Map<string, unknown>();
    storedBuffers.set("rmm|test-user|buffer|message-buffer", initialBuffer);

    const mockStore = createAsyncMockStore(storedBuffers);

    // Capture addDocuments calls to track retry behavior
    let addDocumentsCalls = 0;

    // Mock LLM that returns valid extraction output
    const mockLLM = {
      invoke: () => {
        const content = JSON.stringify({
          extracted_memories: [
            {
              summary: "Test memory",
              reference: [0],
            },
          ],
        });
        return { content, text: content };
      },
    };

    const mockEmbeddings = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
    };

    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {
          addDocumentsCalls++;
          // Fail on first call to trigger retry
          if (addDocumentsCalls === 1) {
            throw new Error("Vector store connection failed");
          }
          return await Promise.resolve();
        },
      },
      extractSpeaker1: (_dialogue: string) => "Speaker1",
      llm: mockLLM as any,
      embeddings: mockEmbeddings as any,
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60_000,
        mode: "strict",
        retryDelayMs: 50, // Short delay for faster test
        maxRetries: 3,
      },
      reflectionDeps: mockDeps,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user",
        store: mockStore,
      },
    };

    // Trigger reflection (will retry after addDocuments failure)
    await middleware.beforeAgent(sampleState, mockRuntime);

    // Give retry logic time to execute (increased timeout for exponential backoff)
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify addDocuments was called at least twice (initial + retry)
    expect(addDocumentsCalls).toBeGreaterThanOrEqual(2);

    // Verify staging buffer was cleared after successful retry
    const stagingBuffer = await mockStore.get(
      ["rmm", "test-user", "buffer", "staging"],
      "message-buffer"
    );
    // After successful retry, staging should be cleared
    expect(stagingBuffer).not.toBeNull();
    expect(stagingBuffer.value.messages).toHaveLength(0);
  });

  test("new messages go to main buffer during failed reflection", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer with messages - use proper StoredMessage format
    const initialBuffer = {
      messages: [
        {
          type: "human",
          data: {
            content: "Message 1",
          },
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

    // Make reflection slow by having LLM delay before throwing
    const mockLLM = {
      invoke: async () => {
        // Mark that we've read from staging (in the extractMemories call)
        reflectionReadFromStaging = true;
        // Wait a bit to simulate slow processing
        await new Promise((resolve) => setTimeout(resolve, 100));
        // Then fail
        throw new Error("LLM failed");
      },
    };

    const mockEmbeddings = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
    };

    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {
          return await Promise.resolve();
        },
      },
      extractSpeaker1: (_dialogue: string) => "Speaker1",
      llm: mockLLM as any,
      embeddings: mockEmbeddings as any,
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60_000,
        mode: "strict",
        retryDelayMs: 100, // Short delay for faster test
        maxRetries: 3,
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
    let attempts = 0;
    while (!reflectionReadFromStaging && attempts < 100) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      attempts++;
    }

    expect(reflectionReadFromStaging).toBe(true);

    // Now add new message AFTER reflection has read from staging
    // New messages go to main buffer (which was cleared earlier)
    const newMessage = {
      type: "human",
      data: {
        content: "New message during failed reflection",
      },
    };

    // Update main buffer - new messages go here during failed reflection
    await mockStore.put(["rmm", "test-user", "buffer"], "message-buffer", {
      messages: [
        {
          type: "human",
          data: {
            content: "Message 1",
          },
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
    const mainBuffer = await mockStore.get(
      ["rmm", "test-user", "buffer"],
      "message-buffer"
    );
    expect(mainBuffer).not.toBeNull();
    expect(mainBuffer.value.messages).toHaveLength(2);
    expect(mainBuffer.value.messages[1].data.content).toBe(
      "New message during failed reflection"
    );
  });
});

/**
 * Tests for reflectionDeps interface extensions (Phase 1 & 2)
 * These tests verify that reflectionDeps can accept llm and embeddings
 */
describe("reflectionDeps Interface Extensions", () => {
  test("reflectionDeps accepts llm and embeddings dependencies", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Mock dependencies with new interface
    const mockLLM = {
      invoke: async () => ({ content: "Test response", text: "Test response" }),
    };

    const mockEmbeddings = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
    };

    const mockVectorStore = {
      similaritySearch: async (_query: string) => [],
      addDocuments: async (
        _documents: Array<{
          pageContent: string;
          metadata?: Record<string, unknown>;
        }>
      ) => {
        return await Promise.resolve();
      },
    };

    const mockExtractSpeaker1 = (_dialogue: string) => "Speaker1";

    // This should compile without type errors
    const reflectionDeps = {
      vectorStore: mockVectorStore,
      extractSpeaker1: mockExtractSpeaker1,
      llm: mockLLM,
      embeddings: mockEmbeddings,
    };

    // Create middleware with extended reflectionDeps
    const middleware = createRetrospectiveBeforeAgent({
      store: {
        get: () => null,
        put: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        batch: () => [],
        search: () => [],
        listNamespaces: () => [],
      },
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionDeps: reflectionDeps as BeforeAgentOptions["reflectionDeps"],
    });

    expect(middleware).toBeDefined();
  });

  test("reflectionDeps is optional and can be undefined", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Should work without reflectionDeps
    const middleware = createRetrospectiveBeforeAgent({
      store: {
        get: () => null,
        put: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        batch: () => [],
        search: () => [],
        listNamespaces: () => [],
      },
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      // No reflectionDeps - should be backward compatible
    });

    expect(middleware).toBeDefined();
  });

  test("addDocuments signature accepts {pageContent, metadata} objects", async () => {
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    const mockVectorStore = {
      similaritySearch: async (_query: string) => [],
      addDocuments: async (
        documents: Array<{
          pageContent: string;
          metadata?: Record<string, unknown>;
        }>
      ) => {
        // Verify document structure
        expect(documents).toBeDefined();
        expect(Array.isArray(documents)).toBe(true);
        expect(documents[0].pageContent).toBeDefined();
        expect(documents[0].metadata).toBeDefined();
        return await Promise.resolve();
      },
    };

    const mockExtractSpeaker1 = (_dialogue: string) => "Speaker1";

    const middleware = createRetrospectiveBeforeAgent({
      store: {
        get: () => null,
        put: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        batch: () => [],
        search: () => [],
        listNamespaces: () => [],
      },
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionDeps: {
        vectorStore: mockVectorStore,
        extractSpeaker1: mockExtractSpeaker1,
      },
    });

    expect(middleware).toBeDefined();
  });

  test("extracts memories from both SPEAKER_1 and SPEAKER_2 when extractSpeaker2 provided", async () => {
    const sampleState = {
      messages: [createTestMessage("human", "Hello")],
    };
    const { createRetrospectiveBeforeAgent } = await import(
      "@/middleware/hooks/before-agent"
    );

    // Initial buffer with a dialogue
    const initialBuffer = {
      messages: [
        createTestMessage("human", "I love hiking"),
        createTestMessage("ai", "I enjoy recommending trails!"),
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const storedBuffers = new Map<string, unknown>();
    storedBuffers.set("rmm|test-user|buffer|message-buffer", initialBuffer);

    const capturedDocuments: Array<{
      pageContent: string;
      metadata?: Record<string, unknown>;
    }> = [];

    const mockStore = createAsyncMockStore(storedBuffers);

    // Track which speaker prompts were invoked
    const invokedPrompts: string[] = [];

    // LLM that returns different memories depending on which prompt is used
    const mockLLM = {
      invoke: (promptText: string) => {
        let content: string;
        if (promptText.includes("SPEAKER_2_PROMPT")) {
          invokedPrompts.push("speaker2");
          content = JSON.stringify({
            extracted_memories: [
              { summary: "Agent enjoys recommending trails", reference: [0] },
            ],
          });
        } else {
          invokedPrompts.push("speaker1");
          content = JSON.stringify({
            extracted_memories: [
              { summary: "User loves hiking", reference: [0] },
            ],
          });
        }
        return { content, text: content };
      },
    };

    const mockEmbeddings = {
      embedQuery: async () => Array.from({ length: 1536 }, () => 0.5),
      embedDocuments: async () => [Array.from({ length: 1536 }, () => 0.5)],
    };

    const mockDeps = {
      vectorStore: {
        similaritySearch: async () => {
          return await Promise.resolve([]);
        },
        addDocuments: async (
          docs: Array<{
            pageContent: string;
            metadata?: Record<string, unknown>;
          }>
        ) => {
          await Promise.resolve();
          capturedDocuments.push(...docs);
        },
      },
      extractSpeaker1: (dialogue: string) => `SPEAKER_1_PROMPT: ${dialogue}`,
      extractSpeaker2: (dialogue: string) => `SPEAKER_2_PROMPT: ${dialogue}`,
      llm: mockLLM as any,
      embeddings: mockEmbeddings as any,
    };

    const middleware = createRetrospectiveBeforeAgent({
      store: mockStore as any,
      userIdExtractor: (runtime: BeforeAgentRuntime) => runtime.context.userId,
      reflectionConfig: {
        ...DEFAULT_REFLECTION_CONFIG,
        minTurns: 1,
        maxTurns: 10,
        minInactivityMs: 0,
        maxInactivityMs: 60_000,
        mode: "strict",
      },
      reflectionDeps: mockDeps,
    });

    const mockRuntime: BeforeAgentRuntime = {
      context: {
        userId: "test-user",
        store: mockStore as any,
      },
    };

    await middleware.beforeAgent(sampleState, mockRuntime);

    // Wait for async reflection
    let attempts = 0;
    while (capturedDocuments.length < 2 && attempts < 100) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      attempts++;
    }

    // Both speaker prompts should have been invoked
    expect(invokedPrompts).toContain("speaker1");
    expect(invokedPrompts).toContain("speaker2");

    // Should have stored memories from both speakers
    expect(capturedDocuments.length).toBe(2);
    const summaries = capturedDocuments.map((d) => d.pageContent);
    expect(summaries).toContain("User loves hiking");
    expect(summaries).toContain("Agent enjoys recommending trails");
  });
});
