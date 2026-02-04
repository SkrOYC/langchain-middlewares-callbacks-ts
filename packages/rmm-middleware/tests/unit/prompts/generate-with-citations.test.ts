import { describe, expect, test } from "bun:test";

/**
 * Tests for generateWithCitations prompt template (Appendix D.2)
 *
 * These tests verify that the prompt template:
 * 1. Matches the exact structure from Appendix D.2
 * 2. Generates responses with citation markers [i, j, k]
 * 3. Handles [NO_CITE] special case
 */

describe("generateWithCitations Prompt Template", () => {
  test("should export a prompt template function", async () => {
    const { generateWithCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    expect(typeof generateWithCitations).toBe("function");
  });

  test("should accept user query and memories parameters", async () => {
    const { generateWithCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const userQuery = "What hobbies do I enjoy?";
    const memoriesBlock = `
– Memory [0]: User enjoys hiking
  Original: "I love hiking on weekends"
– Memory [1]: User plays guitar
  Original: "I've been practicing guitar for years"
`;
    const prompt = generateWithCitations(userQuery, memoriesBlock);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("should contain task description for response generation", async () => {
    const { generateWithCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const prompt = generateWithCitations("Test query", "");
    expect(prompt).toContain("natural and fluent response");
    expect(prompt).toContain("personal");
  });

  test("should specify citation format [i]", async () => {
    const { generateWithCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const prompt = generateWithCitations("Test query", "");
    expect(prompt).toContain("[i]");
    expect(prompt).toContain("index");
  });

  test("should specify NO_CITE special case", async () => {
    const { generateWithCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const prompt = generateWithCitations("Test query", "");
    expect(prompt).toContain("[NO_CITE]");
    expect(prompt).toContain("not useful");
  });

  test("should handle multiple citations [i, j, k]", async () => {
    const { generateWithCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const prompt = generateWithCitations("Test query", "");
    expect(prompt).toContain("[i, j, k]");
  });

  test("should contain examples with useful memories", async () => {
    const { generateWithCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const prompt = generateWithCitations("Test query", "");
    expect(prompt).toContain("Case 1: Useful Memories Found");
    expect(prompt).toContain("INPUT:");
    expect(prompt).toContain("Output:");
  });

  test("should contain example with NO_CITE", async () => {
    const { generateWithCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const prompt = generateWithCitations("Test query", "");
    expect(prompt).toContain("Case 2: No Useful Memories");
  });

  test("should be a non-configurable built-in prompt", async () => {
    const { generateWithCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const prompt = generateWithCitations("test", "");
    expect(prompt).not.toContain("{userConfig");
    expect(prompt).not.toContain("{customPrompt");
  });

  test("should contain memory independence instruction", async () => {
    const { generateWithCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const prompt = generateWithCitations("Test query", "");
    expect(prompt).toContain("independent");
    expect(prompt).toContain("repeat or contradict");
  });

  test("should contain citation evaluation instruction", async () => {
    const { generateWithCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const prompt = generateWithCitations("Test query", "");
    expect(prompt).toContain("original turns");
    expect(prompt).toContain("not the summaries");
  });

  test("should handle empty memories gracefully", async () => {
    const { generateWithCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const prompt = generateWithCitations("Test query", "");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe("generateWithCitations Citation Parsing", () => {
  test("should parse single citation [0]", async () => {
    const { parseCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const citations = parseCitations("Response text [0]");
    expect(citations).toEqual([0]);
  });

  test("should parse multiple citations [0, 1, 2]", async () => {
    const { parseCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const citations = parseCitations("Response text [0, 1, 2]");
    expect(citations).toEqual([0, 1, 2]);
  });

  test("should parse NO_CITE special case", async () => {
    const { parseCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const citations = parseCitations("Response text [NO_CITE]");
    expect(citations).toEqual([]);
  });

  test("should handle response without citations", async () => {
    const { parseCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const citations = parseCitations("Response text without citations");
    expect(citations).toEqual([]);
  });

  test("should handle empty response", async () => {
    const { parseCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const citations = parseCitations("");
    expect(citations).toEqual([]);
  });

  test("should handle citations at end of response", async () => {
    const { parseCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const citations = parseCitations(
      "You enjoy hiking and playing guitar [0, 2]"
    );
    expect(citations).toEqual([0, 2]);
  });

  test("should handle citations with spaces [ 0 , 1 ]", async () => {
    const { parseCitations } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const citations = parseCitations("Response [ 0 , 1 ]");
    expect(citations).toEqual([0, 1]);
  });
});

describe("generateWithCitations Response Examples", () => {
  test("should format example with multiple memories", async () => {
    const { formatExampleResponse } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const response = formatExampleResponse(
      "You enjoy hiking, playing guitar, and stargazing.",
      [0, 1, 2]
    );
    expect(response).toBe(
      "You enjoy hiking, playing guitar, and stargazing. [0, 1, 2]"
    );
  });

  test("should format example with NO_CITE", async () => {
    const { formatExampleResponse } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const response = formatExampleResponse(
      "I don't have enough information to answer that.",
      []
    );
    expect(response).toBe(
      "I don't have enough information to answer that. [NO_CITE]"
    );
  });

  test("should format example with single citation", async () => {
    const { formatExampleResponse } = await import(
      "../../../src/middleware/prompts/generate-with-citations.ts"
    );
    const response = formatExampleResponse("You enjoy hiking.", [0]);
    expect(response).toBe("You enjoy hiking. [0]");
  });
});
