import { describe, expect, test } from "bun:test";

import type { BaseMessage } from "@langchain/core/messages";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

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

interface AfterAgentRuntime {
  context: {
    summarizationModel: BaseChatModel;
    embeddings: Embeddings;
  };
  dependencies?: {
    vectorStore: VectorStoreInterface;
    extractSpeaker1: (dialogue: string) => string;
    updateMemory?: (history: string[], newSummary: string) => string;
  };
}

describe("afterAgent Hook", () => {
  // Sample state for testing
  const sampleState: AfterAgentState = {
    messages: [
      { lc_serialized: { type: "human" }, lc_kwargs: { content: "Hello, I went hiking this weekend" }, lc_id: ["human"], content: "Hello, I went hiking this weekend", additional_kwargs: {} },
      { lc_serialized: { type: "ai" }, lc_kwargs: { content: "That sounds great!" }, lc_id: ["ai"], content: "That sounds great!", additional_kwargs: {} },
      { lc_serialized: { type: "human" }, lc_kwargs: { content: "It was amazing, I love being outdoors" }, lc_id: ["human"], content: "It was amazing, I love being outdoors", additional_kwargs: {} },
      { lc_serialized: { type: "ai" }, lc_kwargs: { content: "What else do you enjoy?" }, lc_id: ["ai"], content: "What else do you enjoy?", additional_kwargs: {} },
    ],
  };

  test("should export afterAgent function", async () => {
    const { afterAgent } = await import(
      "@/middleware/hooks/after-agent"
    );
    expect(typeof afterAgent).toBe("function");
  });

  test("full pipeline executes successfully", async () => {
    const { afterAgent } = await import(
      "@/middleware/hooks/after-agent"
    );

    // Mock dependencies
    const mockSummarizationModel = {
      invoke: async () => {
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
      similaritySearch: async () => [],
      addDocuments: async () => {
        addDocumentsCalled = true;
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
    };

    const result = await afterAgent(sampleState, mockRuntime, mockDeps);

    expect(result).not.toBeNull();
    expect(addDocumentsCalled).toBe(true);
  });

  test("no memories extracted → no VectorStore calls", async () => {
    const { afterAgent } = await import(
      "@/middleware/hooks/after-agent"
    );

    // Mock dependencies that return NO_TRAIT
    const mockSummarizationModel = {
      invoke: async () => {
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
      similaritySearch: async () => {
        vectorStoreCalled = true;
        return [];
      },
      addDocuments: async () => {
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
    const { afterAgent } = await import(
      "@/middleware/hooks/after-agent"
    );

    const emptyState = {
      messages: [],
    };

    let modelCalled = false;

    const mockSummarizationModel = {
      invoke: async () => {
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
      similaritySearch: async () => [],
      addDocuments: async () => {},
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
    const { afterAgent } = await import(
      "@/middleware/hooks/after-agent"
    );

    // Mock LLM that returns invalid content (triggers error handling)
    const mockSummarizationModel = {
      invoke: async () => {
        const content = "not valid json that will fail";
        return { content, text: content };
      },
    };

    const mockEmbeddings = {
      embedDocuments: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
    };

    const mockVectorStore = {
      similaritySearch: async () => [],
      addDocuments: async () => {},
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
    const { afterAgent } = await import(
      "@/middleware/hooks/after-agent"
    );

    // Mock dependencies that return multiple memories
    const mockSummarizationModel = {
      invoke: async () => {
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
      similaritySearch: async () => [],
      addDocuments: async () => {
        memoriesProcessed += 1;
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
    };

    const result5 = await afterAgent(sampleState, mockRuntime5, mockDeps5);

    expect(result5).not.toBeNull();
    expect(memoriesProcessed).toBe(3);
  });

  test("handles merge decisions correctly", async () => {
    const { afterAgent } = await import(
      "../../../../src/middleware/hooks/after-agent"
    );

    // Track call count to distinguish between extraction and decision
    let callCount = 0;

    // Mock dependencies for extraction that returns a memory
    const mockSummarizationModel = {
      invoke: async (input: string) => {
        callCount++;
        if (callCount === 1) {
          // First call: extraction response
          const content = JSON.stringify({
            extracted_memories: [
              { summary: "User enjoys outdoor activities", reference: [0] },
            ],
          });
          return { content, text: content };
        } else {
          // Second call: decision response
          const content = "Merge(0, User enjoys outdoor activities and hiking)";
          return { content, text: content };
        }
      },
    };

    const mockEmbeddings = {
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    let addCalled = false;

    const mockVectorStore = {
      similaritySearch: async () => [
        {
          pageContent: "User likes hiking",
          metadata: {
            id: "existing-memory-1",
            sessionId: "session-123",
            timestamp: Date.now() - 100000,
            turnReferences: [0],
          },
        },
      ],
      delete: async () => {},
      addDocuments: async () => {
        addCalled = true;
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
    };

    const result6 = await afterAgent(sampleState, mockRuntime6, mockDeps6);

    expect(result6).not.toBeNull();
    expect(addCalled).toBe(true);
  });

  test("returns empty object on success", async () => {
    const { afterAgent } = await import(
      "../../../../src/middleware/hooks/after-agent"
    );

    // Mock dependencies
    const mockSummarizationModel = {
      invoke: async () => {
        const content = "NO_TRAIT";
        return { content, text: content };
      },
    };

    const mockEmbeddings = {
      embedDocuments: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
    };

    const mockVectorStore = {
      similaritySearch: async () => [],
      addDocuments: async () => {},
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
});
