import { describe, expect, test } from "bun:test";
import {
  EMBEDDING_DIMENSION,
  type RerankerState,
} from "@/schemas";
import { createWeightStorage } from "@/storage/weight-storage";
import {
  createFailingMockBaseStore,
  createMockBaseStore,
} from "../fixtures/mock-base-store";

// ============================================================================
// Test Helpers
// ============================================================================

const createValidMatrix = (): number[][] =>
  Array.from({ length: EMBEDDING_DIMENSION }, () =>
    Array.from(
      { length: EMBEDDING_DIMENSION },
      () => Math.random() * 0.02 - 0.01
    )
  );

const createValidRerankerState = (): RerankerState => ({
  weights: {
    queryTransform: createValidMatrix(),
    memoryTransform: createValidMatrix(),
  },
  config: {
    topK: 20,
    topM: 5,
    temperature: 0.5,
    learningRate: 0.001,
    baseline: 0.5,
  },
});

// ============================================================================
// Weight Storage Tests
// ============================================================================

describe("WeightStorage", () => {
  describe("loadWeights", () => {
    test("returns null when weights do not exist", async () => {
      const store = createMockBaseStore();
      const weightStorage = createWeightStorage(store);

      const result = await weightStorage.loadWeights("user-123");

      expect(result).toBeNull();
    });

    test("returns RerankerState when weights exist", async () => {
      const store = createMockBaseStore();
      const weightStorage = createWeightStorage(store);
      const weights = createValidRerankerState();

      await weightStorage.saveWeights("user-123", weights);
      const result = await weightStorage.loadWeights("user-123");

      expect(result).not.toBeNull();
      expect(result?.weights.queryTransform).toEqual(
        weights.weights.queryTransform
      );
      expect(result?.weights.memoryTransform).toEqual(
        weights.weights.memoryTransform
      );
      expect(result?.config).toEqual(weights.config);
    });

    test("returns null when stored data is corrupted/invalid", async () => {
      const store = createMockBaseStore();
      const weightStorage = createWeightStorage(store);

      // Manually store invalid data
      await store.put(["rmm", "user-123", "weights"], "reranker", {
        invalid: "data",
      });

      const result = await weightStorage.loadWeights("user-123");

      expect(result).toBeNull();
    });

    test("returns null when stored data has wrong matrix dimensions", async () => {
      const store = createMockBaseStore();
      const weightStorage = createWeightStorage(store);

      // Store data with wrong matrix dimensions
      await store.put(["rmm", "user-123", "weights"], "reranker", {
        weights: {
          queryTransform: [[1, 2]], // Wrong dimensions
          memoryTransform: [[3, 4]], // Wrong dimensions
        },
        config: {
          topK: 20,
          topM: 5,
          temperature: 0.5,
          learningRate: 0.001,
          baseline: 0.5,
        },
      });

      const result = await weightStorage.loadWeights("user-123");

      expect(result).toBeNull();
    });

    test("isolates namespaces per userId", async () => {
      const store = createMockBaseStore();
      const weightStorage = createWeightStorage(store);
      const weights1 = createValidRerankerState();
      const weights2 = createValidRerankerState();

      await weightStorage.saveWeights("user-1", weights1);
      await weightStorage.saveWeights("user-2", weights2);

      const result1 = await weightStorage.loadWeights("user-1");
      const result2 = await weightStorage.loadWeights("user-2");

      expect(result1?.weights.queryTransform).toEqual(
        weights1.weights.queryTransform
      );
      expect(result2?.weights.queryTransform).toEqual(
        weights2.weights.queryTransform
      );
    });
  });

  describe("saveWeights", () => {
    test("returns true on successful save", async () => {
      const store = createMockBaseStore();
      const weightStorage = createWeightStorage(store);
      const weights = createValidRerankerState();

      const result = await weightStorage.saveWeights("user-123", weights);

      expect(result).toBe(true);
    });

    test("returns false when weights are invalid", async () => {
      const store = createMockBaseStore();
      const weightStorage = createWeightStorage(store);

      const invalidWeights = {
        weights: {
          queryTransform: [[1, 2]], // Wrong dimensions
          memoryTransform: [[3, 4]], // Wrong dimensions
        },
        config: {
          topK: 20,
          topM: 5,
          temperature: 0.5,
          learningRate: 0.001,
          baseline: 0.5,
        },
      } as RerankerState;

      const result = await weightStorage.saveWeights(
        "user-123",
        invalidWeights
      );

      expect(result).toBe(false);
    });

    test("persists data that can be loaded back", async () => {
      const store = createMockBaseStore();
      const weightStorage = createWeightStorage(store);
      const weights = createValidRerankerState();

      await weightStorage.saveWeights("user-123", weights);
      const loaded = await weightStorage.loadWeights("user-123");

      expect(loaded).not.toBeNull();
      expect(loaded?.weights.queryTransform).toEqual(
        weights.weights.queryTransform
      );
      expect(loaded?.weights.memoryTransform).toEqual(
        weights.weights.memoryTransform
      );
      expect(loaded?.config).toEqual(weights.config);
    });

    test("includes updatedAt timestamp when saving", async () => {
      const store = createMockBaseStore();
      const weightStorage = createWeightStorage(store);
      const weights = createValidRerankerState();

      const beforeSave = Date.now();
      await weightStorage.saveWeights("user-123", weights);
      const afterSave = Date.now();

      const item = await store.get(["rmm", "user-123", "weights"], "reranker");
      expect(item).not.toBeNull();
      expect(item?.value).toHaveProperty("updatedAt");
      expect(typeof item?.value.updatedAt).toBe("number");
      expect(item?.value.updatedAt).toBeGreaterThanOrEqual(beforeSave);
      expect(item?.value.updatedAt).toBeLessThanOrEqual(afterSave);
    });

    test("overwrites existing weights on subsequent saves", async () => {
      const store = createMockBaseStore();
      const weightStorage = createWeightStorage(store);
      const weights1 = createValidRerankerState();
      const weights2 = createValidRerankerState();

      await weightStorage.saveWeights("user-123", weights1);
      await weightStorage.saveWeights("user-123", weights2);

      const loaded = await weightStorage.loadWeights("user-123");

      expect(loaded?.weights.queryTransform).toEqual(
        weights2.weights.queryTransform
      );
    });
  });

  describe("error handling", () => {
    test("returns null when BaseStore throws on get", async () => {
      const store = createFailingMockBaseStore("get");
      const weightStorage = createWeightStorage(store);

      const result = await weightStorage.loadWeights("user-123");

      expect(result).toBeNull();
    });

    test("returns false when BaseStore throws on put", async () => {
      const store = createFailingMockBaseStore("put");
      const weightStorage = createWeightStorage(store);
      const weights = createValidRerankerState();

      const result = await weightStorage.saveWeights("user-123", weights);

      expect(result).toBe(false);
    });

    test("returns null when BaseStore is completely unavailable", async () => {
      const store = createFailingMockBaseStore("all");
      const weightStorage = createWeightStorage(store);

      const result = await weightStorage.loadWeights("user-123");

      expect(result).toBeNull();
    });

    test("returns false when saving and BaseStore is unavailable", async () => {
      const store = createFailingMockBaseStore("all");
      const weightStorage = createWeightStorage(store);
      const weights = createValidRerankerState();

      const result = await weightStorage.saveWeights("user-123", weights);

      expect(result).toBe(false);
    });
  });

  describe("data integrity", () => {
    test("serialization roundtrip preserves matrix values", async () => {
      const store = createMockBaseStore();
      const weightStorage = createWeightStorage(store);
      const weights = createValidRerankerState();

      // Modify specific values to verify precision
      weights.weights.queryTransform[0][0] = 0.123_456_789;
      weights.weights.memoryTransform[100][200] = -0.987_654_321;

      await weightStorage.saveWeights("user-123", weights);
      const loaded = await weightStorage.loadWeights("user-123");

      expect(loaded?.weights.queryTransform[0][0]).toBe(0.123_456_789);
      expect(loaded?.weights.memoryTransform[100][200]).toBe(-0.987_654_321);
    });

    test("handles large matrices efficiently (18MB)", async () => {
      const store = createMockBaseStore();
      const weightStorage = createWeightStorage(store);
      const weights = createValidRerankerState();

      const startTime = Date.now();
      await weightStorage.saveWeights("user-123", weights);
      const saveTime = Date.now() - startTime;

      const loadStartTime = Date.now();
      const loaded = await weightStorage.loadWeights("user-123");
      const loadTime = Date.now() - loadStartTime;

      expect(loaded).not.toBeNull();
      // Should complete in reasonable time (< 5 seconds for save+load)
      expect(saveTime + loadTime).toBeLessThan(5000);
    });
  });
});
