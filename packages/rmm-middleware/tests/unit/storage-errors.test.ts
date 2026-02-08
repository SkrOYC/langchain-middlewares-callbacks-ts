import { describe, expect, test } from "bun:test";
import type { BaseStore, Item } from "@langchain/langgraph-checkpoint";
import {
  DEFAULT_EMBEDDING_DIMENSION,
  type RerankerState,
  type SessionMetadata,
} from "@/schemas";
import {
  createMetadataStorage,
  createStorageAdapters,
} from "@/storage/metadata-storage";
import { createWeightStorage } from "@/storage/weight-storage";

// ============================================================================
// Test Helpers
// ============================================================================

const createValidMatrix = (): number[][] =>
  Array.from({ length: DEFAULT_EMBEDDING_DIMENSION }, () =>
    Array.from(
      { length: DEFAULT_EMBEDDING_DIMENSION },
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
// Mock Implementations for Error Testing
// ============================================================================

/**
 * Creates a mock BaseStore that throws specific error types
 */
function createErrorThrowingMockBaseStore(error: Error): BaseStore {
  return {
    async get(): Promise<never> {
      return await Promise.reject(error);
    },

    async put(): Promise<never> {
      return await Promise.reject(error);
    },

    async delete(): Promise<never> {
      return await Promise.reject(error);
    },

    async batch(): Promise<never> {
      return await Promise.reject(error);
    },

    async search(): Promise<never> {
      return await Promise.reject(error);
    },

    async listNamespaces(): Promise<never> {
      return await Promise.reject(error);
    },
  };
}

/**
 * Creates a mock BaseStore that simulates network timeouts
 */
function createTimeoutMockBaseStore(delayMs: number): BaseStore {
  const timeoutError = new Error("Request timeout");
  timeoutError.name = "TimeoutError";

  return {
    async get(): Promise<never> {
      await new Promise((_, reject) => {
        setTimeout(() => reject(timeoutError), delayMs);
      });
      return await Promise.reject(timeoutError);
    },
    async put(): Promise<never> {
      await new Promise((_, reject) => {
        setTimeout(() => reject(timeoutError), delayMs);
      });
      return await Promise.reject(timeoutError);
    },
    async delete(): Promise<never> {
      return await Promise.reject(timeoutError);
    },
    async batch(): Promise<never> {
      return await Promise.reject(timeoutError);
    },
    async search(): Promise<never> {
      return await Promise.reject(timeoutError);
    },
    async listNamespaces(): Promise<never> {
      return await Promise.reject(timeoutError);
    },
  };
}

/**
 * Creates a mock BaseStore with partial failures
 */
function createPartialFailureMockBaseStore(failAfterOperations = 1): BaseStore {
  let operationCount = 0;
  const storage = new Map<string, Item>();

  const buildPath = (namespace: string[], key: string): string =>
    [...namespace, key].join(":");

  return {
    async get(namespace: string[], key: string): Promise<Item | null> {
      operationCount++;
      if (operationCount > failAfterOperations) {
        return await Promise.reject(new Error("Simulated partial failure"));
      }
      const path = buildPath(namespace, key);
      return await Promise.resolve(storage.get(path) ?? null);
    },
    async put(
      namespace: string[],
      key: string,
      value: Record<string, unknown>
    ): Promise<void> {
      operationCount++;
      if (operationCount > failAfterOperations) {
        return await Promise.reject(new Error("Simulated partial failure"));
      }
      const path = buildPath(namespace, key);
      const now = new Date();
      const item: Item = {
        value,
        key,
        namespace,
        createdAt: now,
        updatedAt: now,
      };
      storage.set(path, item);
      return await Promise.resolve();
    },
    async delete(): Promise<void> {
      operationCount++;
      if (operationCount > failAfterOperations) {
        return await Promise.reject(new Error("Simulated partial failure"));
      }
      return await Promise.resolve();
    },
    async batch(): Promise<never> {
      return await Promise.reject(new Error("Not implemented"));
    },
    async search(): Promise<never> {
      return await Promise.reject(new Error("Not implemented"));
    },
    async listNamespaces(): Promise<never> {
      return await Promise.reject(new Error("Not implemented"));
    },
  };
}

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("Storage Error Handling", () => {
  describe("BaseStore unavailable scenarios", () => {
    test("weightStorage.loadWeights returns null when BaseStore throws", async () => {
      const error = new Error("Connection refused");
      const store = createErrorThrowingMockBaseStore(error);
      const weightStorage = createWeightStorage(store);

      const result = await weightStorage.loadWeights("user-123");

      expect(result).toBeNull();
    });

    test("weightStorage.saveWeights returns false when BaseStore throws", async () => {
      const error = new Error("Connection refused");
      const store = createErrorThrowingMockBaseStore(error);
      const weightStorage = createWeightStorage(store);
      const weights = createValidRerankerState();

      const result = await weightStorage.saveWeights("user-123", weights);

      expect(result).toBe(false);
    });

    test("metadataStorage.loadMetadata returns null when BaseStore throws", async () => {
      const error = new Error("Service unavailable");
      const store = createErrorThrowingMockBaseStore(error);
      const metadataStorage = createMetadataStorage(store);

      const result = await metadataStorage.loadMetadata("user-123");

      expect(result).toBeNull();
    });

    test("metadataStorage.saveMetadata returns false when BaseStore throws", async () => {
      const error = new Error("Service unavailable");
      const store = createErrorThrowingMockBaseStore(error);
      const metadataStorage = createMetadataStorage(store);
      const metadata: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash",
        sessionCount: 5,
        lastUpdated: Date.now(),
      };

      const result = await metadataStorage.saveMetadata("user-123", metadata);

      expect(result).toBe(false);
    });
  });

  describe("Network timeout scenarios", () => {
    test("weightStorage.loadWeights handles timeout gracefully", async () => {
      const store = createTimeoutMockBaseStore(10);
      const weightStorage = createWeightStorage(store);

      const result = await weightStorage.loadWeights("user-123");

      expect(result).toBeNull();
    });

    test("weightStorage.saveWeights handles timeout gracefully", async () => {
      const store = createTimeoutMockBaseStore(10);
      const weightStorage = createWeightStorage(store);
      const weights = createValidRerankerState();

      const result = await weightStorage.saveWeights("user-123", weights);

      expect(result).toBe(false);
    });

    test("metadataStorage handles timeout gracefully", async () => {
      const store = createTimeoutMockBaseStore(10);
      const metadataStorage = createMetadataStorage(store);
      const metadata: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash",
        sessionCount: 5,
        lastUpdated: Date.now(),
      };

      const loadResult = await metadataStorage.loadMetadata("user-123");
      const saveResult = await metadataStorage.saveMetadata(
        "user-123",
        metadata
      );

      expect(loadResult).toBeNull();
      expect(saveResult).toBe(false);
    });
  });

  describe("Partial write scenarios", () => {
    test("weightStorage handles partial failure after initial success", async () => {
      const store = createPartialFailureMockBaseStore(1);
      const weightStorage = createWeightStorage(store);
      const weights = createValidRerankerState();

      // First operation succeeds
      const result1 = await weightStorage.saveWeights("user-123", weights);
      expect(result1).toBe(true);

      // Second operation fails
      const result2 = await weightStorage.loadWeights("user-123");
      expect(result2).toBeNull();
    });

    test("metadataStorage handles partial failure after initial success", async () => {
      const store = createPartialFailureMockBaseStore(1);
      const metadataStorage = createMetadataStorage(store);
      const metadata: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash",
        sessionCount: 5,
        lastUpdated: Date.now(),
      };

      // First operation succeeds
      const result1 = await metadataStorage.saveMetadata("user-123", metadata);
      expect(result1).toBe(true);

      // Second operation fails
      const result2 = await metadataStorage.loadMetadata("user-123");
      expect(result2).toBeNull();
    });
  });

  describe("Concurrent access scenarios", () => {
    test("weightStorage handles concurrent reads", async () => {
      const store = createPartialFailureMockBaseStore(100);
      const weightStorage = createWeightStorage(store);
      const weights = createValidRerankerState();

      await weightStorage.saveWeights("user-123", weights);

      // Concurrent reads
      const results = await Promise.all([
        weightStorage.loadWeights("user-123"),
        weightStorage.loadWeights("user-123"),
        weightStorage.loadWeights("user-123"),
      ]);

      // All should succeed (first 3 operations allowed)
      expect(results[0]).not.toBeNull();
      expect(results[1]).not.toBeNull();
      expect(results[2]).not.toBeNull();
    });

    test("last-write-wins behavior on concurrent saves", async () => {
      const store = createPartialFailureMockBaseStore(100);
      const metadataStorage = createMetadataStorage(store);

      const metadata1: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash1",
        sessionCount: 1,
        lastUpdated: Date.now(),
      };

      const metadata2: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash2",
        sessionCount: 2,
        lastUpdated: Date.now(),
      };

      // Concurrent saves
      await Promise.all([
        metadataStorage.saveMetadata("user-123", metadata1),
        metadataStorage.saveMetadata("user-123", metadata2),
      ]);

      // One of them should succeed (last-write-wins is acceptable per spec)
      const result = await metadataStorage.loadMetadata("user-123");
      expect(result).not.toBeNull();
    });
  });

  describe("Different error types", () => {
    const errorTypes = [
      { name: "TypeError", error: new TypeError("Invalid type") },
      { name: "RangeError", error: new RangeError("Out of range") },
      { name: "ReferenceError", error: new ReferenceError("Not defined") },
      { name: "NetworkError", error: new Error("Network error") },
      { name: "AuthError", error: new Error("Authentication failed") },
    ];

    for (const { name, error } of errorTypes) {
      test(`weightStorage handles ${name} gracefully`, async () => {
        const store = createErrorThrowingMockBaseStore(error);
        const weightStorage = createWeightStorage(store);
        const weights = createValidRerankerState();

        const loadResult = await weightStorage.loadWeights("user-123");
        const saveResult = await weightStorage.saveWeights("user-123", weights);

        expect(loadResult).toBeNull();
        expect(saveResult).toBe(false);
      });

      test(`metadataStorage handles ${name} gracefully`, async () => {
        const store = createErrorThrowingMockBaseStore(error);
        const metadataStorage = createMetadataStorage(store);
        const metadata: SessionMetadata = {
          version: "1.0.0",
          configHash: "hash",
          sessionCount: 5,
          lastUpdated: Date.now(),
        };

        const loadResult = await metadataStorage.loadMetadata("user-123");
        const saveResult = await metadataStorage.saveMetadata(
          "user-123",
          metadata
        );

        expect(loadResult).toBeNull();
        expect(saveResult).toBe(false);
      });
    }
  });

  describe("createStorageAdapters error handling", () => {
    test("factory creates adapters that handle errors gracefully", async () => {
      const error = new Error("BaseStore unavailable");
      const store = createErrorThrowingMockBaseStore(error);
      const adapters = createStorageAdapters(store);
      const weights = createValidRerankerState();
      const metadata: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash",
        sessionCount: 5,
        lastUpdated: Date.now(),
      };

      const weightLoad = await adapters.weights.loadWeights("user-123");
      const weightSave = await adapters.weights.saveWeights(
        "user-123",
        weights
      );
      const metaLoad = await adapters.metadata.loadMetadata("user-123");
      const metaSave = await adapters.metadata.saveMetadata(
        "user-123",
        metadata
      );

      expect(weightLoad).toBeNull();
      expect(weightSave).toBe(false);
      expect(metaLoad).toBeNull();
      expect(metaSave).toBe(false);
    });
  });

  describe("No exceptions thrown", () => {
    test("weightStorage.loadWeights never throws", async () => {
      const errors = [
        new Error("Any error"),
        new TypeError("Type error"),
        new RangeError("Range error"),
        new Error("Empty error message"), // Empty message
      ];

      for (const error of errors) {
        const store = createErrorThrowingMockBaseStore(error);
        const weightStorage = createWeightStorage(store);

        let thrown = false;
        try {
          await weightStorage.loadWeights("user-123");
        } catch {
          thrown = true;
        }

        expect(thrown).toBe(false);
      }
    });

    test("weightStorage.saveWeights never throws", async () => {
      const store = createErrorThrowingMockBaseStore(new Error("Test"));
      const weightStorage = createWeightStorage(store);
      const weights = createValidRerankerState();

      let thrown = false;
      try {
        await weightStorage.saveWeights("user-123", weights);
      } catch {
        thrown = true;
      }

      expect(thrown).toBe(false);
    });

    test("metadataStorage never throws", async () => {
      const store = createErrorThrowingMockBaseStore(new Error("Test"));
      const metadataStorage = createMetadataStorage(store);
      const metadata: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash",
        sessionCount: 5,
        lastUpdated: Date.now(),
      };

      let loadThrown = false;
      let saveThrown = false;

      try {
        await metadataStorage.loadMetadata("user-123");
      } catch {
        loadThrown = true;
      }

      try {
        await metadataStorage.saveMetadata("user-123", metadata);
      } catch {
        saveThrown = true;
      }

      expect(loadThrown).toBe(false);
      expect(saveThrown).toBe(false);
    });
  });
});
