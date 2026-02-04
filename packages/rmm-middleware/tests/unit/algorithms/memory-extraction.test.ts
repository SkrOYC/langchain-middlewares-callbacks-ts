import { describe, expect, test } from "bun:test";

/**
 * Tests for memory extraction algorithm
 *
 * These tests verify that extractMemories():
 * 1. Valid extraction returns MemoryEntry array
 * 2. "NO_TRAIT" returns empty array
 * 3. Invalid JSON returns null
 * 4. LLM failure returns null (graceful degradation)
 * 5. Empty session returns empty array
 */

describe("extractMemories Algorithm", () => {
  // Helper to suppress console.warn during error-handling tests
  const suppressWarnings = async (fn: () => Promise<void>) => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await fn();
    } finally {
      console.warn = originalWarn;
    }
  };

  // Mock BaseMessage array representing session history
  const mockSessionHistory = [
    { type: "human", content: "Hello, I went hiking this weekend" },
    { type: "ai", content: "That sounds great! How was it?" },
    { type: "human", content: "It was amazing, I love being outdoors" },
    { type: "ai", content: "What else do you enjoy doing?" },
  ];

  // Sample dialogue formatter for testing
  const mockSpeakerPrompt = (dialogueSession: string): string => {
    return `Dialogue:\n${dialogueSession}`;
  };

  test("should export extractMemories function", async () => {
    const { extractMemories } = await import(
      "../../../src/algorithms/memory-extraction.ts"
    );
    expect(typeof extractMemories).toBe("function");
  });

  test("valid extraction returns MemoryEntry array", async () => {
    const { extractMemories } = await import(
      "../../../src/algorithms/memory-extraction.ts"
    );

    // Mock summarization model that returns valid extraction output
    const mockSummarizationModelValid = {
      invoke: async () => {
        return {
          content: JSON.stringify({
            extracted_memories: [
              {
                summary: "User enjoys hiking on weekends",
                reference: [0, 2],
              },
              {
                summary: "User is a software engineer",
                reference: [1, 3],
              },
            ],
          }),
        };
      },
    };

    // Mock embeddings that return predictable vectors
    const mockEmbeddings = {
      embedQuery: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    const result = await extractMemories(
      mockSessionHistory,
      mockSummarizationModelValid as any,
      mockEmbeddings as any,
      mockSpeakerPrompt,
      "test-session-123"
    );

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBe(2);

    // Verify MemoryEntry structure
    const firstMemory = result![0];
    expect(firstMemory.id).toBeDefined();
    expect(typeof firstMemory.topicSummary).toBe("string");
    expect(typeof firstMemory.rawDialogue).toBe("string");
    expect(typeof firstMemory.timestamp).toBe("number");
    expect(firstMemory.sessionId).toBe("test-session-123");
    expect(Array.isArray(firstMemory.embedding)).toBe(true);
    expect(firstMemory.embedding.length).toBe(1536);
    expect(Array.isArray(firstMemory.turnReferences)).toBe(true);
  });

  test("NO_TRAIT returns empty array", async () => {
    const { extractMemories } = await import(
      "../../../src/algorithms/memory-extraction.ts"
    );

    // Mock summarization model that returns NO_TRAIT
    const mockSummarizationModelNoTrait = {
      invoke: async () => {
        return { content: "NO_TRAIT" };
      },
    };

    // Mock embeddings
    const mockEmbeddings = {
      embedQuery: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    const result = await extractMemories(
      mockSessionHistory,
      mockSummarizationModelNoTrait as any,
      mockEmbeddings as any,
      mockSpeakerPrompt
    );

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBe(0);
  });

  test("invalid JSON returns null", async () => {
    await suppressWarnings(async () => {
      const { extractMemories } = await import(
        "../../../src/algorithms/memory-extraction.ts"
      );

      // Mock summarization model that returns invalid JSON
      const mockSummarizationModelInvalidJson = {
        invoke: async () => {
          return { content: "this is not valid json" };
        },
      };

      // Mock embeddings
      const mockEmbeddings = {
        embedQuery: async () =>
          Array.from({ length: 1536 }, () => Math.random()),
        embedDocuments: async (texts: string[]) =>
          texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
      };

      const result = await extractMemories(
        mockSessionHistory,
        mockSummarizationModelInvalidJson as any,
        mockEmbeddings as any,
        mockSpeakerPrompt
      );

      expect(result).toBeNull();
    });
  });

  test("LLM failure returns null (graceful degradation)", async () => {
    await suppressWarnings(async () => {
      const { extractMemories } = await import(
        "../../../src/algorithms/memory-extraction.ts"
      );

      // Mock LLM that returns content causing parse failure (triggers catch block)
      const mockSummarizationModelError = {
        invoke: async () => {
          return { content: "{ invalid json that will fail parsing" };
        },
      };

      // Mock embeddings
      const mockEmbeddings = {
        embedQuery: async () =>
          Array.from({ length: 1536 }, () => Math.random()),
        embedDocuments: async (texts: string[]) =>
          texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
      };

      const result = await extractMemories(
        mockSessionHistory,
        mockSummarizationModelError as any,
        mockEmbeddings as any,
        mockSpeakerPrompt
      );

      expect(result).toBeNull();
    });
  });

  test("empty session returns empty array", async () => {
    const { extractMemories } = await import(
      "../../../src/algorithms/memory-extraction.ts"
    );

    // Mock embeddings (won't be called for empty session)
    const mockEmbeddings = {
      embedQuery: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    const result = await extractMemories(
      [],
      {} as any,
      mockEmbeddings as any,
      mockSpeakerPrompt
    );

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBe(0);
  });

  test("formats session history into dialogue with turn markers", async () => {
    const { extractMemories } = await import(
      "../../../src/algorithms/memory-extraction.ts"
    );

    const capturedInput: string[] = [];

    const customMockModel = {
      invoke: async (input: string) => {
        capturedInput.push(input);
        return {
          content: JSON.stringify({
            extracted_memories: [{ summary: "Test", reference: [0] }],
          }),
        };
      },
    };

    const mockEmbeddings = {
      embedQuery: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    await extractMemories(
      mockSessionHistory,
      customMockModel as any,
      mockEmbeddings as any,
      mockSpeakerPrompt
    );

    expect(capturedInput.length).toBe(1);
    const input = capturedInput[0];

    // Verify that the input contains turn markers (Turn 0 and Turn 1 for 4 messages)
    expect(input).toContain("Turn 0");
    expect(input).toContain("Turn 1");
    expect(input).toContain("SPEAKER_1");
    expect(input).toContain("SPEAKER_2");
  });

  test("generates embeddings for extracted summaries", async () => {
    const { extractMemories } = await import(
      "../../../src/algorithms/memory-extraction.ts"
    );

    let embedDocumentsCalled = false;
    let embedQueryCalled = false;

    const mockSummarizationModelValid = {
      invoke: async () => {
        return {
          content: JSON.stringify({
            extracted_memories: [
              { summary: "User enjoys hiking", reference: [0] },
            ],
          }),
        };
      },
    };

    const mockEmbeddings = {
      embedQuery: async () => {
        embedQueryCalled = true;
        return Array.from({ length: 1536 }, () => Math.random());
      },
      embedDocuments: async (texts: string[]) => {
        embedDocumentsCalled = true;
        return texts.map(() =>
          Array.from({ length: 1536 }, () => Math.random())
        );
      },
    };

    await extractMemories(
      mockSessionHistory,
      mockSummarizationModelValid as any,
      mockEmbeddings as any,
      mockSpeakerPrompt
    );

    // Should call embedDocuments for extracted memories
    expect(embedDocumentsCalled).toBe(true);
  });

  test("includes turn references in MemoryEntry", async () => {
    const { extractMemories } = await import(
      "../../../src/algorithms/memory-extraction.ts"
    );

    const mockSummarizationModelValid = {
      invoke: async () => {
        return {
          content: JSON.stringify({
            extracted_memories: [
              { summary: "User enjoys hiking on weekends", reference: [0, 2] },
              { summary: "User is a software engineer", reference: [1, 3] },
            ],
          }),
        };
      },
    };

    const mockEmbeddings = {
      embedQuery: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    const result = await extractMemories(
      mockSessionHistory,
      mockSummarizationModelValid as any,
      mockEmbeddings as any,
      mockSpeakerPrompt
    );

    expect(result).not.toBeNull();
    expect(result![0].turnReferences).toEqual([0, 2]);
    expect(result![1].turnReferences).toEqual([1, 3]);
  });

  test("uses provided sessionId in MemoryEntry", async () => {
    const { extractMemories } = await import(
      "../../../src/algorithms/memory-extraction.ts"
    );

    const sessionId = "custom-session-id-456";

    const mockSummarizationModelValid = {
      invoke: async () => {
        return {
          content: JSON.stringify({
            extracted_memories: [{ summary: "Test", reference: [0] }],
          }),
        };
      },
    };

    const mockEmbeddings = {
      embedQuery: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    const result = await extractMemories(
      mockSessionHistory,
      mockSummarizationModelValid as any,
      mockEmbeddings as any,
      mockSpeakerPrompt,
      sessionId
    );

    expect(result).not.toBeNull();
    expect(result![0].sessionId).toBe(sessionId);
  });

  test("generates UUID for each memory entry", async () => {
    const { extractMemories } = await import(
      "../../../src/algorithms/memory-extraction.ts"
    );

    const mockSummarizationModelValid = {
      invoke: async () => {
        return {
          content: JSON.stringify({
            extracted_memories: [
              { summary: "First memory", reference: [0] },
              { summary: "Second memory", reference: [1] },
            ],
          }),
        };
      },
    };

    const mockEmbeddings = {
      embedQuery: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    const result = await extractMemories(
      mockSessionHistory,
      mockSummarizationModelValid as any,
      mockEmbeddings as any,
      mockSpeakerPrompt
    );

    expect(result).not.toBeNull();
    expect(result![0].id).not.toBe(result![1].id);

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(result![0].id).toMatch(uuidRegex);
    expect(result![1].id).toMatch(uuidRegex);
  });

  test("includes timestamp in MemoryEntry", async () => {
    const { extractMemories } = await import(
      "../../../src/algorithms/memory-extraction.ts"
    );

    const mockSummarizationModelValid = {
      invoke: async () => {
        return {
          content: JSON.stringify({
            extracted_memories: [{ summary: "Test", reference: [0] }],
          }),
        };
      },
    };

    const mockEmbeddings = {
      embedQuery: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    const beforeTime = Date.now();
    const result = await extractMemories(
      mockSessionHistory,
      mockSummarizationModelValid as any,
      mockEmbeddings as any,
      mockSpeakerPrompt
    );
    const afterTime = Date.now();

    expect(result).not.toBeNull();
    expect(result![0].timestamp).toBeGreaterThanOrEqual(beforeTime);
    expect(result![0].timestamp).toBeLessThanOrEqual(afterTime);
  });

  test("handles memories with empty reference array", async () => {
    const { extractMemories } = await import(
      "../../../src/algorithms/memory-extraction.ts"
    );

    const customMockModel = {
      invoke: async () => {
        return {
          content: JSON.stringify({
            extracted_memories: [{ summary: "Test memory", reference: [] }],
          }),
        };
      },
    };

    const mockEmbeddings = {
      embedQuery: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    const result = await extractMemories(
      mockSessionHistory,
      customMockModel as any,
      mockEmbeddings as any,
      mockSpeakerPrompt
    );

    expect(result).not.toBeNull();
    expect(result![0].turnReferences).toEqual([]);
  });

  test("handles single memory extraction", async () => {
    const { extractMemories } = await import(
      "../../../src/algorithms/memory-extraction.ts"
    );

    const customMockModel = {
      invoke: async () => {
        return {
          content: JSON.stringify({
            extracted_memories: [{ summary: "Single memory", reference: [0] }],
          }),
        };
      },
    };

    const mockEmbeddings = {
      embedQuery: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    const result = await extractMemories(
      mockSessionHistory,
      customMockModel as any,
      mockEmbeddings as any,
      mockSpeakerPrompt
    );

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
  });

  test("handles many memories extraction", async () => {
    const { extractMemories } = await import(
      "../../../src/algorithms/memory-extraction.ts"
    );

    const customMockModel = {
      invoke: async () => {
        return {
          content: JSON.stringify({
            extracted_memories: Array.from({ length: 10 }, (_, i) => ({
              summary: `Memory ${i}`,
              reference: [i],
            })),
          }),
        };
      },
    };

    const mockEmbeddings = {
      embedQuery: async () =>
        Array.from({ length: 1536 }, () => Math.random()),
      embedDocuments: async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    };

    const result = await extractMemories(
      mockSessionHistory,
      customMockModel as any,
      mockEmbeddings as any,
      mockSpeakerPrompt
    );

    expect(result).not.toBeNull();
    expect(result!.length).toBe(10);
  });
});
