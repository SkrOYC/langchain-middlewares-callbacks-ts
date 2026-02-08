/**
 * Tests for memory merge/add decision loop in processReflection
 *
 * Verifies that extracted memories go through the merge/add decision
 * pipeline (Algorithm 1 lines 9-11) instead of being blindly added.
 */

import { describe, expect, test } from "bun:test";
import type { MemoryEntry, RetrievedMemory } from "@/schemas";

/**
 * Extracted and testable version of the per-memory update logic.
 * This tests the function that should be called from processReflection
 * for each extracted memory.
 */
describe("processMemoryUpdate", () => {
  test("calls findSimilarMemories then decideUpdateAction for each extracted memory", async () => {
    const { processMemoryUpdate } = await import(
      "@/algorithms/memory-update"
    );

    const callLog: string[] = [];

    const mockMemory: MemoryEntry = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      topicSummary: "User enjoys hiking",
      rawDialogue: "I love hiking on weekends",
      timestamp: Date.now(),
      sessionId: "session-1",
      embedding: new Array(1536).fill(0.1),
      turnReferences: [0, 1],
    };

    const existingMemory: RetrievedMemory = {
      id: "existing-mem-1",
      topicSummary: "User likes outdoor activities",
      rawDialogue: "I go outdoors a lot",
      timestamp: Date.now() - 100_000,
      sessionId: "session-0",
      turnReferences: [0],
      relevanceScore: 0.8,
    };

    // Mock vectorStore with similaritySearch
    const mockVectorStore = {
      similaritySearch: async (_query: string, _k?: number) => {
        callLog.push("similaritySearch");
        return [
          {
            pageContent: existingMemory.topicSummary,
            metadata: {
              id: existingMemory.id,
              sessionId: existingMemory.sessionId,
              timestamp: existingMemory.timestamp,
              turnReferences: existingMemory.turnReferences,
              rawDialogue: existingMemory.rawDialogue,
            },
          },
        ];
      },
      addDocuments: async () => {
        callLog.push("addDocuments");
      },
      delete: async () => {
        callLog.push("delete");
      },
    };

    // Mock LLM that returns Add() decision
    const mockLlm = {
      invoke: async () => {
        callLog.push("llm-invoke");
        return { text: "Add()" };
      },
    };

    // Mock update prompt
    const mockUpdatePrompt = (history: string[], newSummary: string) => {
      callLog.push("updatePrompt");
      return `Update: ${newSummary} vs ${history.join(", ")}`;
    };

    await processMemoryUpdate(
      mockMemory,
      mockVectorStore as any,
      mockLlm as any,
      mockUpdatePrompt
    );

    // Should have called similaritySearch first
    expect(callLog).toContain("similaritySearch");
    // Should have called the update prompt builder
    expect(callLog).toContain("updatePrompt");
    // Should have called LLM for decision
    expect(callLog).toContain("llm-invoke");
    // Should have added the document (since decision was "Add()")
    expect(callLog).toContain("addDocuments");
  });

  test("performs merge when LLM decides Merge", async () => {
    const { processMemoryUpdate } = await import(
      "@/algorithms/memory-update"
    );

    const addedDocs: Array<{ pageContent: string }> = [];
    const deletedIds: string[] = [];

    const mockMemory: MemoryEntry = {
      id: "550e8400-e29b-41d4-a716-446655440001",
      topicSummary: "User exercises every Monday",
      rawDialogue: "I exercise every Monday",
      timestamp: Date.now(),
      sessionId: "session-1",
      embedding: new Array(1536).fill(0.1),
      turnReferences: [0],
    };

    const existingMemory = {
      id: "existing-mem-1",
      topicSummary: "User works out regularly",
      rawDialogue: "I work out a lot",
      timestamp: Date.now() - 100_000,
      sessionId: "session-0",
      turnReferences: [0],
      relevanceScore: 0.9,
    };

    const mockVectorStore = {
      similaritySearch: async () => [
        {
          pageContent: existingMemory.topicSummary,
          metadata: {
            id: existingMemory.id,
            sessionId: existingMemory.sessionId,
            timestamp: existingMemory.timestamp,
            turnReferences: existingMemory.turnReferences,
            rawDialogue: existingMemory.rawDialogue,
          },
        },
      ],
      addDocuments: async (docs: Array<{ pageContent: string }>) => {
        addedDocs.push(...docs);
      },
      delete: async (opts: { ids: string[] }) => {
        deletedIds.push(...opts.ids);
      },
    };

    // Mock LLM that returns Merge decision
    const mockLlm = {
      invoke: async () => ({
        text: "Merge(0, User exercises every Monday and works out regularly.)",
      }),
    };

    const mockUpdatePrompt = (history: string[], newSummary: string) =>
      `Update: ${newSummary} vs ${history.join(", ")}`;

    await processMemoryUpdate(
      mockMemory,
      mockVectorStore as any,
      mockLlm as any,
      mockUpdatePrompt
    );

    // Should have deleted old memory and added merged version
    expect(deletedIds).toContain(existingMemory.id);
    expect(addedDocs.length).toBeGreaterThan(0);
    expect(addedDocs[0]?.pageContent).toContain("exercises every Monday");
  });

  test("falls back to add when no similar memories found", async () => {
    const { processMemoryUpdate } = await import(
      "@/algorithms/memory-update"
    );

    const addedDocs: Array<{ pageContent: string }> = [];

    const mockMemory: MemoryEntry = {
      id: "550e8400-e29b-41d4-a716-446655440002",
      topicSummary: "User likes pizza",
      rawDialogue: "I love pizza",
      timestamp: Date.now(),
      sessionId: "session-1",
      embedding: new Array(1536).fill(0.1),
      turnReferences: [0],
    };

    const mockVectorStore = {
      similaritySearch: async () => [],
      addDocuments: async (docs: Array<{ pageContent: string }>) => {
        addedDocs.push(...docs);
      },
    };

    const mockLlm = {
      invoke: async () => ({ text: "Add()" }),
    };

    const mockUpdatePrompt = (history: string[], newSummary: string) =>
      `Update: ${newSummary} vs ${history.join(", ")}`;

    await processMemoryUpdate(
      mockMemory,
      mockVectorStore as any,
      mockLlm as any,
      mockUpdatePrompt
    );

    // Should directly add since no similar memories
    expect(addedDocs.length).toBe(1);
    expect(addedDocs[0]?.pageContent).toBe("User likes pizza");
  });

  test("does not duplicate memory when multiple Add actions returned", async () => {
    const { processMemoryUpdate } = await import(
      "@/algorithms/memory-update"
    );

    const addedDocs: Array<{ pageContent: string }> = [];

    const mockMemory: MemoryEntry = {
      id: "550e8400-e29b-41d4-a716-446655440003",
      topicSummary: "User likes tea",
      rawDialogue: "I drink tea daily",
      timestamp: Date.now(),
      sessionId: "session-1",
      embedding: new Array(1536).fill(0.1),
      turnReferences: [0],
    };

    const mockVectorStore = {
      similaritySearch: async () => [
        {
          pageContent: "User drinks coffee",
          metadata: {
            id: "existing-1",
            sessionId: "s-0",
            timestamp: Date.now() - 100_000,
            turnReferences: [0],
            rawDialogue: "I drink coffee",
          },
        },
      ],
      addDocuments: async (docs: Array<{ pageContent: string }>) => {
        addedDocs.push(...docs);
      },
      delete: async () => {},
    };

    // LLM returns a response that parses to multiple Add actions
    const mockLlm = {
      invoke: async () => ({ text: "Add()\nAdd()" }),
    };

    const mockUpdatePrompt = (history: string[], newSummary: string) =>
      `Update: ${newSummary} vs ${history.join(", ")}`;

    await processMemoryUpdate(
      mockMemory,
      mockVectorStore as any,
      mockLlm as any,
      mockUpdatePrompt
    );

    // The paper describes an exclusive add-or-merge decision.
    // Even if the parser returns multiple Add actions, we should only add once.
    expect(addedDocs.length).toBe(1);
    expect(addedDocs[0]?.pageContent).toBe("User likes tea");
  });

  test("prioritizes Merge over Add when both action types returned", async () => {
    const { processMemoryUpdate } = await import(
      "@/algorithms/memory-update"
    );

    const addedDocs: Array<{ pageContent: string }> = [];
    const deletedIds: string[] = [];

    const mockMemory: MemoryEntry = {
      id: "550e8400-e29b-41d4-a716-446655440004",
      topicSummary: "User runs marathons",
      rawDialogue: "I run marathons",
      timestamp: Date.now(),
      sessionId: "session-1",
      embedding: new Array(1536).fill(0.1),
      turnReferences: [0],
    };

    const mockVectorStore = {
      similaritySearch: async () => [
        {
          pageContent: "User exercises regularly",
          metadata: {
            id: "existing-2",
            sessionId: "s-0",
            timestamp: Date.now() - 100_000,
            turnReferences: [0],
            rawDialogue: "I exercise a lot",
          },
        },
      ],
      addDocuments: async (docs: Array<{ pageContent: string }>) => {
        addedDocs.push(...docs);
      },
      delete: async (opts: { ids: string[] }) => {
        deletedIds.push(...opts.ids);
      },
    };

    // LLM returns both a Merge and an Add
    const mockLlm = {
      invoke: async () => ({
        text: "Merge(0, User exercises regularly and runs marathons.)\nAdd()",
      }),
    };

    const mockUpdatePrompt = (history: string[], newSummary: string) =>
      `Update: ${newSummary} vs ${history.join(", ")}`;

    await processMemoryUpdate(
      mockMemory,
      mockVectorStore as any,
      mockLlm as any,
      mockUpdatePrompt
    );

    // Merge should take priority - the old memory is deleted and replaced
    expect(deletedIds).toContain("existing-2");
    expect(addedDocs.some((d) => d.pageContent.includes("runs marathons"))).toBe(true);

    // Should NOT have also added the raw memory as a separate entry
    // (only the merge result should be added)
    expect(addedDocs.length).toBe(1);
  });
});
