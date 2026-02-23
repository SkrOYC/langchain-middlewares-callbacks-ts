import { describe, expect, test } from "bun:test";
import type {
  LongMemEvalInstance,
  OracleConfig,
} from "@/retrievers/oracle-retriever";

/**
 * Tests for Oracle Retriever
 *
 * These tests verify:
 * 1. OracleVectorStore returns ground-truth sessions from LongMemEval annotations
 * 2. similaritySearch matches RmmVectorStore interface
 * 3. Handles abstention questions (no ground truth)
 * 4. Returns expected format matching RetrievedMemory schema
 */

describe("Oracle Retriever", () => {
  describe("OracleVectorStore exports", () => {
    test("should export OracleVectorStore class", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );
      expect(typeof OracleVectorStore).toBe("function");
    });

    test("should export OracleConfig type", () => {
      const config: OracleConfig = { annotations: [] };
      expect(config.annotations).toBeEmpty();
    });

    test("should export LongMemEvalInstance type", () => {
      const instance: LongMemEvalInstance = {
        question_id: "test",
        question_type: "single-session-user",
        question: "test",
        answer: "test",
        answer_session_ids: [],
        haystack_sessions: [],
      };
      expect(instance.question_id).toBe("test");
    });
  });

  describe("OracleVectorStore interface compliance", () => {
    test("should implement similaritySearch method", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const mockAnnotations: LongMemEvalInstance[] = [
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "What is the user's name?",
          answer: "John",
          answer_session_ids: ["session-1", "session-2"],
          haystack_sessions: [
            [{ role: "user", content: "Hello, my name is John" }],
            [{ role: "assistant", content: "Nice to meet you, John" }],
          ],
        },
      ];

      const oracle = new OracleVectorStore({
        annotations: mockAnnotations,
      });

      expect(typeof oracle.similaritySearch).toBe("function");
    });

    test("should implement addDocuments method", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const oracle = new OracleVectorStore({
        annotations: [],
      });

      expect(typeof oracle.addDocuments).toBe("function");
    });
  });

  describe("Ground-truth retrieval", () => {
    test("returns sessions matching answer_session_ids", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const mockAnnotations: LongMemEvalInstance[] = [
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "What is the user's name?",
          answer: "John",
          answer_session_ids: ["session-0", "session-1"],
          haystack_sessions: [
            [{ role: "user", content: "Hello, my name is John" }],
            [{ role: "assistant", content: "Nice to meet you, John" }],
            [{ role: "user", content: "I live in Colorado" }],
          ],
        },
      ];

      const oracle = new OracleVectorStore({
        annotations: mockAnnotations,
      });

      const result = await oracle.similaritySearch(
        "What is the user's name?",
        5
      );

      // Should return exactly the sessions from answer_session_ids
      expect(result.length).toBe(2);
      expect(result.map((r) => r.metadata?.sessionId)).toEqual([
        "session-0",
        "session-1",
      ]);
    });

    test("resolves official LongMemEval session IDs via haystack_session_ids", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const mockAnnotations: LongMemEvalInstance[] = [
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "Which city did I move to?",
          answer: "Lisbon",
          answer_session_ids: ["answer_42"],
          haystack_session_ids: ["share_0", "answer_42", "share_1"],
          haystack_sessions: [
            [{ role: "user", content: "I like coffee." }],
            [{ role: "assistant", content: "You moved to Lisbon last year." }],
            [{ role: "user", content: "I also like tea." }],
          ],
        },
      ];

      const oracle = new OracleVectorStore({
        annotations: mockAnnotations,
      });

      const result = await oracle.similaritySearch(
        "Which city did I move to?",
        5
      );

      expect(result.length).toBe(1);
      expect(result[0]?.metadata?.sessionId).toBe("answer_42");
      expect(result[0]?.pageContent).toContain("Lisbon");
    });

    test("returns max k sessions when answer_session_ids has fewer entries", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const mockAnnotations: LongMemEvalInstance[] = [
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "What is the user's name?",
          answer: "John",
          answer_session_ids: ["session-0"],
          haystack_sessions: [
            [{ role: "user", content: "Hello, my name is John" }],
          ],
        },
      ];

      const oracle = new OracleVectorStore({
        annotations: mockAnnotations,
      });

      const result = await oracle.similaritySearch(
        "What is the user's name?",
        5
      );

      // Should return the single matching session even when k > available
      expect(result.length).toBe(1);
    });

    test("handles abstention questions (empty answer_session_ids)", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const mockAnnotations: LongMemEvalInstance[] = [
        {
          question_id: "q1_abs",
          question_type: "single-session-user",
          question: "What is the user's middle name?",
          answer: "Unknown",
          answer_session_ids: [], // Abstention: no relevant sessions
          haystack_sessions: [
            [{ role: "user", content: "Hello, my name is John" }],
          ],
        },
      ];

      const oracle = new OracleVectorStore({
        annotations: mockAnnotations,
      });

      const result = await oracle.similaritySearch(
        "What is the user's middle name?",
        5
      );

      // Abstention questions should return empty result
      expect(result.length).toBe(0);
    });
  });

  describe("Query matching", () => {
    test("finds correct instance by question content", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const mockAnnotations: LongMemEvalInstance[] = [
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "What is the user's name?",
          answer: "John",
          answer_session_ids: ["session-0"],
          haystack_sessions: [
            [{ role: "user", content: "Hello, my name is John" }],
          ],
        },
        {
          question_id: "q2",
          question_type: "single-session-user",
          question: "Where does the user live?",
          answer: "Colorado",
          answer_session_ids: ["session-0"],
          haystack_sessions: [
            [{ role: "user", content: "I live in Colorado" }],
          ],
        },
      ];

      const oracle = new OracleVectorStore({
        annotations: mockAnnotations,
      });

      const result = await oracle.similaritySearch(
        "Where does the user live?",
        5
      );

      expect(result.length).toBe(1);
      expect(result[0]?.metadata?.sessionId).toBe("session-0");
    });

    test("returns empty result for non-existent query", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const mockAnnotations: LongMemEvalInstance[] = [
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "What is the user's name?",
          answer: "John",
          answer_session_ids: ["session-1"],
          haystack_sessions: [
            [{ role: "user", content: "Hello, my name is John" }],
          ],
        },
      ];

      const oracle = new OracleVectorStore({
        annotations: mockAnnotations,
      });

      const result = await oracle.similaritySearch(
        "What is the user's favorite color?",
        5
      );

      // Non-matching query should return empty
      expect(result.length).toBe(0);
    });
  });

  describe("Result format", () => {
    test("returns results matching RetrievedMemory format", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const mockAnnotations: LongMemEvalInstance[] = [
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "What is the user's name?",
          answer: "John",
          answer_session_ids: ["session-0"],
          haystack_sessions: [
            [
              { role: "user", content: "Hello, my name is John" },
              { role: "assistant", content: "Nice to meet you, John" },
            ],
          ],
        },
      ];

      const oracle = new OracleVectorStore({
        annotations: mockAnnotations,
      });

      const result = await oracle.similaritySearch(
        "What is the user's name?",
        5
      );

      expect(result.length).toBe(1);
      expect(result[0]).toHaveProperty("pageContent");
      expect(result[0]).toHaveProperty("metadata");
      expect(result[0]?.metadata).toHaveProperty("sessionId");
      expect(result[0]?.metadata).toHaveProperty("questionId");
    });

    test("includes oracle relevance score of 1.0", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const mockAnnotations: LongMemEvalInstance[] = [
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "What is the user's name?",
          answer: "John",
          answer_session_ids: ["session-0"],
          haystack_sessions: [
            [{ role: "user", content: "Hello, my name is John" }],
          ],
        },
      ];

      const oracle = new OracleVectorStore({
        annotations: mockAnnotations,
      });

      const result = await oracle.similaritySearch(
        "What is the user's name?",
        5
      );

      // Oracle should have perfect relevance score
      expect(result[0]?.metadata?.relevanceScore).toBe(1.0);
    });

    test("handles multiple sessions in answer_session_ids", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const mockAnnotations: LongMemEvalInstance[] = [
        {
          question_id: "q1",
          question_type: "multi-session",
          question: "Summarize the user's preferences",
          answer: "User likes hiking and Colorado",
          answer_session_ids: ["session-0", "session-1", "session-2"],
          haystack_sessions: [
            [{ role: "user", content: "I love hiking" }],
            [{ role: "user", content: "I live in Colorado" }],
            [{ role: "assistant", content: "That's nice!" }],
          ],
        },
      ];

      const oracle = new OracleVectorStore({
        annotations: mockAnnotations,
      });

      const result = await oracle.similaritySearch(
        "Summarize the user's preferences",
        5
      );

      expect(result.length).toBe(3);
    });
  });

  describe("Edge cases", () => {
    test("handles empty annotations array", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const oracle = new OracleVectorStore({
        annotations: [],
      });

      const result = await oracle.similaritySearch("Any question?", 5);

      expect(result.length).toBe(0);
    });

    test("handles k=0 gracefully", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const mockAnnotations: LongMemEvalInstance[] = [
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "What is the user's name?",
          answer: "John",
          answer_session_ids: ["session-0"],
          haystack_sessions: [
            [{ role: "user", content: "Hello, my name is John" }],
          ],
        },
      ];

      const oracle = new OracleVectorStore({
        annotations: mockAnnotations,
      });

      const result = await oracle.similaritySearch(
        "What is the user's name?",
        0
      );

      expect(result.length).toBe(0);
    });

    test("preserves session content exactly", async () => {
      const { OracleVectorStore } = await import(
        "@/retrievers/oracle-retriever"
      );

      const mockAnnotations: LongMemEvalInstance[] = [
        {
          question_id: "q1",
          question_type: "single-session-user",
          question: "What is the user's name?",
          answer: "John",
          answer_session_ids: ["session-0"],
          haystack_sessions: [
            [
              { role: "user", content: "Hello, my name is John" },
              { role: "assistant", content: "Nice to meet you, John" },
            ],
          ],
        },
      ];

      const oracle = new OracleVectorStore({
        annotations: mockAnnotations,
      });

      const result = await oracle.similaritySearch(
        "What is the user's name?",
        5
      );

      expect(result[0]?.pageContent).toBe(
        "user: Hello, my name is John\nassistant: Nice to meet you, John"
      );
    });
  });
});
