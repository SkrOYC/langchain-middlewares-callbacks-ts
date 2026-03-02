/**
 * Dataset loading utilities for LongMemEval evaluation runs.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { LongMemEvalInstance } from "@/retrievers/oracle-retriever";

const longMemEvalTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.coerce.string(),
  has_answer: z.boolean().optional(),
});

const longMemEvalInstanceSchema = z.object({
  question_id: z.coerce.string().min(1),
  question_type: z.enum([
    "single-session-user",
    "single-session-assistant",
    "single-session-preference",
    "temporal-reasoning",
    "knowledge-update",
    "multi-session",
  ]),
  question: z.coerce.string().min(1),
  question_date: z.coerce.string().optional(),
  answer: z.coerce.string(),
  answer_session_ids: z.array(z.coerce.string()),
  haystack_dates: z.array(z.coerce.string()).optional(),
  haystack_session_ids: z.array(z.coerce.string()).optional(),
  haystack_sessions: z.array(z.array(longMemEvalTurnSchema)),
});

/**
 * Loads LongMemEval data from JSON or JSONL files.
 */
export async function loadLongMemEvalDataset(
  path: string
): Promise<LongMemEvalInstance[]> {
  const raw = await readFile(path, "utf8");

  const rows = path.endsWith(".jsonl")
    ? parseJsonLines(raw)
    : parseJson(raw, path);

  const parsed: LongMemEvalInstance[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result = longMemEvalInstanceSchema.safeParse(row);
    if (!result.success) {
      const issue = result.error.issues[0];
      const message = issue
        ? `${issue.path.join(".")}: ${issue.message}`
        : "Unknown schema error";
      throw new Error(`Invalid LongMemEval row at index ${i}: ${message}`);
    }
    let normalized: LongMemEvalInstance;
    try {
      normalized = normalizeInstance(result.data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown schema error";
      throw new Error(`Invalid LongMemEval row at index ${i}: ${message}`);
    }
    parsed.push(normalized);
  }

  return parsed;
}

function normalizeInstance(
  row: z.infer<typeof longMemEvalInstanceSchema>
): LongMemEvalInstance {
  const haystackSessionIds =
    row.haystack_session_ids ??
    row.haystack_sessions.map((_, index) => `session-${index}`);

  if (haystackSessionIds.length !== row.haystack_sessions.length) {
    throw new Error(
      `Invalid LongMemEval row: haystack_session_ids length (${haystackSessionIds.length}) must match haystack_sessions length (${row.haystack_sessions.length})`
    );
  }

  if (
    row.haystack_dates !== undefined &&
    row.haystack_dates.length !== row.haystack_sessions.length
  ) {
    throw new Error(
      `Invalid LongMemEval row: haystack_dates length (${row.haystack_dates.length}) must match haystack_sessions length (${row.haystack_sessions.length})`
    );
  }

  return {
    ...row,
    haystack_session_ids: haystackSessionIds,
  };
}

function parseJson(raw: string, path: string): unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse JSON dataset at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (isRecord(value) && Array.isArray(value.data)) {
    return value.data;
  }

  throw new Error(
    `JSON dataset at ${path} must be an array or an object with a data array`
  );
}

function parseJsonLines(raw: string): unknown[] {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const rows: unknown[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(
        `Failed to parse JSONL line ${i + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return rows;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
