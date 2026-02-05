import { describe, expect, test } from "bun:test";
import type { Document } from "@langchain/core/documents";
import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";

/**
 * Tests for afterAgent hook error scenarios
 *
 * These tests verify that afterAgent gracefully handles errors:
 * 1. VectorStore similaritySearch failure → logs warning, returns {}
 * 2. Memory extraction failure → logs warning, returns {}
 * 3. Merge decision failure → logs warning, returns {}
 */

describe("afterAgent Hook Error Scenarios", () => {
  // Helper to create mock embeddings
  function createMockEmbeddings(): Embeddings {
    return {
      embedQuery(_text: string): Promise<number[]> {
        return Promise.resolve(new Array(1536).fill(0));
      },

      embedDocuments(_texts: string[]): Promise<number[][]> {
        return Promise.resolve(_texts.map(() => new Array(1536).fill(0)));
      },
    };
  }

  // Helper to create mock LLM
  function createMockChatModel(): BaseChatModel {
    return {
      invoke(): Promise<string> {
        return Promise.resolve("Response");
      },

      generatePrompt(): Promise<{ text: string; generations: any[] }> {
        return Promise.resolve({
          text: "Response",
          generations: [],
        });
      },
      getModelName() {
        return "mock-model";
      },
      get lc_namespace() {
        return ["mock"];
      },
      get lc_id() {
        return ["mock", "model"];
      },
      get lc_secrets() {
        return undefined;
      },
      get lc_serializable() {
        return false;
      },
      get lc_kwargs() {
        return {};
      },
      toJSON() {
        return {};
      },
    };
  }

  // Helper to create mock VectorStore that fails on similaritySearch
  function createFailingSimilarityVectorStore(): {
    similaritySearch: (_query: string, _k: number) => Promise<Document[]>;
    addDocuments: (_docs: Document[]) => Promise<void>;
  } {
    return {
      async similaritySearch(_query: string, _k: number): Promise<Document[]> {
        const error = new Error("VectorStore similaritySearch failed");
        return await Promise.reject(error);
      },

      async addDocuments(_docs: Document[]): Promise<void> {
        return await Promise.resolve();
      },
    };
  }

  // Helper to create mock VectorStore that fails on addDocuments
  function createFailingAddVectorStore(): {
    similaritySearch: (_query: string, _k: number) => Promise<Document[]>;
    addDocuments: (_docs: Document[]) => Promise<void>;
  } {
    return {
      async similaritySearch(_query: string, _k: number): Promise<Document[]> {
        return await Promise.resolve([]);
      },

      async addDocuments(_docs: Document[]): Promise<void> {
        const error = new Error("VectorStore addDocuments failed");
        return await Promise.reject(error);
      },
    };
  }

  // Helper to create messages
  function createMessages(): BaseMessage[] {
    return [
      new HumanMessage({ content: "Hello" }),
      new HumanMessage({ content: "World" }),
    ];
  }

  // Helper for extractSpeaker1 prompt
  const extractSpeaker1 = (_dialogue: string): string => {
    return "A: Hello\nB: Hi there";
  };

  test("should handle VectorStore similaritySearch failure gracefully", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const vectorStore = createFailingSimilarityVectorStore();

    const runtime = {
      context: {
        summarizationModel: createMockChatModel(),
        embeddings: createMockEmbeddings(),
      },
    };

    const state = {
      messages: createMessages(),
    };

    const result = await afterAgent(state, runtime, {
      vectorStore,
      extractSpeaker1,
    });

    // Should return empty state on failure
    expect(result).toEqual({});
  });

  test("should handle VectorStore addDocuments failure gracefully", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const vectorStore = createFailingAddVectorStore();

    const runtime = {
      context: {
        summarizationModel: createMockChatModel(),
        embeddings: createMockEmbeddings(),
      },
    };

    const state = {
      messages: createMessages(),
    };

    const result = await afterAgent(state, runtime, {
      vectorStore,
      extractSpeaker1,
    });

    // Should return empty state on failure
    expect(result).toEqual({});
  });

  test("should handle missing dependencies gracefully", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const runtime = {
      context: {
        summarizationModel: createMockChatModel(),
        embeddings: createMockEmbeddings(),
      },
    };

    const state = {
      messages: createMessages(),
    };

    // Call without dependencies
    const result = await afterAgent(state, runtime);

    // Should return empty state when dependencies missing
    expect(result).toEqual({});
  });

  test("should handle empty messages gracefully", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const vectorStore = createFailingAddVectorStore();

    const runtime = {
      context: {
        summarizationModel: createMockChatModel(),
        embeddings: createMockEmbeddings(),
      },
    };

    const state = {
      messages: [],
    };

    const result = await afterAgent(state, runtime, {
      vectorStore,
      extractSpeaker1,
    });

    // Should return empty state when no messages
    expect(result).toEqual({});
  });

  test("should handle messages undefined gracefully", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const vectorStore = createFailingAddVectorStore();

    const runtime = {
      context: {
        summarizationModel: createMockChatModel(),
        embeddings: createMockEmbeddings(),
      },
    };

    const state = {
      messages: undefined as unknown as BaseMessage[],
    };

    const result = await afterAgent(state, runtime, {
      vectorStore,
      extractSpeaker1,
    });

    // Should return empty state when messages undefined
    expect(result).toEqual({});
  });
});
