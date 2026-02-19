/**
 * Oracle Retriever for LongMemEval Benchmark
 *
 * Implements ground-truth retrieval using LongMemEval annotations.
 * Returns exactly the sessions annotated as containing relevant information.
 *
 * This retriever is used for evaluation to establish upper-bound performance:
 * - 100% Recall@5 (all relevant memories retrieved)
 * - 90.2% Accuracy (as reported in paper's Table 1)
 */

import type { RmmVectorStore } from "@/schemas/config";

// Regex patterns for session ID parsing (top-level for performance)
const SESSION_REGEX = /(?:session|sess)[-_]?(\d+)/i;
const DIGIT_REGEX = /(\d+)/;

/**
 * Parses a session ID to extract the numeric index
 *
 * Supports multiple formats:
 * - "session-0", "session-1", ... (LongMemEval standard format)
 * - "0", "1", ... (numeric format)
 * - "sess-0", "sess-1", ... (alternative prefix)
 *
 * @param sessionId - Session identifier from annotations
 * @returns Numeric index or -1 if parsing fails
 */
export function parseSessionIndex(sessionId: string): number {
  // Try direct numeric parse first
  const numeric = Number.parseInt(sessionId, 10);
  if (!Number.isNaN(numeric) && numeric >= 0) {
    return numeric;
  }

  // Try extracting number from "session-X" or "sess-X" format
  const match = SESSION_REGEX.exec(sessionId);
  if (match) {
    const num = match[1];
    if (num !== undefined) {
      return Number.parseInt(num, 10);
    }
  }

  // Try extracting first number found in string
  const extractMatch = DIGIT_REGEX.exec(sessionId);
  if (extractMatch) {
    const num = extractMatch[1];
    if (num !== undefined) {
      return Number.parseInt(num, 10);
    }
  }

  return -1;
}

/**
 * Session turn format from LongMemEval dataset
 *
 * Note: Turns that contain the required evidence have an
 * additional field `has_answer: true` for turn-level accuracy evaluation.
 */
export interface LongMemEvalTurn {
  role: "user" | "assistant";
  content: string;
  /** Whether this turn contains the answer evidence */
  has_answer?: boolean;
}

/**
 * LongMemEval instance format matching the dataset
 *
 * Reference: https://github.com/xiaowu0162/LongMemEval
 */
export interface LongMemEvalInstance {
  question_id: string;
  question_type:
    | "single-session-user"
    | "single-session-assistant"
    | "single-session-preference"
    | "temporal-reasoning"
    | "knowledge-update"
    | "multi-session";
  question: string;
  answer: string;
  answer_session_ids: string[]; // Ground truth for Oracle retriever
  haystack_sessions: LongMemEvalTurn[][];
}

/**
 * Configuration for Oracle VectorStore
 */
export interface OracleConfig {
  annotations: LongMemEvalInstance[];
}

/**
 * Oracle VectorStore implementing RmmVectorStore interface
 *
 * Returns pre-annotated ground-truth sessions for evaluation.
 * Bypasses semantic similarity computation entirely.
 */
export class OracleVectorStore implements RmmVectorStore {
  private readonly annotations: LongMemEvalInstance[];

  constructor(config: OracleConfig) {
    this.annotations = config.annotations;
  }

  /**
   * Retrieves ground-truth sessions for a query
   *
   * Looks up the instance matching the query and returns
   * sessions from answer_session_ids (the ground truth).
   *
   * @param query - User query to find ground truth for
   * @param k - Maximum number of sessions to return
   * @returns Array of RetrievedDocument with ground-truth sessions
   */
  async similaritySearch(
    query: string,
    k?: number
  ): Promise<
    Array<{ pageContent: string; metadata: Record<string, unknown> }>
  > {
    // Find matching instance by question content
    const instance = this.annotations.find((ann) => ann.question === query);

    if (!instance) {
      return [];
    }

    // Handle abstention questions (empty answer_session_ids)
    if (instance.answer_session_ids.length === 0) {
      return [];
    }

    // Return ground-truth sessions
    const maxResults = k ?? instance.answer_session_ids.length;
    const results: Array<{
      pageContent: string;
      metadata: Record<string, unknown>;
    }> = [];

    for (const sessionId of instance.answer_session_ids.slice(0, maxResults)) {
      // Parse session ID to get numeric index
      const sessionIndex = parseSessionIndex(sessionId);

      if (
        sessionIndex < 0 ||
        sessionIndex >= instance.haystack_sessions.length
      ) {
        // Session not found - skip with warning in production
        continue;
      }

      const session = instance.haystack_sessions[sessionIndex];
      if (session === undefined) {
        continue;
      }
      const pageContent = session
        .map((turn) => `${turn.role}: ${turn.content}`)
        .join("\n");

      results.push({
        pageContent,
        metadata: {
          sessionId,
          questionId: instance.question_id,
          relevanceScore: 1.0, // Oracle has perfect relevance
        },
      });
    }

    return results;
  }

  /**
   * No-op for Oracle retriever (annotations are static)
   *
   * @param _documents - Documents to add (ignored)
   */
  async addDocuments(
    _documents: Array<{
      pageContent: string;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<void> {
    // Oracle retriever uses pre-annotated data, no dynamic additions
    return Promise.resolve();
  }
}
