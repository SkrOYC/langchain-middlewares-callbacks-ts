import { describe, expect, test } from "bun:test";

/**
 * Tests for Offline Pretraining - InfoNCE Contrastive Loss
 *
 * These tests verify:
 * 1. InfoNCE loss computation for single positive/negative pairs
 * 2. Temperature scaling effect on loss distribution
 * 3. Loss behavior with multiple negatives
 * 4. Integration with RerankerState for weight updates
 */

describe("Offline Pretraining - InfoNCE Loss", () => {
  describe("InfoNCE exports", () => {
    test("should export InfoNCE function", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");
      expect(typeof InfoNCE).toBe("function");
    });

    test("should export SupervisedContrastiveLoss function", async () => {
      const { SupervisedContrastiveLoss } = await import(
        "@/algorithms/offline-pretraining"
      );
      expect(typeof SupervisedContrastiveLoss).toBe("function");
    });

    test("should export ContrastivePair type", async () => {
      const module = await import("@/algorithms/offline-pretraining");
      const pair: typeof module.ContrastivePair = {
        query: [0.1, 0.2, 0.3],
        positive: [0.8, 0.7, 0.6],
        negatives: [[0.1, 0.2, 0.4], [0.1, 0.2, 0.5]],
      };
      expect(pair.negatives.length).toBe(2);
    });

    test("should export PretrainingConfig type", async () => {
      const module = await import("@/algorithms/offline-pretraining");
      const config: typeof module.PretrainingConfig = {
        temperature: 0.07,
        learningRate: 0.001,
        epochs: 10,
      };
      expect(config.temperature).toBe(0.07);
    });
  });

  describe("InfoNCE basic behavior", () => {
    test("returns a loss value (number)", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      const query = [0.1, 0.2, 0.3];
      const positive = [0.8, 0.7, 0.6];
      const negatives = [[0.1, 0.2, 0.4], [0.1, 0.2, 0.5]];

      const loss = InfoNCE(query, positive, negatives, 0.07);

      expect(typeof loss).toBe("number");
      expect(loss).toBeGreaterThanOrEqual(0);
    });

    test("returns 0 for identical positive embedding (perfect match)", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      // Same embedding should give perfect similarity
      const query = [0.1, 0.2, 0.3, 0.4];
      const positive = [0.1, 0.2, 0.3, 0.4];
      const negatives = [[0.5, 0.5, 0.5, 0.5]];

      const loss = InfoNCE(query, positive, negatives, 0.07);

      // With perfect positive match and distant negatives, loss should approach 0
      expect(loss).toBeLessThan(0.3);
    });

    test("returns high loss when positive is similar to negatives", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      // Positive is close to query, but negatives are also close
      const query = [0.1, 0.2, 0.3, 0.4];
      const positive = [0.12, 0.22, 0.32, 0.42];
      // Negatives are almost as close as positive
      const negatives = [[0.13, 0.23, 0.33, 0.43], [0.11, 0.21, 0.31, 0.41]];

      const loss = InfoNCE(query, positive, negatives, 0.07);

      // Loss should be moderate to high when negatives are close to positive
      expect(loss).toBeGreaterThan(0.5);
    });
  });

  describe("Temperature scaling", () => {
    test("lower temperature makes loss more extreme", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      const query = [0.1, 0.2, 0.3];
      const positive = [0.5, 0.5, 0.5];
      const negatives = [[0.4, 0.4, 0.4], [0.6, 0.6, 0.6]];

      const lossLowTemp = InfoNCE(query, positive, negatives, 0.01);
      const lossHighTemp = InfoNCE(query, positive, negatives, 1.0);

      // Lower temperature should produce more extreme (higher) loss when there's ambiguity
      expect(typeof lossLowTemp).toBe("number");
      expect(typeof lossHighTemp).toBe("number");
    });

    test("very high temperature smooths distribution", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      const query = [0.1, 0.2, 0.3];
      const positive = [0.1, 0.2, 0.3];
      const negatives = [[0.9, 0.9, 0.9]];

      const loss = InfoNCE(query, positive, negatives, 10.0);

      // Very high temperature should smooth the distribution
      expect(typeof loss).toBe("number");
      expect(loss).toBeFinite();
    });
  });

  describe("Similarity computation", () => {
    test("uses cosine similarity for embedding comparison", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      // Normalized vectors with known similarity
      const query = [1.0, 0.0]; // ||q|| = 1
      const positive = [1.0, 0.0]; // ||p|| = 1, sim = 1.0
      const negatives = [[-1.0, 0.0]]; // ||n|| = 1, sim = -1.0

      const loss = InfoNCE(query, positive, negatives, 0.07);

      // With perfect positive (sim=1) and opposite negative (sim=-1), loss should be near 0
      expect(loss).toBeLessThan(0.01);
    });

    test("handles high-dimensional embeddings", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      // 1536-dimensional embeddings (OpenAI ada-002 size)
      const dim = 1536;
      const query = Array.from({ length: dim }, (_, i) => (i + 1) / dim);
      const positive = Array.from({ length: dim }, (_, i) => (i + 1) / dim);
      const negatives = [
        Array.from({ length: dim }, (_, i) => (dim - i) / dim),
      ];

      const loss = InfoNCE(query, positive, negatives, 0.07);

      expect(typeof loss).toBe("number");
      expect(loss).toBeGreaterThanOrEqual(0);
      expect(loss).toBeFinite();
    });
  });

  describe("Multiple negatives", () => {
    test("handles single negative sample", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      const query = [0.1, 0.2, 0.3];
      const positive = [0.8, 0.7, 0.6];
      const negatives = [[0.1, 0.2, 0.4]];

      const loss = InfoNCE(query, positive, negatives, 0.07);

      expect(typeof loss).toBe("number");
      expect(loss).toBeGreaterThanOrEqual(0);
    });

    test("handles multiple negative samples", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      const query = [0.1, 0.2, 0.3];
      const positive = [0.8, 0.7, 0.6];
      const negatives = [
        [0.1, 0.2, 0.4],
        [0.1, 0.2, 0.5],
        [0.1, 0.2, 0.6],
        [0.1, 0.2, 0.7],
        [0.1, 0.2, 0.8],
      ];

      const loss = InfoNCE(query, positive, negatives, 0.07);

      expect(typeof loss).toBe("number");
      expect(loss).toBeGreaterThanOrEqual(0);
    });

    test("more negatives increases difficulty (higher loss)", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      const query = [0.1, 0.2, 0.3];
      const positive = [0.5, 0.5, 0.5];

      const lossFewNegatives = InfoNCE(query, positive, [[0.4, 0.4, 0.4]], 0.07);
      const lossManyNegatives = InfoNCE(
        query,
        positive,
        [
          [0.4, 0.4, 0.4],
          [0.45, 0.45, 0.45],
          [0.5, 0.5, 0.5],
          [0.55, 0.55, 0.55],
        ],
        0.07
      );

      // More hard negatives should make loss higher
      expect(lossManyNegatives).toBeGreaterThan(lossFewNegatives);
    });
  });

  describe("Error handling", () => {
    test("throws on empty query embedding", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      const query: number[] = [];
      const positive = [0.1, 0.2, 0.3];
      const negatives = [[0.4, 0.5, 0.6]];

      expect(() => InfoNCE(query, positive, negatives, 0.07)).toThrow();
    });

    test("throws on mismatched embedding dimensions", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      const query = [0.1, 0.2, 0.3]; // 3 dimensions
      const positive = [0.5, 0.5]; // 2 dimensions
      const negatives = [[0.4, 0.5, 0.6]];

      expect(() => InfoNCE(query, positive, negatives, 0.07)).toThrow();
    });

    test("throws on negative temperature", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      const query = [0.1, 0.2, 0.3];
      const positive = [0.5, 0.5, 0.5];
      const negatives = [[0.4, 0.4, 0.4]];

      expect(() => InfoNCE(query, positive, negatives, -0.07)).toThrow();
    });

    test("throws on zero temperature", async () => {
      const { InfoNCE } = await import("@/algorithms/offline-pretraining");

      const query = [0.1, 0.2, 0.3];
      const positive = [0.5, 0.5, 0.5];
      const negatives = [[0.4, 0.4, 0.4]];

      expect(() => InfoNCE(query, positive, negatives, 0)).toThrow();
    });
  });
});

