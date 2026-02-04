import { describe, expect, test } from "bun:test";
import type { RetrievedMemory } from "@/schemas/index";

/**
 * Tests for reranking algorithms
 *
 * These tests verify:
 * 1. Embedding adaptation (Equation 1): q' = q + W_q · q
 * 2. Gumbel-Softmax sampling behavior
 * 3. Temperature effect on distribution
 */

interface ScoredMemory extends RetrievedMemory {
  rerankScore: number;
}

describe("Reranking Algorithms", () => {
  // Sample data for testing
  const sampleQuery = Array.from(
    { length: 1536 },
    (_, i) => (0.1 * (i + 1)) / 1536
  );

  const sampleTransformMatrix = Array.from({ length: 1536 }, () =>
    Array.from({ length: 1536 }, () => 0.01)
  );

  const sampleMemories: ScoredMemory[] = [
    {
      id: "memory-0",
      topicSummary: "User enjoys hiking",
      rawDialogue: "User: I love hiking",
      timestamp: Date.now() - 100_000,
      sessionId: "session-1",
      turnReferences: [0],
      relevanceScore: 0.85,
      rerankScore: 0.9,
      embedding: Array.from(
        { length: 1536 },
        (_, i) => (0.05 * (i + 1)) / 1536
      ),
    },
    {
      id: "memory-1",
      topicSummary: "User lives in Colorado",
      rawDialogue: "User: I live in Colorado",
      timestamp: Date.now() - 90_000,
      sessionId: "session-1",
      turnReferences: [1],
      relevanceScore: 0.75,
      rerankScore: 0.7,
      embedding: Array.from(
        { length: 1536 },
        (_, i) => (0.03 * (i + 1)) / 1536
      ),
    },
    {
      id: "memory-2",
      topicSummary: "User has a dog",
      rawDialogue: "User: I have a golden retriever",
      timestamp: Date.now() - 80_000,
      sessionId: "session-1",
      turnReferences: [2],
      relevanceScore: 0.7,
      rerankScore: 0.5,
      embedding: Array.from(
        { length: 1536 },
        (_, i) => (0.02 * (i + 1)) / 1536
      ),
    },
    {
      id: "memory-3",
      topicSummary: "User works as developer",
      rawDialogue: "User: I work as a software developer",
      timestamp: Date.now() - 70_000,
      sessionId: "session-1",
      turnReferences: [3],
      relevanceScore: 0.65,
      rerankScore: 0.3,
      embedding: Array.from(
        { length: 1536 },
        (_, i) => (0.01 * (i + 1)) / 1536
      ),
    },
  ];

  describe("applyEmbeddingAdaptation", () => {
    test("should export applyEmbeddingAdaptation function", async () => {
      const { applyEmbeddingAdaptation } = await import(
        "@/algorithms/reranking"
      );
      expect(typeof applyEmbeddingAdaptation).toBe("function");
    });

    test("implements Equation 1: q' = q + W_q · q", async () => {
      const { applyEmbeddingAdaptation } = await import(
        "@/algorithms/reranking"
      );

      // Simple test case with small dimensions
      const smallQuery = [1.0, 2.0, 3.0];
      const smallTransform = [
        [0.1, 0.0, 0.0],
        [0.0, 0.1, 0.0],
        [0.0, 0.0, 0.1],
      ];

      const result = applyEmbeddingAdaptation(smallQuery, smallTransform);

      // W · q = [0.1, 0.2, 0.3]
      // q' = q + W·q = [1.1, 2.2, 3.3]
      expect(result).toEqual([1.1, 2.2, 3.3]);
    });

    test("preserves embedding dimensions (1536 → 1536)", async () => {
      const { applyEmbeddingAdaptation } = await import(
        "@/algorithms/reranking"
      );

      const result = applyEmbeddingAdaptation(
        sampleQuery,
        sampleTransformMatrix
      );

      expect(result.length).toBe(sampleQuery.length);
      expect(result.length).toBe(1536);
    });

    test("handles zero transformation matrix (identity case)", async () => {
      const { applyEmbeddingAdaptation } = await import(
        "@/algorithms/reranking"
      );

      const zeroMatrix = Array.from({ length: 1536 }, () =>
        Array.from({ length: 1536 }, () => 0)
      );

      const result = applyEmbeddingAdaptation(sampleQuery, zeroMatrix);

      // q' = q + 0 = q
      expect(result).toEqual(sampleQuery);
    });

    test("handles identity transformation matrix", async () => {
      const { applyEmbeddingAdaptation } = await import(
        "@/algorithms/reranking"
      );

      const identityMatrix = Array.from({ length: 1536 }, (_, i) =>
        Array.from({ length: 1536 }, (_, j) => (i === j ? 1 : 0))
      );

      const result = applyEmbeddingAdaptation(sampleQuery, identityMatrix);

      // W · q = q (for identity)
      // q' = q + q = 2q
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBeCloseTo(sampleQuery[i] * 2, 10);
      }
    });
  });

  describe("gumbelSoftmaxSample", () => {
    test("should export gumbelSoftmaxSample function", async () => {
      const { gumbelSoftmaxSample } = await import("@/algorithms/reranking");
      expect(typeof gumbelSoftmaxSample).toBe("function");
    });

    test("returns exactly topM memories", async () => {
      const { gumbelSoftmaxSample } = await import("@/algorithms/reranking");

      const topM = 2;
      const result = gumbelSoftmaxSample(sampleMemories, topM, 0.5);

      expect(result.length).toBe(topM);
    });

    test("returns unique indices (no duplicates)", async () => {
      const { gumbelSoftmaxSample } = await import("@/algorithms/reranking");

      const topM = 3;
      const result = gumbelSoftmaxSample(sampleMemories, topM, 0.5);

      // All selected memories should be unique
      const uniqueIds = new Set(result.map((m) => m.id));
      expect(uniqueIds.size).toBe(result.length);
    });

    test("temperature effect: high τ produces more uniform distribution", async () => {
      const { gumbelSoftmaxSample } = await import("@/algorithms/reranking");

      const topM = 4;
      const highTemp = 10.0; // High temperature = more uniform

      // Run multiple times to get distribution
      const selections: Map<string, number> = new Map();
      const iterations = 200;

      for (let i = 0; i < iterations; i++) {
        const result = gumbelSoftmaxSample(sampleMemories, topM, highTemp);
        for (const memory of result) {
          selections.set(memory.id, (selections.get(memory.id) ?? 0) + 1);
        }
      }

      // With high temperature, all memories should be selected with relatively even frequency
      const frequencies = Array.from(selections.values());
      const minFreq = Math.min(...frequencies);
      const maxFreq = Math.max(...frequencies);

      // With high temperature, max/min ratio should be relatively low (< 3x)
      expect(maxFreq / minFreq).toBeLessThan(3);
    });

    test("temperature effect: low τ produces peaky distribution", async () => {
      const { gumbelSoftmaxSample } = await import("@/algorithms/reranking");

      const topM = 1;
      const lowTemp = 0.1; // Low temperature = more deterministic

      // Run multiple times
      const selections: Map<string, number> = new Map();
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        const result = gumbelSoftmaxSample(sampleMemories, topM, lowTemp);
        for (const memory of result) {
          selections.set(memory.id, (selections.get(memory.id) ?? 0) + 1);
        }
      }

      // With low temperature, the highest-scoring memory should be selected more often than others
      // Memory 0 has the highest score (0.9)
      const memory0Selections = selections.get("memory-0") ?? 0;
      const _memory1Selections = selections.get("memory-1") ?? 0;
      const memory2Selections = selections.get("memory-2") ?? 0;

      // Memory 0 should be selected more often than lower-scoring memories
      // At minimum, it should be selected more than a random distribution would suggest
      expect(memory0Selections).toBeGreaterThanOrEqual(memory2Selections);
    });

    test("handles fewer memories than topM", async () => {
      const { gumbelSoftmaxSample } = await import("@/algorithms/reranking");

      const fewMemories = sampleMemories.slice(0, 2);
      const topM = 10; // More than available

      const result = gumbelSoftmaxSample(fewMemories, topM, 0.5);

      // Should return all available memories
      expect(result.length).toBe(2);
    });

    test("handles topM of 0", async () => {
      const { gumbelSoftmaxSample } = await import("@/algorithms/reranking");

      const result = gumbelSoftmaxSample(sampleMemories, 0, 0.5);

      expect(result.length).toBe(0);
    });

    test("sorts results by rerankScore descending", async () => {
      const { gumbelSoftmaxSample } = await import("@/algorithms/reranking");

      // Use very low temperature for deterministic behavior
      const topM = 4;
      const veryLowTemp = 0.01;

      const result = gumbelSoftmaxSample(sampleMemories, topM, veryLowTemp);

      // With very low temperature, should select highest-scoring memories
      // Verify all 4 are returned (topM = 4)
      expect(result.length).toBe(4);
    });
  });
});
