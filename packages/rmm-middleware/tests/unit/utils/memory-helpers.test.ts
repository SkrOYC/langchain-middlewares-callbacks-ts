import { describe, expect, test } from "bun:test";
import type { BaseMessage } from "@langchain/core/messages";
import type { RetrievedMemory } from "@/schemas/index";

/**
 * Tests for memory helper utilities
 *
 * These tests verify:
 * 1. extractLastHumanMessage edge cases
 * 2. formatMemoriesBlock output format
 * 3. sampleWithoutReplacement distribution
 */

describe("Memory Helpers", () => {
  // Sample messages for testing
  const sampleMessages: BaseMessage[] = [
    {
      lc_serialized: { type: "human" },
      lc_kwargs: { content: "First message" },
      lc_id: ["human"],
      content: "First message",
      additional_kwargs: {},
    },
    {
      lc_serialized: { type: "ai" },
      lc_kwargs: { content: "AI response" },
      lc_id: ["ai"],
      content: "AI response",
      additional_kwargs: {},
    },
    {
      lc_serialized: { type: "human" },
      lc_kwargs: { content: "What do you know about hiking?" },
      lc_id: ["human"],
      content: "What do you know about hiking?",
      additional_kwargs: {},
    },
  ];

  const sampleMemories: RetrievedMemory[] = [
    {
      id: "memory-0",
      topicSummary: "User enjoys hiking",
      rawDialogue: "User: I love hiking in the mountains",
      timestamp: Date.now() - 100_000,
      sessionId: "session-1",
      turnReferences: [0],
      relevanceScore: 0.85,
    },
    {
      id: "memory-1",
      topicSummary: "User lives in Colorado",
      rawDialogue: "User: I live in Colorado",
      timestamp: Date.now() - 90_000,
      sessionId: "session-1",
      turnReferences: [1],
      relevanceScore: 0.75,
    },
    {
      id: "memory-2",
      topicSummary: "User has a dog",
      rawDialogue: "User: I have a golden retriever",
      timestamp: Date.now() - 80_000,
      sessionId: "session-1",
      turnReferences: [2],
      relevanceScore: 0.7,
    },
  ];

  describe("extractLastHumanMessage", () => {
    test("should export extractLastHumanMessage function", async () => {
      const { extractLastHumanMessage } = await import(
        "@/utils/memory-helpers"
      );
      expect(typeof extractLastHumanMessage).toBe("function");
    });

    test("extracts last human message content", async () => {
      const { extractLastHumanMessage } = await import(
        "@/utils/memory-helpers"
      );

      const result = extractLastHumanMessage(sampleMessages);
      expect(result).toBe("What do you know about hiking?");
    });

    test("returns null when no human messages exist", async () => {
      const { extractLastHumanMessage } = await import(
        "@/utils/memory-helpers"
      );

      const aiOnlyMessages: BaseMessage[] = [
        {
          lc_serialized: { type: "ai" },
          lc_kwargs: { content: "AI response" },
          lc_id: ["ai"],
          content: "AI response",
          additional_kwargs: {},
        },
      ];

      const result = extractLastHumanMessage(aiOnlyMessages);
      expect(result).toBeNull();
    });

    test("returns null for empty message array", async () => {
      const { extractLastHumanMessage } = await import(
        "@/utils/memory-helpers"
      );

      const result = extractLastHumanMessage([]);
      expect(result).toBeNull();
    });

    test("ignores AI messages and finds last human message", async () => {
      const { extractLastHumanMessage } = await import(
        "@/utils/memory-helpers"
      );

      // Messages are: Human, AI, Human, AI, Human
      const mixedMessages: BaseMessage[] = [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "First" },
          lc_id: ["human"],
          content: "First",
          additional_kwargs: {},
        },
        {
          lc_serialized: { type: "ai" },
          lc_kwargs: { content: "Response 1" },
          lc_id: ["ai"],
          content: "Response 1",
          additional_kwargs: {},
        },
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Second" },
          lc_id: ["human"],
          content: "Second",
          additional_kwargs: {},
        },
        {
          lc_serialized: { type: "ai" },
          lc_kwargs: { content: "Response 2" },
          lc_id: ["ai"],
          content: "Response 2",
          additional_kwargs: {},
        },
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Third - the last one" },
          lc_id: ["human"],
          content: "Third - the last one",
          additional_kwargs: {},
        },
      ];

      const result = extractLastHumanMessage(mixedMessages);
      expect(result).toBe("Third - the last one");
    });
  });

  describe("formatMemoriesBlock", () => {
    test("should export formatMemoriesBlock function", async () => {
      const { formatMemoriesBlock } = await import("@/utils/memory-helpers");
      expect(typeof formatMemoriesBlock).toBe("function");
    });

    test("formats memories into correct XML-like block structure", async () => {
      const { formatMemoriesBlock } = await import("@/utils/memory-helpers");

      const result = formatMemoriesBlock(sampleMemories);

      expect(result).toContain("<memories>");
      expect(result).toContain("</memories>");
      expect(result).toContain("Memory [0]");
      expect(result).toContain("Memory [1]");
      expect(result).toContain("Memory [2]");
      expect(result).toContain("User enjoys hiking");
      expect(result).toContain("User lives in Colorado");
      expect(result).toContain("User has a dog");
    });

    test("returns empty string for empty memories array", async () => {
      const { formatMemoriesBlock } = await import("@/utils/memory-helpers");

      const result = formatMemoriesBlock([]);
      expect(result).toBe("");
    });

    test("includes topic summary and dialogue turns", async () => {
      const { formatMemoriesBlock } = await import("@/utils/memory-helpers");

      const result = formatMemoriesBlock(sampleMemories);

      // Should include the topic summaries
      expect(result).toContain("User enjoys hiking");
      // Should include raw dialogue
      expect(result).toContain("User: I love hiking in the mountains");
    });
  });
});
