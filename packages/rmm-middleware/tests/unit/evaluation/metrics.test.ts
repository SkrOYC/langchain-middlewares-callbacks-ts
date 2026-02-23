import { describe, expect, test } from "bun:test";
import type { EvaluationMetrics } from "@/evaluation/metrics";

/**
 * Tests for Evaluation Metrics
 *
 * These tests verify:
 * 1. Recall@K computation for retrieval evaluation
 * 2. NDCG@K computation for ranking quality
 * 2. Mean Reciprocal Rank (MRR) computation
 * 3. Session-level and turn-level recall
 * 4. Edge cases and error handling
 */

describe("Evaluation Metrics", () => {
  describe("Exports", () => {
    test("should export computeRecallAtK function", async () => {
      const { computeRecallAtK } = await import("@/evaluation/metrics");
      expect(typeof computeRecallAtK).toBe("function");
    });

    test("should export computeMeanReciprocalRank function", async () => {
      const { computeMeanReciprocalRank } = await import(
        "@/evaluation/metrics"
      );
      expect(typeof computeMeanReciprocalRank).toBe("function");
    });

    test("should export computeNdcgAtK function", async () => {
      const { computeNdcgAtK } = await import("@/evaluation/metrics");
      expect(typeof computeNdcgAtK).toBe("function");
    });

    test("should export computeSessionAccuracy function", async () => {
      const { computeSessionAccuracy } = await import("@/evaluation/metrics");
      expect(typeof computeSessionAccuracy).toBe("function");
    });

    test("should export computeRecallAtTurnK function", async () => {
      const { computeRecallAtTurnK } = await import("@/evaluation/metrics");
      expect(typeof computeRecallAtTurnK).toBe("function");
    });

    test("should export EvaluationMetrics type", () => {
      const metrics: EvaluationMetrics = {
        recallAt1: 0,
        recallAt5: 0,
        recallAt10: 0,
        ndcgAt1: 0,
        ndcgAt5: 0,
        ndcgAt10: 0,
        mrr: 0,
        sessionAccuracy: 0,
        recallAtTurnK: 0,
      };
      expect(metrics.recallAt1).toBe(0);
    });
  });

  describe("computeRecallAtK", () => {
    test("returns 1.0 when all relevant items retrieved", async () => {
      const { computeRecallAtK } = await import("@/evaluation/metrics");

      const retrieved = ["doc-1", "doc-2", "doc-3"];
      const relevant = ["doc-1", "doc-2", "doc-3"];

      const recall = computeRecallAtK(retrieved, relevant, 5);

      expect(recall).toBe(1.0);
    });

    test("returns 0.0 when no relevant items retrieved", async () => {
      const { computeRecallAtK } = await import("@/evaluation/metrics");

      const retrieved = ["doc-1", "doc-2", "doc-3"];
      const relevant = ["doc-4", "doc-5"];

      const recall = computeRecallAtK(retrieved, relevant, 5);

      expect(recall).toBe(0.0);
    });

    test("returns partial recall when some relevant items retrieved", async () => {
      const { computeRecallAtK } = await import("@/evaluation/metrics");

      const retrieved = ["doc-1", "doc-2", "doc-3"];
      const relevant = ["doc-1", "doc-4"];

      const recall = computeRecallAtK(retrieved, relevant, 5);

      // 1 out of 2 relevant items found = 0.5
      expect(recall).toBe(0.5);
    });

    test("respects K limit", async () => {
      const { computeRecallAtK } = await import("@/evaluation/metrics");

      const retrieved = ["doc-1", "doc-2", "doc-3", "doc-4", "doc-5"];
      const relevant = ["doc-1", "doc-2", "doc-3", "doc-4", "doc-5"];

      // Only look at top 3
      const recallAt3 = computeRecallAtK(retrieved, relevant, 3);

      // 3 out of 5 relevant in top 3 = 3/5 = 0.6
      expect(recallAt3).toBe(0.6);
    });

    test("handles K larger than retrieved length", async () => {
      const { computeRecallAtK } = await import("@/evaluation/metrics");

      const retrieved = ["doc-1", "doc-2"];
      const relevant = ["doc-1"];

      const recall = computeRecallAtK(retrieved, relevant, 10);

      expect(recall).toBe(1.0);
    });

    test("handles empty relevant set", async () => {
      const { computeRecallAtK } = await import("@/evaluation/metrics");

      const retrieved = ["doc-1", "doc-2"];
      const relevant: string[] = [];

      const recall = computeRecallAtK(retrieved, relevant, 5);

      // Recall with no relevant items should be undefined or 0
      expect(recall).toBe(0);
    });

    test("handles empty retrieved set", async () => {
      const { computeRecallAtK } = await import("@/evaluation/metrics");

      const retrieved: string[] = [];
      const relevant = ["doc-1", "doc-2"];

      const recall = computeRecallAtK(retrieved, relevant, 5);

      expect(recall).toBe(0.0);
    });

    test("handles duplicate IDs in retrieved", async () => {
      const { computeRecallAtK } = await import("@/evaluation/metrics");

      const retrieved = ["doc-1", "doc-1", "doc-2"];
      const relevant = ["doc-1"];

      const recall = computeRecallAtK(retrieved, relevant, 5);

      // Use Set to deduplicate, so doc-1 is counted once
      expect(recall).toBe(1.0);
    });
  });

  describe("computeNdcgAtK", () => {
    test("returns 1.0 for perfect ranking", async () => {
      const { computeNdcgAtK } = await import("@/evaluation/metrics");
      const ndcg = computeNdcgAtK(["doc-1", "doc-2"], ["doc-1", "doc-2"], 2);
      expect(ndcg).toBe(1.0);
    });

    test("returns 0 for no relevant retrieval", async () => {
      const { computeNdcgAtK } = await import("@/evaluation/metrics");
      const ndcg = computeNdcgAtK(["doc-3", "doc-4"], ["doc-1", "doc-2"], 2);
      expect(ndcg).toBe(0.0);
    });

    test("returns partial score for non-ideal ranking", async () => {
      const { computeNdcgAtK } = await import("@/evaluation/metrics");
      const ndcg = computeNdcgAtK(["doc-x", "doc-1"], ["doc-1"], 2);
      expect(ndcg).toBeGreaterThan(0);
      expect(ndcg).toBeLessThan(1);
    });
  });

  describe("computeMeanReciprocalRank", () => {
    test("returns 1.0 when first item is relevant", async () => {
      const { computeMeanReciprocalRank } = await import(
        "@/evaluation/metrics"
      );

      const retrieved = [["doc-1", "doc-2"]];
      const relevant = [["doc-1"]];

      const mrr = computeMeanReciprocalRank(retrieved, relevant);

      expect(mrr).toBe(1.0);
    });

    test("returns 0.5 when second item is first relevant", async () => {
      const { computeMeanReciprocalRank } = await import(
        "@/evaluation/metrics"
      );

      const retrieved = [["doc-2", "doc-1"]];
      const relevant = [["doc-1"]];

      const mrr = computeMeanReciprocalRank(retrieved, relevant);

      expect(mrr).toBe(0.5);
    });

    test("returns 0 when no relevant items found", async () => {
      const { computeMeanReciprocalRank } = await import(
        "@/evaluation/metrics"
      );

      const retrieved = [["doc-1", "doc-2"]];
      const relevant = [["doc-3"]];

      const mrr = computeMeanReciprocalRank(retrieved, relevant);

      expect(mrr).toBe(0.0);
    });

    test("computes mean across multiple queries", async () => {
      const { computeMeanReciprocalRank } = await import(
        "@/evaluation/metrics"
      );

      const retrieved = [
        ["doc-1", "doc-2"], // rank 1
        ["doc-2", "doc-1"], // rank 2
        ["doc-3", "doc-1"], // rank 2
      ];
      const relevant = [["doc-1"], ["doc-1"], ["doc-1"]];

      const mrr = computeMeanReciprocalRank(retrieved, relevant);

      // MRR = (1/1 + 1/2 + 1/2) / 3 = (1 + 0.5 + 0.5) / 3 = 0.67
      expect(mrr).toBe(0.666_666_666_666_666_6);
    });

    test("handles empty queries", async () => {
      const { computeMeanReciprocalRank } = await import(
        "@/evaluation/metrics"
      );

      const retrieved: string[][] = [];
      const relevant: string[][] = [];

      const mrr = computeMeanReciprocalRank(retrieved, relevant);

      expect(mrr).toBe(0);
    });
  });

  describe("computeSessionAccuracy", () => {
    test("returns 1.0 when all sessions match", async () => {
      const { computeSessionAccuracy } = await import("@/evaluation/metrics");

      const retrievedSessions = ["session-1", "session-2"];
      const answerSessionIds = ["session-1", "session-2"];

      const accuracy = computeSessionAccuracy(
        retrievedSessions,
        answerSessionIds
      );

      expect(accuracy).toBe(1.0);
    });

    test("returns 0.5 when half sessions match", async () => {
      const { computeSessionAccuracy } = await import("@/evaluation/metrics");

      const retrievedSessions = ["session-1", "session-3"];
      const answerSessionIds = ["session-1", "session-2"];

      const accuracy = computeSessionAccuracy(
        retrievedSessions,
        answerSessionIds
      );

      expect(accuracy).toBe(0.5);
    });

    test("returns 0.0 when no sessions match", async () => {
      const { computeSessionAccuracy } = await import("@/evaluation/metrics");

      const retrievedSessions = ["session-3", "session-4"];
      const answerSessionIds = ["session-1", "session-2"];

      const accuracy = computeSessionAccuracy(
        retrievedSessions,
        answerSessionIds
      );

      expect(accuracy).toBe(0.0);
    });

    test("handles different length arrays", async () => {
      const { computeSessionAccuracy } = await import("@/evaluation/metrics");

      const retrievedSessions = ["session-1"];
      const answerSessionIds = ["session-1", "session-2", "session-3"];

      const accuracy = computeSessionAccuracy(
        retrievedSessions,
        answerSessionIds
      );

      // Intersection / union approach
      expect(accuracy).toBeGreaterThan(0);
      expect(accuracy).toBeLessThan(1);
    });
  });

  describe("computeRecallAtTurnK", () => {
    test("returns recall based on has_answer labels", async () => {
      const { computeRecallAtTurnK } = await import("@/evaluation/metrics");

      const allTurns = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];
      const retrievedTurns = [{ role: "user", content: "Hello" }];
      const hasAnswer = [true, false];

      const recall = computeRecallAtTurnK(retrievedTurns, allTurns, hasAnswer);

      // 1 retrieved turn with answer out of 1 total turn with answer = 1.0
      expect(recall).toBe(1.0);
    });

    test("returns 1.0 when all turns with answers are retrieved", async () => {
      const { computeRecallAtTurnK } = await import("@/evaluation/metrics");

      const allTurns = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];
      const retrievedTurns = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];
      const hasAnswer = [true, true];

      const recall = computeRecallAtTurnK(retrievedTurns, allTurns, hasAnswer);

      expect(recall).toBe(1.0);
    });

    test("handles empty arrays", async () => {
      const { computeRecallAtTurnK } = await import("@/evaluation/metrics");

      const allTurns: Array<{ role: string; content: string }> = [];
      const retrievedTurns: Array<{ role: string; content: string }> = [];
      const hasAnswer: boolean[] = [];

      const recall = computeRecallAtTurnK(retrievedTurns, allTurns, hasAnswer);

      expect(recall).toBe(0);
    });

    test("returns 0.0 when no turns with answers are retrieved", async () => {
      const { computeRecallAtTurnK } = await import("@/evaluation/metrics");

      const allTurns = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];
      const retrievedTurns: Array<{ role: string; content: string }> = [];
      const hasAnswer = [true, true];

      const recall = computeRecallAtTurnK(retrievedTurns, allTurns, hasAnswer);

      expect(recall).toBe(0.0);
    });

    test("keeps computeTurnAccuracy alias for backward compatibility", async () => {
      const { computeTurnAccuracy } = await import("@/evaluation/metrics");
      const recall = computeTurnAccuracy(
        [{ role: "user", content: "Hello" }],
        [{ role: "user", content: "Hello" }],
        [true]
      );
      expect(recall).toBe(1.0);
    });
  });
});
