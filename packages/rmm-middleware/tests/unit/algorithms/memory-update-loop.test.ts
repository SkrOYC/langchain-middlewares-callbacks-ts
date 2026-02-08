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
    const { processMemoryUpdate } = await import("@/algorithms/memory-update");

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
        return await Promise.resolve([
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
        ]);
      },
      addDocuments: async () => {
        await Promise.resolve();
        callLog.push("addDocuments");
      },
      delete: async () => {
        await Promise.resolve();
        callLog.push("delete");
      },
    };

    // Mock LLM that returns Add() decision
    const mockLlm = {
      invoke: async () => {
        await Promise.resolve();
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
    const { processMemoryUpdate } = await import("@/algorithms/memory-update");

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
        await Promise.resolve();
        addedDocs.push(...docs);
      },
      delete: async (opts: { ids: string[] }) => {
        await Promise.resolve();
        deletedIds.push(...opts.ids);
      },
    };

    // Mock LLM that returns Merge decision
    const mockLlm = {
      invoke: async () => {
        await Promise.resolve();
        return {
          text: "Merge(0, User exercises every Monday and works out regularly.)",
        };
      },
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
    const { processMemoryUpdate } = await import("@/algorithms/memory-update");

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
      similaritySearch: async () => {
        return await Promise.resolve([]);
      },
      addDocuments: async (docs: Array<{ pageContent: string }>) => {
        await Promise.resolve();
        addedDocs.push(...docs);
      },
    };

    const mockLlm = {
      invoke: async () => {
        await Promise.resolve();
        return { text: "Add()" };
      },
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
    const { processMemoryUpdate } = await import("@/algorithms/memory-update");

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
      similaritySearch: async () => {
        return await Promise.resolve([
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
        ]);
      },
      addDocuments: async (docs: Array<{ pageContent: string }>) => {
        await Promise.resolve();
        addedDocs.push(...docs);
      },
      delete: async () => {
        // No documents to delete in this test case
        await Promise.resolve();
      },
    };

    // LLM returns a response that parses to multiple Add actions
    const mockLlm = {
      invoke: async () => {
        await Promise.resolve();
        return { text: "Add()\nAdd()" };
      },
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
    const { processMemoryUpdate } = await import("@/algorithms/memory-update");

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
      similaritySearch: async () => {
        return await Promise.resolve([
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
        ]);
      },
      addDocuments: async (docs: Array<{ pageContent: string }>) => {
        await Promise.resolve();
        addedDocs.push(...docs);
      },
      delete: async (opts: { ids: string[] }) => {
        await Promise.resolve();
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
    expect(
      addedDocs.some((d) => d.pageContent.includes("runs marathons"))
    ).toBe(true);

    // Should NOT have also added the raw memory as a separate entry
    // (only the merge result should be added)
    expect(addedDocs.length).toBe(1);
  });

  test("dedupes merge actions with same index - only first executes", async () => {
    const { processMemoryUpdate } = await import("@/algorithms/memory-update");

    const addedDocs: Array<{ pageContent: string }> = [];
    const deletedIds: string[] = [];

    const mockMemory: MemoryEntry = {
      id: "550e8400-e29b-41d4-a716-446655440005",
      topicSummary: "User exercises every Monday and Thursday",
      rawDialogue: "I exercise every Monday and Thursday",
      timestamp: Date.now(),
      sessionId: "session-1",
      embedding: new Array(1536).fill(0.1),
      turnReferences: [0],
    };

    const existingMemory = {
      id: "existing-mem-1",
      topicSummary: "User works out although he doesn't particularly enjoy it.",
      rawDialogue: "I work out but don't enjoy it",
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
        await Promise.resolve();
        addedDocs.push(...docs);
      },
      delete: async (opts: { ids: string[] }) => {
        await Promise.resolve();
        deletedIds.push(...opts.ids);
      },
    };

    // Mock LLM that returns duplicate Merge actions with same index
    const mockLlm = {
      invoke: async () => ({
        text: "Merge(0, User exercises every Monday and Thursday.)\nMerge(0, User exercises every Monday and Thursday, although he doesn't enjoy it.)",
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

    // Should have deleted only once (not twice for duplicate index)
    expect(deletedIds).toEqual([existingMemory.id]);
    // Should have added only once (not twice for duplicate index)
    expect(addedDocs.length).toBe(1);
    // Should use the FIRST merged summary (first-wins strategy)
    expect(addedDocs[0]?.pageContent).toBe(
      "User exercises every Monday and Thursday."
    );
  });

  test("executes all merge actions with different indices", async () => {
    const { processMemoryUpdate } = await import("@/algorithms/memory-update");

    const addedDocs: Array<{ pageContent: string }> = [];
    const deletedIds: string[] = [];

    const mockMemory: MemoryEntry = {
      id: "550e8400-e29b-41d4-a716-446655440006",
      topicSummary: "User is active and enjoys various sports",
      rawDialogue: "I'm active and enjoy sports",
      timestamp: Date.now(),
      sessionId: "session-1",
      embedding: new Array(1536).fill(0.1),
      turnReferences: [0],
    };

    const existingMemory1 = {
      id: "existing-mem-1",
      topicSummary: "User likes running",
      rawDialogue: "I like running",
      timestamp: Date.now() - 100_000,
      sessionId: "session-0",
      turnReferences: [0],
      relevanceScore: 0.9,
    };

    const existingMemory2 = {
      id: "existing-mem-2",
      topicSummary: "User plays tennis",
      rawDialogue: "I play tennis",
      timestamp: Date.now() - 200_000,
      sessionId: "session-0",
      turnReferences: [1],
      relevanceScore: 0.85,
    };

    const existingMemory3 = {
      id: "existing-mem-3",
      topicSummary: "User swims regularly",
      rawDialogue: "I swim regularly",
      timestamp: Date.now() - 300_000,
      sessionId: "session-0",
      turnReferences: [2],
      relevanceScore: 0.8,
    };

    const mockVectorStore = {
      similaritySearch: async () => [
        {
          pageContent: existingMemory1.topicSummary,
          metadata: {
            id: existingMemory1.id,
            sessionId: existingMemory1.sessionId,
            timestamp: existingMemory1.timestamp,
            turnReferences: existingMemory1.turnReferences,
            rawDialogue: existingMemory1.rawDialogue,
          },
        },
        {
          pageContent: existingMemory2.topicSummary,
          metadata: {
            id: existingMemory2.id,
            sessionId: existingMemory2.sessionId,
            timestamp: existingMemory2.timestamp,
            turnReferences: existingMemory2.turnReferences,
            rawDialogue: existingMemory2.rawDialogue,
          },
        },
        {
          pageContent: existingMemory3.topicSummary,
          metadata: {
            id: existingMemory3.id,
            sessionId: existingMemory3.sessionId,
            timestamp: existingMemory3.timestamp,
            turnReferences: existingMemory3.turnReferences,
            rawDialogue: existingMemory3.rawDialogue,
          },
        },
      ],
      addDocuments: async (docs: Array<{ pageContent: string }>) => {
        await Promise.resolve();
        addedDocs.push(...docs);
      },
      delete: async (opts: { ids: string[] }) => {
        await Promise.resolve();
        deletedIds.push(...opts.ids);
      },
    };

    // Mock LLM that returns Merge actions for different indices
    const mockLlm = {
      invoke: async () => ({
        text: "Merge(0, User likes running and is active.)\nMerge(1, User plays tennis and enjoys sports.)\nMerge(2, User swims regularly and is active.)",
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

    // Should have deleted three different memories
    expect(deletedIds).toHaveLength(3);
    expect(deletedIds).toContain(existingMemory1.id);
    expect(deletedIds).toContain(existingMemory2.id);
    expect(deletedIds).toContain(existingMemory3.id);

    // Should have added three merged documents
    expect(addedDocs.length).toBe(3);

    // Verify all three merged summaries are present
    const summaries = addedDocs.map((d) => d.pageContent);
    expect(
      summaries.some((s) => s.includes("likes running and is active"))
    ).toBe(true);
    expect(
      summaries.some((s) => s.includes("plays tennis and enjoys sports"))
    ).toBe(true);
    expect(
      summaries.some((s) => s.includes("swims regularly and is active"))
    ).toBe(true);
  });
});