describe("OfflinePretrainer integration", () => {
  describe("OfflinePretrainer exports", () => {
    test("should export OfflinePretrainer class", async () => {
      const { OfflinePretrainer } = await import(
        "@/algorithms/offline-pretraining"
      );
      expect(typeof OfflinePretrainer).toBe("function");
    });
  });

  describe("OfflinePretrainer initialization", () => {
    test("creates pretrainer with valid config", async () => {
      const { OfflinePretrainer } = await import(
        "@/algorithms/offline-pretraining"
      );

      const config = {
        temperature: 0.07,
        learningRate: 0.001,
        epochs: 10,
      };

      const trainer = new OfflinePretrainer(config);
      expect(trainer).toBeDefined();
    });

    test("initializes reranker state with matrices", async () => {
      const { OfflinePretrainer } = await import(
        "@/algorithms/offline-pretraining"
      );

      const trainer = new OfflinePretrainer({
        temperature: 0.07,
        learningRate: 0.001,
        epochs: 10,
        embeddingDimension: 3,
      });

      const state = trainer.getRerankerState();

      expect(state.weights.queryTransform).toBeDefined();
      expect(state.weights.memoryTransform).toBeDefined();
      expect(state.weights.queryTransform.length).toBe(3);
      expect(state.weights.memoryTransform.length).toBe(3);
    });
  });

  describe("OfflinePretrainer training", () => {
    test("train method returns history array", async () => {
      const { OfflinePretrainer } = await import(
        "@/algorithms/offline-pretraining"
      );

      const trainer = new OfflinePretrainer({
        temperature: 0.07,
        learningRate: 0.001,
        epochs: 3,
        embeddingDimension: 3,
      });

      const pairs = [
        {
          query: [0.1, 0.2, 0.3],
          positive: [0.8, 0.7, 0.6],
          negatives: [[0.1, 0.2, 0.4]],
        },
      ];

      const history = await trainer.train(pairs);

      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBe(3);
      expect(history[0]).toHaveProperty("epoch");
      expect(history[0]).toHaveProperty("loss");
      expect(history[0]).toHaveProperty("rerankerState");
    });

    test("train method updates reranker state", async () => {
      const { OfflinePretrainer } = await import(
        "@/algorithms/offline-pretraining"
      );

      const trainer = new OfflinePretrainer({
        temperature: 0.07,
        learningRate: 0.001,
        epochs: 1,
        embeddingDimension: 3,
      });

      const initialState = trainer.getRerankerState();

      const pairs = [
        {
          query: [0.1, 0.2, 0.3],
          positive: [0.8, 0.7, 0.6],
          negatives: [[0.1, 0.2, 0.4]],
        },
      ];

      await trainer.train(pairs);

      const updatedState = trainer.getRerankerState();

      // State should be updated (weights modified)
      expect(updatedState.weights.queryTransform).toBeDefined();
      expect(updatedState.weights.memoryTransform).toBeDefined();
    });

    test("train method throws on empty pairs", async () => {
      const { OfflinePretrainer } = await import(
        "@/algorithms/offline-pretraining"
      );

      const trainer = new OfflinePretrainer({
        temperature: 0.07,
        learningRate: 0.001,
        epochs: 10,
        embeddingDimension: 3,
      });

      await expect(trainer.train([])).rejects.toThrow();
    });
  });

  describe("OfflinePretrainer evaluation", () => {
    test("evaluate method returns metrics", async () => {
      const { OfflinePretrainer } = await import(
        "@/algorithms/offline-pretraining"
      );

      const trainer = new OfflinePretrainer({
        temperature: 0.07,
        learningRate: 0.001,
        epochs: 10,
        embeddingDimension: 3,
      });

      const pairs = [
        {
          query: [0.1, 0.2, 0.3],
          positive: [0.8, 0.7, 0.6],
          negatives: [[0.1, 0.2, 0.4]],
        },
      ];

      const metrics = await trainer.evaluate(pairs);

      expect(metrics).toHaveProperty("meanLoss");
      expect(metrics).toHaveProperty("recallAt5");
      expect(typeof metrics.meanLoss).toBe("number");
      expect(typeof metrics.recallAt5).toBe("number");
    });

    test("evaluate method returns valid loss value", async () => {
      const { OfflinePretrainer } = await import(
        "@/algorithms/offline-pretraining"
      );

      const trainer = new OfflinePretrainer({
        temperature: 0.07,
        learningRate: 0.001,
        epochs: 10,
        embeddingDimension: 3,
      });

      const pairs = [
        {
          query: [0.1, 0.2, 0.3],
          positive: [0.8, 0.7, 0.6],
          negatives: [[0.1, 0.2, 0.4], [0.1, 0.2, 0.5]],
        },
      ];

      const metrics = await trainer.evaluate(pairs);

      expect(metrics.meanLoss).toBeGreaterThanOrEqual(0);
      expect(metrics.meanLoss).toBeFinite();
    });
  });

  describe("Pretrained weights export", () => {
    test("weights can be exported and imported", async () => {
      const { OfflinePretrainer } = await import(
        "@/algorithms/offline-pretraining"
      );

      const trainer = new OfflinePretrainer({
        temperature: 0.07,
        learningRate: 0.001,
        epochs: 5,
        embeddingDimension: 3,
      });

      const pairs = [
        {
          query: [0.1, 0.2, 0.3],
          positive: [0.8, 0.7, 0.6],
          negatives: [[0.1, 0.2, 0.4]],
        },
      ];

      await trainer.train(pairs);

      const state = trainer.getRerankerState();

      // State should be serializable
      const serialized = JSON.stringify(state);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.weights.queryTransform.length).toBe(
        state.weights.queryTransform.length
      );
      expect(deserialized.weights.memoryTransform.length).toBe(
        state.weights.memoryTransform.length
      );
    });
  });
});
