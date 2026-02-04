import { describe, expect, test } from "bun:test";

const INPUT_PATTERN = /Input:\s*\n/;

describe("extractSpeaker1 Prompt Template", () => {
  test("should export a prompt template function", async () => {
    const { extractSpeaker1 } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    expect(typeof extractSpeaker1).toBe("function");
  });

  test("should accept dialogue session parameter", async () => {
    const { extractSpeaker1 } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const testDialogue = `
* Turn 0:
  – SPEAKER_1: Hello
  – SPEAKER_2: Hi there
`;
    const prompt = extractSpeaker1(testDialogue);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("should contain task description for SPEAKER_1", async () => {
    const { extractSpeaker1 } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const prompt = extractSpeaker1("");
    expect(prompt).toContain("SPEAKER_1");
    expect(prompt).toContain("personal summaries");
    expect(prompt).toContain("turn IDs");
  });

  test("should specify JSON output format", async () => {
    const { extractSpeaker1 } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const prompt = extractSpeaker1("");
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("extracted_memories");
    expect(prompt).toContain("summary");
    expect(prompt).toContain("reference");
  });

  test("should specify NO_TRAIT special case", async () => {
    const { extractSpeaker1 } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const prompt = extractSpeaker1("");
    expect(prompt).toContain("NO_TRAIT");
  });

  test("should contain few-shot examples", async () => {
    const { extractSpeaker1 } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const prompt = extractSpeaker1("");
    expect(prompt).toContain("INPUT:");
    expect(prompt).toContain("OUTPUT:");
    expect(prompt).toContain("Turn 0:");
  });

  test("should contain placeholder for dialogue input", async () => {
    const { extractSpeaker1 } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const emptyPrompt = extractSpeaker1("");
    expect(emptyPrompt).toMatch(INPUT_PATTERN);
  });

  test("should handle multi-turn dialogue", async () => {
    const { extractSpeaker1 } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const multiTurnDialogue = `
* Turn 0:
  – SPEAKER_1: First message
  – SPEAKER_2: Response 1
* Turn 1:
  – SPEAKER_1: Second message
  – SPEAKER_2: Response 2
* Turn 2:
  – SPEAKER_1: Third message
  – SPEAKER_2: Response 3
`;
    const prompt = extractSpeaker1(multiTurnDialogue);
    expect(prompt).toContain("Turn 0:");
    expect(prompt).toContain("Turn 1:");
    expect(prompt).toContain("Turn 2:");
  });

  test("should be a non-configurable built-in prompt", async () => {
    const { extractSpeaker1 } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const prompt = extractSpeaker1("test");
    expect(prompt).not.toContain("{userConfig");
    expect(prompt).not.toContain("{customPrompt");
  });

  test("should contain reference format instructions", async () => {
    const { extractSpeaker1 } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const prompt = extractSpeaker1("");
    expect(prompt).toContain("[turn_id]");
  });

  test("should handle empty dialogue gracefully", async () => {
    const { extractSpeaker1 } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const prompt = extractSpeaker1("");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe("extractSpeaker1 Output Schema", () => {
  test("should define valid extraction output schema", async () => {
    const { ExtractionOutputSchema } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    expect(typeof ExtractionOutputSchema).toBe("object");
    expect(typeof ExtractionOutputSchema.safeParse).toBe("function");
  });

  test("should validate valid extraction JSON", async () => {
    const { ExtractionOutputSchema } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const validOutput = {
      extracted_memories: [
        { summary: "User enjoys hiking", reference: [0, 2] },
        { summary: "User is vegetarian", reference: [3] },
      ],
    };
    const result = ExtractionOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  test("should accept NO_TRAIT special case", async () => {
    const { ExtractionOutputSchema } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const noTraitOutput = "NO_TRAIT";
    const result = ExtractionOutputSchema.safeParse(noTraitOutput);
    expect(result.success).toBe(true);
  });

  test("should reject invalid extraction JSON", async () => {
    const { ExtractionOutputSchema } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const invalidOutput = {
      extracted_memories: [{ summary: "User enjoys hiking" }],
    };
    const result = ExtractionOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  test("should reject JSON without extracted_memories key", async () => {
    const { ExtractionOutputSchema } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const invalidOutput = {
      wrong_key: [{ summary: "Test", reference: [0] }],
    };
    const result = ExtractionOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  test("should require summary to be non-empty string", async () => {
    const { ExtractionOutputSchema } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const invalidOutput = {
      extracted_memories: [{ summary: "", reference: [0] }],
    };
    const result = ExtractionOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  test("should require reference to be array of numbers", async () => {
    const { ExtractionOutputSchema } = await import(
      "../../../src/middleware/prompts/extract-speaker1.ts"
    );
    const invalidOutput = {
      extracted_memories: [
        { summary: "User enjoys hiking", reference: "invalid" },
      ],
    };
    const result = ExtractionOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});
