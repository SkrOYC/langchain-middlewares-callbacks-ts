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

  describe("sampleWithoutReplacement", () => {
    test("should export sampleWithoutReplacement function", async () => {
      const { sampleWithoutReplacement } = await import(
        "@/utils/memory-helpers"
      );
      expect(typeof sampleWithoutReplacement).toBe("function");
    });

    test("returns exactly topM indices", async () => {
      const { sampleWithoutReplacement } = await import(
        "@/utils/memory-helpers"
      );

      const probabilities = [0.1, 0.3, 0.5, 0.05, 0.05];
      const topM = 3;

      const result = sampleWithoutReplacement(probabilities, topM);

      expect(result.length).toBe(topM);
    });

    test("returns unique indices (no duplicates)", async () => {
      const { sampleWithoutReplacement } = await import(
        "@/utils/memory-helpers"
      );

      const probabilities = [0.2, 0.2, 0.2, 0.2, 0.2];
      const topM = 5;

      const result = sampleWithoutReplacement(probabilities, topM);

      // All indices should be unique
      const uniqueIndices = new Set(result);
      expect(uniqueIndices.size).toBe(result.length);
    });

    test("handles topM larger than probabilities array", async () => {
      const { sampleWithoutReplacement } = await import(
        "@/utils/memory-helpers"
      );

      const probabilities = [0.5, 0.5];
      const topM = 10; // More than available

      const result = sampleWithoutReplacement(probabilities, topM);

      // Should return all available indices
      expect(result.length).toBe(2);
    });

    test("handles topM of 0", async () => {
      const { sampleWithoutReplacement } = await import(
        "@/utils/memory-helpers"
      );

      const probabilities = [0.1, 0.3, 0.5];
      const topM = 0;

      const result = sampleWithoutReplacement(probabilities, topM);

      expect(result.length).toBe(0);
    });

    test("higher probability items should be selected more often", async () => {
      const { sampleWithoutReplacement } = await import(
        "@/utils/memory-helpers"
      );

      // Item 2 has much higher probability
      const probabilities = [0.01, 0.01, 0.98];
      const topM = 1;

      // Run multiple times and check that index 2 is selected most often
      let index2Count = 0;
      let index0Count = 0;
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        const result = sampleWithoutReplacement(probabilities, topM);
        if (result[0] === 2) {
          index2Count++;
        } else if (result[0] === 0) {
          index0Count++;
        }
      }

      // Index 2 (98% probability) should be selected more often than index 0 (1% probability)
      expect(index2Count).toBeGreaterThan(index0Count);
    });
  });
});
