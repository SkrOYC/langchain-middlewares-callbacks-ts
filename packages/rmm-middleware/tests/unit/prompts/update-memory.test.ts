import { describe, expect, test } from "bun:test";

/**
 * Tests for updateMemory prompt template (Appendix D.1.2)
 *
 * These tests verify that the prompt template:
 * 1. Matches the exact structure from Appendix D.1.2
 * 2. Handles history summaries and new summary inputs
 * 3. Supports Add() and Merge(index, merged_summary) actions
 */

describe("updateMemory Prompt Template", () => {
  test("should export a prompt template function", async () => {
    const { updateMemory } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    expect(typeof updateMemory).toBe("function");
  });

  test("should accept history summaries and new summary parameters", async () => {
    const { updateMemory } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const historySummaries = ["User enjoys hiking", "User is vegetarian"];
    const newSummary = "User started running marathons";
    const prompt = updateMemory(historySummaries, newSummary);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("should contain task description for memory update", async () => {
    const { updateMemory } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const prompt = updateMemory([], "New summary");
    expect(prompt).toContain("personal history summaries");
    expect(prompt).toContain("update");
  });

  test("should specify Add action format", async () => {
    const { updateMemory } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const prompt = updateMemory([], "New summary");
    expect(prompt).toContain("Add()");
    expect(prompt).toContain("not relevant to any history");
  });

  test("should specify Merge action format", async () => {
    const { updateMemory } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const prompt = updateMemory(["Existing summary"], "New summary");
    expect(prompt).toContain("Merge(index, merged_summary)");
    expect(prompt).toContain("relevant to a history personal summary");
  });

  test("should contain input format instructions", async () => {
    const { updateMemory } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const prompt = updateMemory([], "New summary");
    expect(prompt).toContain("history_summaries");
    expect(prompt).toContain("new_summary");
  });

  test("should contain example with Merge action", async () => {
    const { updateMemory } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const prompt = updateMemory(
      ["SPEAKER_1 works out although he doesn't particularly enjoy it."],
      "SPEAKER_1 exercises every Monday and Thursday."
    );
    expect(prompt).toContain("History Personal Summaries");
    expect(prompt).toContain("New Personal Summary");
    expect(prompt).toContain("Merge(0,");
  });

  test("should handle multiple actions on separate lines", async () => {
    const { updateMemory } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const prompt = updateMemory(["Summary 1", "Summary 2"], "New summary");
    expect(prompt).toContain("newline");
  });

  test("should be a non-configurable built-in prompt", async () => {
    const { updateMemory } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const prompt = updateMemory([], "test");
    expect(prompt).not.toContain("{userConfig");
    expect(prompt).not.toContain("{customPrompt");
  });

  test("should handle empty history summaries", async () => {
    const { updateMemory } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const prompt = updateMemory([], "New summary");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain("History Personal Summaries:");
  });

  test("should handle single history summary", async () => {
    const { updateMemory } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const prompt = updateMemory(
      ["User enjoys hiking"],
      "User enjoys hiking and running"
    );
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe("updateMemory Output Schema", () => {
  test("should define update action schema", async () => {
    const { UpdateActionSchema } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    expect(typeof UpdateActionSchema).toBe("object");
    expect(typeof UpdateActionSchema.safeParse).toBe("function");
  });

  test("should validate Add() action", async () => {
    const { UpdateActionSchema } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const addOutput = "Add()";
    const result = UpdateActionSchema.safeParse(addOutput);
    expect(result.success).toBe(true);
  });

  test("should validate Merge action with index and summary", async () => {
    const { UpdateActionSchema } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const mergeOutput =
      "Merge(0, SPEAKER_1 exercises every Monday and Thursday, although he doesn't particularly enjoy it.)";
    const result = UpdateActionSchema.safeParse(mergeOutput);
    expect(result.success).toBe(true);
  });

  test("should validate multiple actions on separate lines", async () => {
    const { UpdateActionSchema } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    // Each action should individually validate
    const firstAction = "Merge(0, Updated summary)";
    const secondAction = "Merge(1, Another summary)";
    const thirdAction = "Add()";

    expect(UpdateActionSchema.safeParse(firstAction).success).toBe(true);
    expect(UpdateActionSchema.safeParse(secondAction).success).toBe(true);
    expect(UpdateActionSchema.safeParse(thirdAction).success).toBe(true);
  });

  test("should reject empty string", async () => {
    const { UpdateActionSchema } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const emptyOutput = "";
    const result = UpdateActionSchema.safeParse(emptyOutput);
    expect(result.success).toBe(false);
  });

  test("should reject invalid action format", async () => {
    const { UpdateActionSchema } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const invalidOutput = "InvalidAction()";
    const result = UpdateActionSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  test("should reject Merge without index", async () => {
    const { UpdateActionSchema } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const invalidOutput = "Merge(summary without index)";
    const result = UpdateActionSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  test("should reject Merge without summary", async () => {
    const { UpdateActionSchema } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const invalidOutput = "Merge(0,)";
    const result = UpdateActionSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  test("should parse newline-separated actions", async () => {
    const { parseUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const multiOutput = "Merge(0, first)\nMerge(1, second)\nAdd()";
    const result = parseUpdateActions(multiOutput, 2);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual({
      action: "Merge",
      index: 0,
      merged_summary: "first",
    });
    expect(result[1]).toEqual({
      action: "Merge",
      index: 1,
      merged_summary: "second",
    });
    expect(result[2]).toEqual({ action: "Add" });
  });

  test("should validate newline-separated multi-line actions with schema", async () => {
    const { UpdateActionSchema } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const multiLineOutput =
      "Merge(0, first summary)\nMerge(1, second summary)\nAdd()";
    const result = UpdateActionSchema.safeParse(multiLineOutput);
    expect(result.success).toBe(true);
  });
});

describe("updateMemory Action Parsing", () => {
  test("should parse Add() action correctly", async () => {
    const { parseUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const actions = parseUpdateActions("Add()", 0);
    expect(actions).toEqual([{ action: "Add" }]);
  });

  test("should parse Merge action with index correctly", async () => {
    const { parseUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const actions = parseUpdateActions("Merge(0, Updated summary)", 1);
    expect(actions).toEqual([
      { action: "Merge", index: 0, merged_summary: "Updated summary" },
    ]);
  });

  test("should parse multiple actions correctly", async () => {
    const { parseUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const actions = parseUpdateActions(
      "Merge(0, First update)\nMerge(1, Second update)\nAdd()",
      2
    );
    expect(actions).toEqual([
      { action: "Merge", index: 0, merged_summary: "First update" },
      { action: "Merge", index: 1, merged_summary: "Second update" },
      { action: "Add" },
    ]);
  });

  test("should handle empty input gracefully", async () => {
    const { parseUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const actions = parseUpdateActions("");
    expect(actions).toEqual([]);
  });

  test("should reject Merge with out-of-bounds index", async () => {
    const { parseUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const actions = parseUpdateActions("Merge(5, summary)", 2);
    expect(actions).toEqual([]);
  });

  test("should reject negative Merge index", async () => {
    const { parseUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const actions = parseUpdateActions("Merge(-1, summary)", 2);
    expect(actions).toEqual([]);
  });
});

describe("validateUpdateActions", () => {
  test("should export validateUpdateActions function", async () => {
    const { validateUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    expect(typeof validateUpdateActions).toBe("function");
  });

  test("should validate valid Add() action", async () => {
    const { validateUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const result = validateUpdateActions("Add()", 1);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("should validate valid Merge action", async () => {
    const { validateUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const result = validateUpdateActions("Merge(0, updated summary)", 2);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("should validate multiple valid actions", async () => {
    const { validateUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const result = validateUpdateActions(
      "Merge(0, first)\nMerge(1, second)\nAdd()",
      2
    );
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("should detect out-of-bounds index", async () => {
    const { validateUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const result = validateUpdateActions("Merge(5, summary)", 2);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("out of bounds");
  });

  test("should detect invalid action format", async () => {
    const { validateUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const result = validateUpdateActions("InvalidAction()", 1);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Unknown action format");
  });

  test("should detect empty Merge summary", async () => {
    const { validateUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const result = validateUpdateActions("Merge(0, )", 1);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("cannot be empty");
  });

  test("should handle empty input", async () => {
    const { validateUpdateActions } = await import(
      "../../../src/middleware/prompts/update-memory.ts"
    );
    const result = validateUpdateActions("", 0);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
