import { describe, expect, test } from "bun:test";

/**
 * Tests for memory update decision algorithm
 *
 * These tests verify that decideUpdateAction():
 * 1. Add decision parsed correctly
 * 2. Merge decision parsed correctly
 * 3. Multiple decisions handled
 * 4. Invalid decision returns empty array
 */

describe("decideUpdateAction Algorithm", () => {
  // Helper to suppress console.warn during error-handling tests
  const suppressWarnings = async (fn: () => Promise<void>) => {
    const originalWarn = console.warn;
    console.warn = () => {
      // intentionally empty - suppresses console.warn during error-handling tests
    };
    try {
      await fn();
    } finally {
      console.warn = originalWarn;
    }
  };

  // Sample new memory for testing
  const sampleNewMemory = {
    id: "new-memory-123",
    topicSummary: "User started running marathons",
    rawDialogue: "I ran my first marathon last weekend",
    timestamp: Date.now(),
    sessionId: "session-456",
    embedding: Array.from({ length: 1536 }, () => Math.random()),
    turnReferences: [0],
  };

  // Sample similar memories for context
  const sampleSimilarMemories = [
    {
      id: "existing-memory-1",
      topicSummary: "User enjoys outdoor activities like hiking",
      rawDialogue: "I went hiking this weekend",
      timestamp: Date.now() - 100_000,
      sessionId: "session-123",
      embedding: Array.from({ length: 1536 }, () => Math.random()),
      turnReferences: [0],
      relevanceScore: 0.85,
    },
    {
      id: "existing-memory-2",
      topicSummary: "User is a software engineer",
      rawDialogue: "I work with TypeScript",
      timestamp: Date.now() - 200_000,
      sessionId: "session-123",
      embedding: Array.from({ length: 1536 }, () => Math.random()),
      turnReferences: [1],
      relevanceScore: 0.45,
    },
  ];

  test("should export decideUpdateAction function", async () => {
    const { decideUpdateAction } = await import("@/algorithms/memory-update");
    expect(typeof decideUpdateAction).toBe("function");
  });

  test("Add decision parsed correctly", async () => {
    const { decideUpdateAction } = await import("@/algorithms/memory-update");

    // Mock LLM that returns Add() decision
    const mockSummarizationModelAdd = {
      invoke: () => {
        const content = "Add()";
        return { content, text: content };
      },
    };

    // Mock updateMemory prompt function
    const mockUpdatePrompt = (
      historySummaries: string[],
      newSummary: string
    ): string => {
      return `History: ${JSON.stringify(historySummaries)}\nNew: ${newSummary}`;
    };

    const result = await decideUpdateAction(
      sampleNewMemory as any,
      sampleSimilarMemories as any,
      mockSummarizationModelAdd as any,
      mockUpdatePrompt
    );

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result?.length).toBe(1);
    expect(result?.[0]).toEqual({ action: "Add" });
  });

  test("Merge decision parsed correctly", async () => {
    const { decideUpdateAction } = await import("@/algorithms/memory-update");

    // Mock LLM that returns Merge() decision
    const mockSummarizationModelMerge = {
      invoke: () => {
        const content =
          "Merge(0, User enjoys outdoor activities like hiking and running marathons)";
        return { content, text: content };
      },
    };

    // Mock updateMemory prompt function
    const mockUpdatePrompt = (
      historySummaries: string[],
      newSummary: string
    ): string => {
      return `History: ${JSON.stringify(historySummaries)}\nNew: ${newSummary}`;
    };

    const result = await decideUpdateAction(
      sampleNewMemory as any,
      sampleSimilarMemories as any,
      mockSummarizationModelMerge as any,
      mockUpdatePrompt
    );

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result?.length).toBe(1);
    expect(result?.[0]).toEqual({
      action: "Merge",
      index: 0,
      merged_summary:
        "User enjoys outdoor activities like hiking and running marathons",
    });
  });

  test("Multiple decisions handled", async () => {
    const { decideUpdateAction } = await import("@/algorithms/memory-update");

    // Mock LLM that returns multiple decisions
    const mockSummarizationModelMultiple = {
      invoke: () => {
        const content =
          "Merge(0, Updated summary 1)\nMerge(1, Updated summary 2)\nAdd()";
        return { content, text: content };
      },
    };

    // Mock updateMemory prompt function
    const mockUpdatePrompt = (
      historySummaries: string[],
      newSummary: string
    ): string => {
      return `History: ${JSON.stringify(historySummaries)}\nNew: ${newSummary}`;
    };

    const result = await decideUpdateAction(
      sampleNewMemory as any,
      sampleSimilarMemories as any,
      mockSummarizationModelMultiple as any,
      mockUpdatePrompt
    );

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result?.length).toBe(3);
    expect(result?.[0]).toEqual({
      action: "Merge",
      index: 0,
      merged_summary: "Updated summary 1",
    });
    expect(result?.[1]).toEqual({
      action: "Merge",
      index: 1,
      merged_summary: "Updated summary 2",
    });
    expect(result?.[2]).toEqual({ action: "Add" });
  });

  test("Invalid decision returns empty array", async () => {
    const { decideUpdateAction } = await import("@/algorithms/memory-update");

    // Mock LLM that returns invalid decision
    const mockSummarizationModelInvalid = {
      invoke: () => {
        const content = "InvalidAction()";
        return { content, text: content };
      },
    };

    // Mock updateMemory prompt function
    const mockUpdatePrompt = (
      historySummaries: string[],
      newSummary: string
    ): string => {
      return `History: ${JSON.stringify(historySummaries)}\nNew: ${newSummary}`;
    };

    const result = await decideUpdateAction(
      sampleNewMemory as any,
      sampleSimilarMemories as any,
      mockSummarizationModelInvalid as any,
      mockUpdatePrompt
    );

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result?.length).toBe(0);
  });

  test("LLM failure returns empty array", async () => {
    await suppressWarnings(async () => {
      const { decideUpdateAction } = await import("@/algorithms/memory-update");

      // Mock LLM that returns invalid action (triggers error handling)
      const mockSummarizationModelError = {
        invoke: () => {
          const content = "InvalidActionFormat";
          return { content, text: content };
        },
      };

      // Mock updateMemory prompt function
      const mockUpdatePrompt = (
        historySummaries: string[],
        newSummary: string
      ): string => {
        return `History: ${JSON.stringify(historySummaries)}\nNew: ${newSummary}`;
      };

      const result = await decideUpdateAction(
        sampleNewMemory as any,
        sampleSimilarMemories as any,
        mockSummarizationModelError as any,
        mockUpdatePrompt
      );

      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(true);
      expect(result?.length).toBe(0);
    });
  });

  test("Empty similar memories uses empty array for history", async () => {
    const { decideUpdateAction } = await import("@/algorithms/memory-update");

    const capturedInputs: Array<{ history: string[]; new: string }> = [];

    // Mock LLM that captures inputs
    const mockSummarizationModelCapture = {
      invoke: (_input: string) => {
        const content = "Add()";
        return { content, text: content };
      },
    };

    // Mock updateMemory prompt function that captures inputs
    const mockUpdatePromptCapture = (
      historySummaries: string[],
      newSummary: string
    ): string => {
      capturedInputs.push({
        history: historySummaries,
        new: newSummary,
      });
      return `History: ${JSON.stringify(historySummaries)}\nNew: ${newSummary}`;
    };

    await decideUpdateAction(
      sampleNewMemory as any,
      [],
      mockSummarizationModelCapture as any,
      mockUpdatePromptCapture
    );

    expect(capturedInputs.length).toBe(1);
    expect(capturedInputs[0].history).toEqual([]);
    expect(capturedInputs[0].new).toBe(sampleNewMemory.topicSummary);
  });

  test("Formats similar memories as history summaries", async () => {
    const { decideUpdateAction } = await import("@/algorithms/memory-update");

    const capturedInputs: Array<{ history: string[]; new: string }> = [];

    // Mock LLM that captures inputs
    const mockSummarizationModelCapture = {
      invoke: (_input: string) => {
        const content = "Add()";
        return { content, text: content };
      },
    };

    // Mock updateMemory prompt function that captures inputs
    const mockUpdatePromptCapture = (
      historySummaries: string[],
      newSummary: string
    ): string => {
      capturedInputs.push({
        history: historySummaries,
        new: newSummary,
      });
      return `History: ${JSON.stringify(historySummaries)}\nNew: ${newSummary}`;
    };

    await decideUpdateAction(
      sampleNewMemory as any,
      sampleSimilarMemories as any,
      mockSummarizationModelCapture as any,
      mockUpdatePromptCapture
    );

    expect(capturedInputs.length).toBe(1);
    expect(capturedInputs[0].history).toEqual([
      "User enjoys outdoor activities like hiking",
      "User is a software engineer",
    ]);
    expect(capturedInputs[0].new).toBe(sampleNewMemory.topicSummary);
  });

  test("Handles out-of-bounds Merge index gracefully", async () => {
    const { decideUpdateAction } = await import("@/algorithms/memory-update");

    // Mock LLM that returns out-of-bounds Merge index
    const mockSummarizationModelOutOfBounds = {
      invoke: () => {
        return {
          content: "Merge(10, Some merged summary)",
        };
      },
    };

    // Mock updateMemory prompt function
    const mockUpdatePrompt = (
      historySummaries: string[],
      newSummary: string
    ): string => {
      return `History: ${JSON.stringify(historySummaries)}\nNew: ${newSummary}`;
    };

    const result = await decideUpdateAction(
      sampleNewMemory as any,
      sampleSimilarMemories as any,
      mockSummarizationModelOutOfBounds as any,
      mockUpdatePrompt
    );

    // Out-of-bounds indices should be filtered out, returning empty array
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result?.length).toBe(0);
  });

  test("Uses provided updatePrompt function", async () => {
    const { decideUpdateAction } = await import("@/algorithms/memory-update");

    const customPromptCalled: boolean[] = [];

    // Mock LLM
    const mockSummarizationModel = {
      invoke: () => {
        return { content: "Add()" };
      },
    };

    // Custom prompt function that marks itself as called
    const customUpdatePrompt = (
      historySummaries: string[],
      newSummary: string
    ): string => {
      customPromptCalled.push(true);
      return `CUSTOM: ${historySummaries.length} memories, new: ${newSummary}`;
    };

    await decideUpdateAction(
      sampleNewMemory as any,
      sampleSimilarMemories as any,
      mockSummarizationModel as any,
      customUpdatePrompt
    );

    expect(customPromptCalled.length).toBe(1);
  });
});
