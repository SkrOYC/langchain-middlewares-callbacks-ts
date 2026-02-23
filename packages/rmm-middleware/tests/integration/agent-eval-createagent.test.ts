import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("agent evaluation CLI integration", () => {
  test("runs createAgent-based evaluation and writes artifacts", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-eval-cli-"));
    const datasetPath = join(tempDir, "dataset.json");
    const outDir = join(tempDir, "out");

    await globalThis.Bun.write(
      datasetPath,
      JSON.stringify([
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "What does the user like?",
          answer: "hiking",
          answer_session_ids: ["session-0"],
          haystack_sessions: [[{ role: "user", content: "I like hiking" }]],
        },
      ])
    );

    const proc = globalThis.Bun.spawn([
      "bun",
      "scripts/run-agent-longmemeval.ts",
      "--dataset",
      datasetPath,
      "--methods",
      "oracle",
      "--out-dir",
      outDir,
      "--save-artifacts=true",
      "--embedding-dimension",
      "8",
    ]);

    const exitCode = await proc.exited;
    const stderrText = await new Response(proc.stderr).text();

    expect(exitCode).toBe(0);
    expect(stderrText).not.toContain("[agent-longmemeval]");

    const summary = JSON.parse(
      readFileSync(join(outDir, "summary.json"), "utf8")
    );
    const recordsText = readFileSync(join(outDir, "records.jsonl"), "utf8");

    expect(summary.resultCount).toBe(1);
    expect(recordsText.trim().length).toBeGreaterThan(0);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
