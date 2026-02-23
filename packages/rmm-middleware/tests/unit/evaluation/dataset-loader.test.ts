import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLongMemEvalDataset } from "@/evaluation/dataset-loader";

describe("loadLongMemEvalDataset", () => {
  test("loads JSON array dataset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "longmemeval-json-"));
    const file = join(dir, "dataset.json");

    writeFileSync(
      file,
      JSON.stringify([
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "What does the user like?",
          answer: "Hiking",
          answer_session_ids: ["session-0"],
          haystack_sessions: [[{ role: "user", content: "I like hiking" }]],
        },
      ]),
      "utf8"
    );

    const rows = await loadLongMemEvalDataset(file);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.question_id).toBe("q1");
    expect(rows[0]?.haystack_session_ids).toEqual(["session-0"]);

    rmSync(dir, { recursive: true, force: true });
  });

  test("loads JSONL dataset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "longmemeval-jsonl-"));
    const file = join(dir, "dataset.jsonl");

    writeFileSync(
      file,
      [
        JSON.stringify({
          question_id: "q1",
          question_type: "single-session-user",
          question: "What does the user like?",
          answer: "Hiking",
          answer_session_ids: ["session-0"],
          haystack_sessions: [[{ role: "user", content: "I like hiking" }]],
        }),
        JSON.stringify({
          question_id: "q2",
          question_type: "multi-session",
          question: "Where did user travel?",
          answer: "Japan",
          answer_session_ids: ["session-1"],
          haystack_sessions: [
            [{ role: "assistant", content: "You visited Japan" }],
          ],
        }),
      ].join("\n"),
      "utf8"
    );

    const rows = await loadLongMemEvalDataset(file);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.question_id).toBe("q2");

    rmSync(dir, { recursive: true, force: true });
  });

  test("throws on invalid schema rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "longmemeval-invalid-"));
    const file = join(dir, "dataset.json");

    writeFileSync(
      file,
      JSON.stringify([
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "Missing required fields",
        },
      ]),
      "utf8"
    );

    await expect(loadLongMemEvalDataset(file)).rejects.toThrow(
      "Invalid LongMemEval row"
    );

    rmSync(dir, { recursive: true, force: true });
  });

  test("coerces numeric scalar fields to strings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "longmemeval-coerce-"));
    const file = join(dir, "dataset.json");

    writeFileSync(
      file,
      JSON.stringify([
        {
          question_id: 101,
          question_type: "single-session-user",
          question: 42,
          answer: 7,
          answer_session_ids: [0],
          haystack_sessions: [[{ role: "user", content: 123 }]],
        },
      ]),
      "utf8"
    );

    const rows = await loadLongMemEvalDataset(file);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.question_id).toBe("101");
    expect(rows[0]?.question).toBe("42");
    expect(rows[0]?.answer).toBe("7");
    expect(rows[0]?.answer_session_ids).toEqual(["0"]);
    expect(rows[0]?.haystack_sessions[0]?.[0]?.content).toBe("123");
    expect(rows[0]?.haystack_session_ids).toEqual(["session-0"]);

    rmSync(dir, { recursive: true, force: true });
  });

  test("preserves explicit haystack_session_ids from dataset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "longmemeval-sessionids-"));
    const file = join(dir, "dataset.json");

    writeFileSync(
      file,
      JSON.stringify([
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "Who likes hiking?",
          answer: "The user",
          answer_session_ids: ["answer_abc123"],
          haystack_session_ids: ["memory_x", "answer_abc123"],
          haystack_sessions: [
            [{ role: "user", content: "irrelevant" }],
            [{ role: "assistant", content: "you said you like hiking" }],
          ],
        },
      ]),
      "utf8"
    );

    const rows = await loadLongMemEvalDataset(file);
    expect(rows[0]?.haystack_session_ids).toEqual([
      "memory_x",
      "answer_abc123",
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  test("throws when haystack_session_ids length mismatches sessions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "longmemeval-bad-sessionids-"));
    const file = join(dir, "dataset.json");

    writeFileSync(
      file,
      JSON.stringify([
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "Bad row",
          answer: "n/a",
          answer_session_ids: ["session-0"],
          haystack_session_ids: ["session-0", "session-1"],
          haystack_sessions: [[{ role: "user", content: "only one session" }]],
        },
      ]),
      "utf8"
    );

    await expect(loadLongMemEvalDataset(file)).rejects.toThrow(
      "haystack_session_ids length"
    );

    rmSync(dir, { recursive: true, force: true });
  });
});
