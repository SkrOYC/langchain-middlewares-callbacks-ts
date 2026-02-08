import { describe, expect, test } from "bun:test";
import { formatCitationPromptContent } from "@/utils/memory-helpers";

/**
 * Tests for formatCitationPromptContent utility
 *
 * This function creates the complete citation prompt that instructs the LLM
 * to generate responses with proper memory citations.
 */

const testMemory = {
  id: "test-1",
  topicSummary: "User enjoys hiking",
  rawDialogue: "Speaker 1: I love hiking on weekends",
  timestamp: 1_234_567_890,
  sessionId: "session-1",
  embedding: [],
  relevanceScore: 0.9,
};

describe("formatCitationPromptContent", () => {
  test("should export the function", () => {
    expect(typeof formatCitationPromptContent).toBe("function");
  });

  test("should return a non-empty string for valid input", () => {
    const result = formatCitationPromptContent("What hobbies do I enjoy?", [
      testMemory,
    ]);

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("should include system-reminder wrapper", () => {
    const result = formatCitationPromptContent("What hobbies do I enjoy?", [
      testMemory,
    ]);

    expect(result).toContain("<system-reminder>");
    expect(result).toContain("</system-reminder>");
  });

  test("should include citation instructions", () => {
    const result = formatCitationPromptContent("What hobbies do I enjoy?", [
      testMemory,
    ]);

    expect(result).toContain("Cite useful memories using [i]");
    expect(result).toContain("[NO_CITE]");
  });

  test("should include query in the prompt", () => {
    const query = "What hobbies do I enjoy?";
    const result = formatCitationPromptContent(query, [testMemory]);

    expect(result).toContain(query);
  });

  test("should include memories block", () => {
    const result = formatCitationPromptContent("What hobbies do I enjoy?", [
      testMemory,
    ]);

    expect(result).toContain("<memories>");
    expect(result).toContain("Memory [0]:");
    expect(result).toContain("User enjoys hiking");
    expect(result).toContain("Speaker 1: I love hiking on weekends");
    expect(result).toContain("</memories>");
  });

  test("should format multiple memories with correct indices", () => {
    const memories = [
      testMemory,
      {
        ...testMemory,
        id: "test-2",
        topicSummary: "User plays guitar",
        rawDialogue: "Speaker 1: I've been playing guitar for years",
      },
      {
        ...testMemory,
        id: "test-3",
        topicSummary: "User likes astronomy",
        rawDialogue: "Speaker 1: I love stargazing",
      },
    ];

    const result = formatCitationPromptContent(
      "What hobbies do I enjoy?",
      memories
    );

    expect(result).toContain("Memory [0]:");
    expect(result).toContain("Memory [1]:");
    expect(result).toContain("Memory [2]:");
  });

  test("should include examples section", () => {
    const result = formatCitationPromptContent("What hobbies do I enjoy?", [
      testMemory,
    ]);

    expect(result).toContain("<examples>");
    expect(result).toContain("Case 1: Useful Memories Found");
    expect(result).toContain("Case 2: No Useful Memories");
    expect(result).toContain("Output:");
  });

  test("should include additional instructions", () => {
    const result = formatCitationPromptContent("What hobbies do I enjoy?", [
      testMemory,
    ]);

    expect(result).toContain("Additional Instructions:");
    expect(result).toContain("fluent and directly answers the user's query");
  });

  test("should handle empty memories array", () => {
    const result = formatCitationPromptContent("What hobbies do I enjoy?", []);

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("<memories>");
    expect(result).toContain("</memories>");
  });

  test("should handle memories without raw dialogue", () => {
    const result = formatCitationPromptContent("What hobbies do I enjoy?", [
      { ...testMemory, rawDialogue: "" },
    ]);

    expect(result).toContain("Memory [0]:");
    expect(result).toContain("User enjoys hiking");
  });

  test("should escape XML special characters in memories", () => {
    const memories = [
      {
        ...testMemory,
        topicSummary: "User likes <tags> and & symbols",
        rawDialogue: "Speaker 1: I said \"hello\" and 'world'",
      },
    ];

    const result = formatCitationPromptContent(
      "What does the user like?",
      memories
    );

    expect(result).toContain("&lt;tags&gt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&quot;hello&quot;");
    expect(result).toContain("&#39;world&#39;");
  });

  test("should escape XML special characters in query", () => {
    const query = "What about <brackets> & stuff?";
    const result = formatCitationPromptContent(query, [testMemory]);

    expect(result).toContain("&lt;brackets&gt;");
    expect(result).toContain("&amp; stuff?");
  });
});
