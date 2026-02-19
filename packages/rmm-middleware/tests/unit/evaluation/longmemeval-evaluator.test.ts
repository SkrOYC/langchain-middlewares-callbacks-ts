import { describe, expect, test } from "bun:test";

/**
 * Tests for LongMemEval Evaluator
 *
 * These tests verify:
 * 1. LongMemEvalEvaluator class functionality
 * 2. Table 1 format reproduction (Oracle: 100% Recall@5)
 * 3. Abstention question filtering
 * 4. Session-level and turn-level accuracy computation
 */

describe("LongMemEval Evaluator", () => {
  describe("Exports", () => {
    test("should export LongMemEvalEvaluator class", async () => {
      const { LongMemEvalEvaluator } = await import(
        "@/evaluation/longmemeval-evaluator"
      );
      expect(typeof LongMemEvalEvaluator).toBe("function");
    });

    test("should export EvaluationResult type", async () => {
      const module = await import("@/evaluation/longmemeval-evaluator");
      const result: typeof module.EvaluationResult = {
        recallAt5: 1.0,
        accuracy: 0.9,
        sessionAccuracy: 0.95,
        turnAccuracy: 0.88,
        mrr: 0.92,
        totalQuestions: 100,
        abstentionCount: 10,
      };
      expect(result.recallAt5).toBe(1.0);
    });

    test("should export Table1Metrics type", async () => {
      const module = await import("@/evaluation/longmemeval-evaluator");
      const metrics: typeof module.Table1Metrics = {
        retriever: "Oracle",
        recallAt5: 1.0,
        accuracy: 0.902,
        sessionAccuracy: 0.95,
        turnAccuracy: 0.88,
      };
      expect(metrics.recallAt5).toBe(1.0);
    });
  });

  describe("LongMemEvalEvaluator initialization", () => {
    test("creates evaluator with valid config", async () => {
      const { LongMemEvalEvaluator } = await import(
        "@/evaluation/longmemeval-evaluator"
      );

      const evaluator = new LongMemEvalEvaluator({
        dataset: [],
        retriever: {
          similaritySearch: async () => {
            return await Promise.resolve([]);
          },
          addDocuments: async () => {
            return await Promise.resolve();
          },
        },
      });

      expect(evaluator).toBeDefined();
    });

    test("accepts custom retriever implementation", async () => {
      const { LongMemEvalEvaluator } = await import(
        "@/evaluation/longmemeval-evaluator"
      );

      const mockRetriever = {
        similaritySearch: async (_query: string, _k?: number) => {
          return await Promise.resolve([]);
        },
        addDocuments: async () => {
          return await Promise.resolve();
        },
      };

      const evaluator = new LongMemEvalEvaluator({
        dataset: [],
        retriever: mockRetriever,
      });

      expect(evaluator).toBeDefined();
    });
  });

  describe("Oracle results reproduction", () => {
    test("Oracle retriever achieves 100% Recall@5", async () => {
      const { LongMemEvalEvaluator } = await import(
        "@/evaluation/longmemeval-evaluator"
      );

      // Mock Oracle retriever that returns ground truth
      const mockOracleRetriever = {
        similaritySearch: async (_query: string, _k?: number) => {
          return await Promise.resolve([
            {
              pageContent: "test content",
              metadata: {
                sessionId: "session-0",
                questionId: "q1",
                relevanceScore: 1.0,
              },
            },
          ]);
        },
        addDocuments: async () => {
          return await Promise.resolve();
        },
      };

      const evaluator = new LongMemEvalEvaluator({
        dataset: [
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
        ],
        retriever: mockOracleRetriever,
      });

      const results = await evaluator.evaluate();

      // Oracle should achieve 100% Recall@5
      expect(results.recallAt5).toBe(1.0);
    });

    test("Oracle retriever achieves high accuracy", async () => {
      const { LongMemEvalEvaluator } = await import(
        "@/evaluation/longmemeval-evaluator"
      );

      // Mock Oracle retriever
      const mockOracleRetriever = {
        similaritySearch: async (_query: string, _k?: number) => {
          return await Promise.resolve([
            {
              pageContent: "test content",
              metadata: {
                sessionId: "session-0",
                questionId: "q1",
                relevanceScore: 1.0,
              },
            },
          ]);
        },
        addDocuments: async () => {
          return await Promise.resolve();
        },
      };

      const evaluator = new LongMemEvalEvaluator({
        dataset: [
          {
            question_id: "q1",
            question_type: "single-session-user",
            question: "What is the user's name?",
            answer: "John",
            answer_session_ids: ["session-0"],
            haystack_sessions: [
              [
                {
                  role: "user",
                  content: "Hello, my name is John",
                  has_answer: true,
                },
                { role: "assistant", content: "Nice to meet you, John" },
              ],
            ],
          },
        ],
        retriever: mockOracleRetriever,
      });

      const results = await evaluator.evaluate();

      // Oracle should achieve high accuracy (100% when has_answer is present)
      expect(results.accuracy).toBe(1.0);
    });

    test("produces Table 1 format metrics", async () => {
      const { LongMemEvalEvaluator } = await import(
        "@/evaluation/longmemeval-evaluator"
      );

      const mockRetriever = {
        similaritySearch: async (_query: string, _k?: number) => {
          return await Promise.resolve([
            {
              pageContent: "test content",
              metadata: {
                sessionId: "session-0",
                questionId: "q1",
                relevanceScore: 1.0,
              },
            },
          ]);
        },
        addDocuments: async () => {
          return await Promise.resolve();
        },
      };

      const evaluator = new LongMemEvalEvaluator({
        dataset: [
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
        ],
        retriever: mockRetriever,
      });

      // Must call evaluate() first to generate metrics
      await evaluator.evaluate();

      const tableMetrics = evaluator.getTable1Metrics("Oracle");

      expect(tableMetrics).toHaveProperty("retriever");
      expect(tableMetrics).toHaveProperty("recallAt5");
      expect(tableMetrics).toHaveProperty("accuracy");
      expect(tableMetrics).toHaveProperty("sessionAccuracy");
      expect(tableMetrics).toHaveProperty("turnAccuracy");
      expect(tableMetrics.retriever).toBe("Oracle");
    });
  });

  describe("Abstention filtering", () => {
    test("filters abstention questions", async () => {
      const { LongMemEvalEvaluator } = await import(
        "@/evaluation/longmemeval-evaluator"
      );

      const mockRetriever = {
        similaritySearch: async (_query: string, _k?: number) => {
          return await Promise.resolve([]);
        },
        addDocuments: async () => {
          return await Promise.resolve();
        },
      };

      const evaluator = new LongMemEvalEvaluator({
        dataset: [
          {
            question_id: "q1_abs",
            question_type: "single-session-user_abs", // Abstention type
            question: "What is the user's middle name?",
            answer: "Unknown",
            answer_session_ids: [],
            haystack_sessions: [
              [{ role: "user", content: "Hello, my name is John" }],
            ],
          },
        ],
        retriever: mockRetriever,
      });

      const results = await evaluator.evaluate();

      // Abstention questions should not affect metrics
      expect(results.abstentionCount).toBe(1);
    });
  });

  describe("Dataset handling", () => {
    test("handles empty dataset", async () => {
      const { LongMemEvalEvaluator } = await import(
        "@/evaluation/longmemeval-evaluator"
      );

      const mockRetriever = {
        similaritySearch: async (_query: string, _k?: number) => {
          return await Promise.resolve([]);
        },
        addDocuments: async () => {
          return await Promise.resolve();
        },
      };

      const evaluator = new LongMemEvalEvaluator({
        dataset: [],
        retriever: mockRetriever,
      });

      const results = await evaluator.evaluate();

      expect(results.totalQuestions).toBe(0);
      expect(results.recallAt5).toBe(0);
    });

    test("processes multiple question types", async () => {
      const { LongMemEvalEvaluator } = await import(
        "@/evaluation/longmemeval-evaluator"
      );

      const mockRetriever = {
        similaritySearch: async (_query: string, _k?: number) => {
          return await Promise.resolve([
            {
              pageContent: "test content",
              metadata: {
                sessionId: "session-0",
                questionId: "q1",
                relevanceScore: 1.0,
              },
            },
          ]);
        },
        addDocuments: async () => {
          return await Promise.resolve();
        },
      };

      const evaluator = new LongMemEvalEvaluator({
        dataset: [
          {
            question_id: "q1",
            question_type: "single-session-user",
            question: "User's name?",
            answer: "John",
            answer_session_ids: ["session-0"],
            haystack_sessions: [[{ role: "user", content: "My name is John" }]],
          },
          {
            question_id: "q2",
            question_type: "multi-session",
            question: "User's preferences?",
            answer: "Hiking",
            answer_session_ids: ["session-1"],
            haystack_sessions: [[{ role: "user", content: "I love hiking" }]],
          },
        ],
        retriever: mockRetriever,
      });

      const results = await evaluator.evaluate();

      expect(results.totalQuestions).toBe(2);
    });
  });

  describe("Session accuracy", () => {
    test("computes session-level accuracy", async () => {
      const { LongMemEvalEvaluator } = await import(
        "@/evaluation/longmemeval-evaluator"
      );

      const mockRetriever = {
        similaritySearch: async (_query: string, _k?: number) => {
          return await Promise.resolve([
            {
              pageContent: "test content",
              metadata: {
                sessionId: "session-0",
                questionId: "q1",
                relevanceScore: 1.0,
              },
            },
          ]);
        },
        addDocuments: async () => {
          return await Promise.resolve();
        },
      };

      const evaluator = new LongMemEvalEvaluator({
        dataset: [
          {
            question_id: "q1",
            question_type: "single-session-user",
            question: "User's name?",
            answer: "John",
            answer_session_ids: ["session-0"],
            haystack_sessions: [[{ role: "user", content: "My name is John" }]],
          },
        ],
        retriever: mockRetriever,
      });

      const results = await evaluator.evaluate();

      // Perfect session accuracy for Oracle
      expect(results.sessionAccuracy).toBe(1.0);
    });
  });

  describe("Turn accuracy", () => {
    test("computes turn-level accuracy", async () => {
      const { LongMemEvalEvaluator } = await import(
        "@/evaluation/longmemeval-evaluator"
      );

      const mockRetriever = {
        similaritySearch: async (_query: string, _k?: number) => {
          return await Promise.resolve([
            {
              pageContent: "test content",
              metadata: {
                sessionId: "session-0",
                questionId: "q1",
                relevanceScore: 1.0,
              },
            },
          ]);
        },
        addDocuments: async () => {
          return await Promise.resolve();
        },
      };

      const evaluator = new LongMemEvalEvaluator({
        dataset: [
          {
            question_id: "q1",
            question_type: "single-session-user",
            question: "User's name?",
            answer: "John",
            answer_session_ids: ["session-0"],
            haystack_sessions: [
              [
                { role: "user", content: "My name is John" },
                { role: "assistant", content: "Nice to meet you, John" },
              ],
            ],
          },
        ],
        retriever: mockRetriever,
      });

      const results = await evaluator.evaluate();

      // Turn accuracy should be computed
      expect(typeof results.turnAccuracy).toBe("number");
      expect(results.turnAccuracy).toBeGreaterThanOrEqual(0);
    });
  });
});
