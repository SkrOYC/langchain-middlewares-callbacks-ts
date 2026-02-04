import { describe, expect, test } from "bun:test";

/**
 * Tests for formatMemories utility
 *
 * This utility formats memories into the XML-like block structure
 * required by the generateWithCitations prompt.
 */

interface TestMemory {
  topicSummary: string;
  dialogueTurns: Array<{ speaker: string; text: string }>;
}

describe("formatMemories Utility", () => {
  test("should export a formatMemories function", async () => {
    const { formatMemories } = await import(
      "@/middleware/prompts/format-memories"
    );
    expect(typeof formatMemories).toBe("function");
  });

  test("should return empty string for empty array", async () => {
    const { formatMemories } = await import(
      "@/middleware/prompts/format-memories"
    );
    const result = formatMemories([]);
    expect(result).toBe("");
  });

  test("should wrap memories in <memories> tags", async () => {
    const { formatMemories } = await import(
      "@/middleware/prompts/format-memories"
    );
    const memories: TestMemory[] = [
      {
        topicSummary: "User enjoys hiking",
        dialogueTurns: [
          { speaker: "Speaker 1", text: "I love hiking on weekends" },
        ],
      },
    ];
    const result = formatMemories(memories);
    expect(result).toContain("<memories>");
    expect(result).toContain("</memories>");
  });

  test("should format memory with index", async () => {
    const { formatMemories } = await import(
      "@/middleware/prompts/format-memories"
    );
    const memories: TestMemory[] = [
      {
        topicSummary: "User enjoys hiking",
        dialogueTurns: [
          { speaker: "Speaker 1", text: "I love hiking on weekends" },
        ],
      },
    ];
    const result = formatMemories(memories);
    expect(result).toContain("Memory [0]:");
  });

  test("should format memory with topicSummary", async () => {
    const { formatMemories } = await import(
      "@/middleware/prompts/format-memories"
    );
    const memories: TestMemory[] = [
      {
        topicSummary: "User enjoys hiking",
        dialogueTurns: [
          { speaker: "Speaker 1", text: "I love hiking on weekends" },
        ],
      },
    ];
    const result = formatMemories(memories);
    expect(result).toContain("User enjoys hiking");
  });

  test("should format dialogue turns with speaker labels", async () => {
    const { formatMemories } = await import(
      "@/middleware/prompts/format-memories"
    );
    const memories: TestMemory[] = [
      {
        topicSummary: "User enjoys hiking",
        dialogueTurns: [
          { speaker: "Speaker 1", text: "I love hiking on weekends" },
        ],
      },
    ];
    const result = formatMemories(memories);
    expect(result).toContain("Speaker 1:");
    expect(result).toContain("I love hiking on weekends");
  });

  test("should handle multiple dialogue turns", async () => {
    const { formatMemories } = await import(
      "@/middleware/prompts/format-memories"
    );
    const memories: TestMemory[] = [
      {
        topicSummary: "User enjoys hiking",
        dialogueTurns: [
          { speaker: "Speaker 1", text: "I love hiking on weekends" },
          { speaker: "Speaker 2", text: "That sounds amazing!" },
        ],
      },
    ];
    const result = formatMemories(memories);
    expect(result).toContain("Speaker 1:");
    expect(result).toContain("Speaker 2:");
    expect(result).toContain("I love hiking on weekends");
    expect(result).toContain("That sounds amazing!");
  });

  test("should handle multiple memories with sequential indices", async () => {
    const { formatMemories } = await import(
      "@/middleware/prompts/format-memories"
    );
    const memories: TestMemory[] = [
      {
        topicSummary: "User enjoys hiking",
        dialogueTurns: [{ speaker: "Speaker 1", text: "I love hiking" }],
      },
      {
        topicSummary: "User plays guitar",
        dialogueTurns: [{ speaker: "Speaker 1", text: "I play guitar" }],
      },
      {
        topicSummary: "User likes astronomy",
        dialogueTurns: [{ speaker: "Speaker 1", text: "I like stars" }],
      },
    ];
    const result = formatMemories(memories);
    expect(result).toContain("Memory [0]:");
    expect(result).toContain("Memory [1]:");
    expect(result).toContain("Memory [2]:");
  });

  test("should handle special characters in dialogue", async () => {
    const { formatMemories } = await import(
      "@/middleware/prompts/format-memories"
    );
    const memories: TestMemory[] = [
      {
        topicSummary: "User's quote",
        dialogueTurns: [
          { speaker: "Speaker 1", text: 'I said "Hello" and then good bye' },
        ],
      },
    ];
    const result = formatMemories(memories);
    expect(result).toContain("User's quote");
    expect(result).toContain("Speaker 1:");
  });

  test("should handle empty topic summary", async () => {
    const { formatMemories } = await import(
      "@/middleware/prompts/format-memories"
    );
    const memories: TestMemory[] = [
      {
        topicSummary: "",
        dialogueTurns: [{ speaker: "Speaker 1", text: "Some dialogue" }],
      },
    ];
    const result = formatMemories(memories);
    expect(result).toContain("Speaker 1:");
    expect(result).toContain("Some dialogue");
  });

  test("should handle multiline dialogue text", async () => {
    const { formatMemories } = await import(
      "@/middleware/prompts/format-memories"
    );
    const memories: TestMemory[] = [
      {
        topicSummary: "User's story",
        dialogueTurns: [
          { speaker: "Speaker 1", text: "First line Second line Third line" },
        ],
      },
    ];
    const result = formatMemories(memories);
    expect(result).toContain("User's story");
    expect(result).toContain("Speaker 1:");
  });
});
