import { describe, expect, test } from "bun:test";
import { Document } from "@langchain/core/documents";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import {
  type EvaluationResult,
  LongMemEvalEvaluator,
  type Table1Metrics,
} from "@/evaluation/longmemeval-evaluator";
import type { LongMemEvalInstance } from "@/retrievers/oracle-retriever";
import { createInMemoryVectorStore } from "@/tests/fixtures/in-memory-vector-store";
import { createMockEmbeddings } from "@/tests/helpers/mock-embeddings";

function createInstance(
  overrides: Partial<LongMemEvalInstance> = {}
): LongMemEvalInstance {
  return {
    question_id: "q1",
    question_type: "single-session-user",
    question: "What is the user's name?",
    answer: "John",
    answer_session_ids: ["session-0"],
    haystack_sessions: [[{ role: "user", content: "Hello, my name is John" }]],
    ...overrides,
  };
}

function createEmptyRetriever(): VectorStoreInterface {
  return createInMemoryVectorStore(createMockEmbeddings());
}

async function createRetrieverWithSession(
  sessionId: string
): Promise<VectorStoreInterface> {
  const retriever = createEmptyRetriever();
  await retriever.addDocuments([
    new Document({
      pageContent: "test content",
      metadata: {
        sessionId,
        questionId: "q1",
        relevanceScore: 1.0,
      },
    }),
  ]);
  return retriever;
}

describe("LongMemEval Evaluator", () => {
  describe("Exports", () => {
    test("should export LongMemEvalEvaluator class", () => {
      expect(typeof LongMemEvalEvaluator).toBe("function");
    });

    test("should export EvaluationResult type", () => {
      const result: EvaluationResult = {
        recallAt5: 1.0,
        accuracy: 0.9,
        sessionAccuracy: 0.95,
        turnAccuracy: 0.88,
        mrr: 0.92,
        totalQuestions: 100,
        abstentionCount: 10,
        evaluatedInstances: 100,
        skippedInstances: 10,
      };
      expect(result.recallAt5).toBe(1.0);
    });

    test("should export Table1Metrics type", () => {
      const metrics: Table1Metrics = {
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
    test("creates evaluator with valid config", () => {
      const evaluator = new LongMemEvalEvaluator({
        dataset: [],
        retriever: createEmptyRetriever(),
      });

      expect(evaluator).toBeDefined();
    });

    test("accepts custom retriever implementation", () => {
      const evaluator = new LongMemEvalEvaluator({
        dataset: [],
        retriever: createEmptyRetriever(),
      });

      expect(evaluator).toBeDefined();
    });
  });

  describe("Oracle results reproduction", () => {
    test("Oracle retriever achieves 100% Recall@5", async () => {
      const evaluator = new LongMemEvalEvaluator({
        dataset: [createInstance()],
        retriever: await createRetrieverWithSession("session-0"),
      });

      const results = await evaluator.evaluate();
      expect(results.recallAt5).toBe(1.0);
    });

    test("Oracle retriever achieves high accuracy", async () => {
      const evaluator = new LongMemEvalEvaluator({
        dataset: [
          createInstance({
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
          }),
        ],
        retriever: await createRetrieverWithSession("session-0"),
      });

      const results = await evaluator.evaluate();
      expect(results.accuracy).toBe(1.0);
    });

    test("produces Table 1 format metrics", async () => {
      const evaluator = new LongMemEvalEvaluator({
        dataset: [createInstance()],
        retriever: await createRetrieverWithSession("session-0"),
      });

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
      const evaluator = new LongMemEvalEvaluator({
        dataset: [
          createInstance({
            question_id: "q1_abs",
            question: "What is the user's middle name?",
            answer: "Unknown",
            answer_session_ids: [],
          }),
        ],
        retriever: createEmptyRetriever(),
      });

      const results = await evaluator.evaluate();
      expect(results.abstentionCount).toBe(1);
    });
  });

  describe("Dataset handling", () => {
    test("handles empty dataset", async () => {
      const evaluator = new LongMemEvalEvaluator({
        dataset: [],
        retriever: createEmptyRetriever(),
      });

      const results = await evaluator.evaluate();

      expect(results.totalQuestions).toBe(0);
      expect(results.recallAt5).toBe(0);
    });

    test("processes multiple question types", async () => {
      const evaluator = new LongMemEvalEvaluator({
        dataset: [
          createInstance({
            question_id: "q1",
            question_type: "single-session-user",
          }),
          createInstance({
            question_id: "q2",
            question_type: "multi-session",
            question: "User's preferences?",
            answer: "Hiking",
            answer_session_ids: ["session-1"],
            haystack_sessions: [[{ role: "user", content: "I love hiking" }]],
          }),
        ],
        retriever: createEmptyRetriever(),
      });

      const results = await evaluator.evaluate();
      expect(results.totalQuestions).toBe(2);
    });
  });

  describe("Session and turn accuracy", () => {
    test("computes session-level accuracy", async () => {
      const evaluator = new LongMemEvalEvaluator({
        dataset: [createInstance()],
        retriever: await createRetrieverWithSession("session-0"),
      });

      const results = await evaluator.evaluate();
      expect(results.sessionAccuracy).toBe(1.0);
    });

    test("computes turn-level accuracy", async () => {
      const evaluator = new LongMemEvalEvaluator({
        dataset: [
          createInstance({
            haystack_sessions: [
              [
                { role: "user", content: "My name is John", has_answer: true },
                { role: "assistant", content: "Nice to meet you, John" },
              ],
            ],
          }),
        ],
        retriever: await createRetrieverWithSession("session-0"),
      });

      const results = await evaluator.evaluate();

      expect(typeof results.turnAccuracy).toBe("number");
      expect(results.turnAccuracy).toBeGreaterThanOrEqual(0);
    });
  });
});
