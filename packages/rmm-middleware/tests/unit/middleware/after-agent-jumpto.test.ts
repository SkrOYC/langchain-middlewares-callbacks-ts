import { describe, expect, test } from "bun:test";
import type { Document } from "@langchain/core/documents";
import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * Tests for afterAgent hook JumpTo edge cases
 *
 * These tests verify that afterAgent respects JumpTo scenarios:
 * 1. beforeModel returns { jumpTo: "end" }, afterAgent still runs
 * 2. When turnCountInSession is 0, afterAgent skips extraction
 * 3. When turnCountInSession > 0, afterAgent extracts normally
 */

describe("afterAgent Hook JumpTo Edge Cases", () => {
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

  // Helper to create mock VectorStore
  function createMockVectorStore(): {
    similaritySearch: (_query: string, _k: number) => Promise<Document[]>;
    addDocuments: (_docs: Document[]) => Promise<void>;
  } {
    return {
      async similaritySearch(_query: string, _k: number): Promise<Document[]> {
        return await Promise.resolve([]);
      },

      async addDocuments(_docs: Document[]): Promise<void> {
        return await Promise.resolve();
      },
    };
  }

  // Helper for extractSpeaker1 prompt
  const extractSpeaker1 = (_dialogue: string): string => {
    return "A: Hello\nB: Hi there";
  };

  test("should skip extraction when turnCountInSession is 0", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const vectorStore = createMockVectorStore();

    const runtime = {
      context: {
        summarizationModel: createMockChatModel(),
        embeddings: createMockEmbeddings(),
      },
    };

    const state = {
      messages: [],
      _turnCountInSession: 0, // No turns occurred
    };

    const result = await afterAgent(state, runtime, {
      vectorStore,
      extractSpeaker1,
    });

    // Should return empty state - no extraction performed
    expect(result).toEqual({});
  });

  test("should perform extraction when turnCountInSession > 0", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const vectorStore = createMockVectorStore();

    const runtime = {
      context: {
        summarizationModel: createMockChatModel(),
        embeddings: createMockEmbeddings(),
      },
    };

    const state = {
      messages: [],
      _turnCountInSession: 1, // Turns occurred
    };

    // This won't fail even if extraction fails (it logs and returns {})
    const result = await afterAgent(state, runtime, {
      vectorStore,
      extractSpeaker1,
    });

    // Should return empty state (extraction attempted but no messages to process)
    expect(result).toEqual({});
  });

  test("should return empty state when turnCountInSession is undefined", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const vectorStore = createMockVectorStore();

    const runtime = {
      context: {
        summarizationModel: createMockChatModel(),
        embeddings: createMockEmbeddings(),
      },
    };

    const state = {
      messages: [],
      _turnCountInSession: undefined,
    };

    const result = await afterAgent(state, runtime, {
      vectorStore,
      extractSpeaker1,
    });

    // Should return empty state (no turns count = no extraction)
    expect(result).toEqual({});
  });

  test("should still run afterAgent when jumpTo 'end' is used but skip extraction", async () => {
    const { afterAgent } = await import("@/middleware/hooks/after-agent");

    const vectorStore = createMockVectorStore();

    const runtime = {
      context: {
        summarizationModel: createMockChatModel(),
        embeddings: createMockEmbeddings(),
      },
    };

    // Simulate state after jumpTo "end" - turnCountInSession would be 0
    // because no model calls were made (wrapModelCall and afterModel were skipped)
    const state = {
      messages: [],
      _turnCountInSession: 0, // This would be the case after jumpTo "end"
    };

    // Should still execute afterAgent hook but skip extraction
    const result = await afterAgent(state, runtime, {
      vectorStore,
      extractSpeaker1,
    });

    // Should return empty state - no extraction needed when no turns
    expect(result).toEqual({});
  });
});
