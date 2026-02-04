import { describe, expect, test } from "bun:test";
import type { SessionMetadata } from "@/schemas";
import { createMetadataStorage } from "@/storage/metadata-storage";
import {
  createFailingMockBaseStore,
  createMockBaseStore,
} from "../fixtures/mock-base-store";

// ============================================================================
// Test Helpers
// ============================================================================

const createValidMetadata = (): SessionMetadata => ({
  version: "1.0.0",
  configHash: "abc123def456",
  sessionCount: 5,
  lastUpdated: Date.now(),
});

// ============================================================================
// Metadata Storage Tests
// ============================================================================

describe("MetadataStorage", () => {
  describe("loadMetadata", () => {
    test("returns null when metadata does not exist", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);

      const result = await metadataStorage.loadMetadata("user-123");

      expect(result).toBeNull();
    });

    test("returns SessionMetadata when it exists", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);
      const metadata = createValidMetadata();

      await metadataStorage.saveMetadata("user-123", metadata);
      const result = await metadataStorage.loadMetadata("user-123");

      expect(result).not.toBeNull();
      expect(result?.version).toBe(metadata.version);
      expect(result?.configHash).toBe(metadata.configHash);
      expect(result?.sessionCount).toBe(metadata.sessionCount);
      expect(result?.lastUpdated).toBe(metadata.lastUpdated);
    });

    test("returns null when stored data is corrupted/invalid", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);

      // Manually store invalid data
      await store.put(["rmm", "user-123", "metadata"], "session", {
        invalid: "data",
      });

      const result = await metadataStorage.loadMetadata("user-123");

      expect(result).toBeNull();
    });

    test("returns null when sessionCount is negative", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);

      // Store data with negative session count
      await store.put(["rmm", "user-123", "metadata"], "session", {
        version: "1.0.0",
        configHash: "abc123",
        sessionCount: -1,
        lastUpdated: Date.now(),
      });

      const result = await metadataStorage.loadMetadata("user-123");

      expect(result).toBeNull();
    });

    test("returns null when version is empty", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);

      await store.put(["rmm", "user-123", "metadata"], "session", {
        version: "",
        configHash: "abc123",
        sessionCount: 5,
        lastUpdated: Date.now(),
      });

      const result = await metadataStorage.loadMetadata("user-123");

      expect(result).toBeNull();
    });

    test("isolates namespaces per userId", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);
      const metadata1: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash1",
        sessionCount: 5,
        lastUpdated: 12_345,
      };
      const metadata2: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash2",
        sessionCount: 10,
        lastUpdated: 67_890,
      };

      await metadataStorage.saveMetadata("user-1", metadata1);
      await metadataStorage.saveMetadata("user-2", metadata2);

      const result1 = await metadataStorage.loadMetadata("user-1");
      const result2 = await metadataStorage.loadMetadata("user-2");

      expect(result1?.configHash).toBe("hash1");
      expect(result1?.sessionCount).toBe(5);
      expect(result2?.configHash).toBe("hash2");
      expect(result2?.sessionCount).toBe(10);
    });
  });

  describe("saveMetadata", () => {
    test("returns true on successful save", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);
      const metadata = createValidMetadata();

      const result = await metadataStorage.saveMetadata("user-123", metadata);

      expect(result).toBe(true);
    });

    test("returns false when metadata is invalid", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);

      const invalidMetadata = {
        version: "", // Empty version
        configHash: "abc123",
        sessionCount: 5,
        lastUpdated: Date.now(),
      } as SessionMetadata;

      const result = await metadataStorage.saveMetadata(
        "user-123",
        invalidMetadata
      );

      expect(result).toBe(false);
    });

    test("returns false when sessionCount is negative", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);

      const invalidMetadata: SessionMetadata = {
        version: "1.0.0",
        configHash: "abc123",
        sessionCount: -1,
        lastUpdated: Date.now(),
      };

      const result = await metadataStorage.saveMetadata(
        "user-123",
        invalidMetadata
      );

      expect(result).toBe(false);
    });

    test("persists data that can be loaded back", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);
      const metadata = createValidMetadata();

      await metadataStorage.saveMetadata("user-123", metadata);
      const loaded = await metadataStorage.loadMetadata("user-123");

      expect(loaded).not.toBeNull();
      expect(loaded?.version).toBe(metadata.version);
      expect(loaded?.configHash).toBe(metadata.configHash);
      expect(loaded?.sessionCount).toBe(metadata.sessionCount);
      expect(loaded?.lastUpdated).toBe(metadata.lastUpdated);
    });

    test("overwrites existing metadata on subsequent saves", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);
      const metadata1: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash1",
        sessionCount: 5,
        lastUpdated: Date.now(),
      };
      const metadata2: SessionMetadata = {
        version: "1.1.0",
        configHash: "hash2",
        sessionCount: 10,
        lastUpdated: Date.now(),
      };

      await metadataStorage.saveMetadata("user-123", metadata1);
      await metadataStorage.saveMetadata("user-123", metadata2);

      const loaded = await metadataStorage.loadMetadata("user-123");

      expect(loaded?.version).toBe("1.1.0");
      expect(loaded?.configHash).toBe("hash2");
      expect(loaded?.sessionCount).toBe(10);
    });
  });

  describe("version tracking", () => {
    test("persists version tracking information", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);
      const metadata: SessionMetadata = {
        version: "2.0.0",
        configHash: "sha256:abcdef",
        sessionCount: 42,
        lastUpdated: 1_704_067_200_000,
      };

      await metadataStorage.saveMetadata("user-123", metadata);
      const loaded = await metadataStorage.loadMetadata("user-123");

      expect(loaded?.version).toBe("2.0.0");
      expect(loaded?.configHash).toBe("sha256:abcdef");
    });

    test("handles different version formats", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);

      const versions = ["1.0.0", "1.0.0-beta", "2.0.0-alpha.1", "3.0"];

      for (const version of versions) {
        const metadata: SessionMetadata = {
          version,
          configHash: "hash",
          sessionCount: 1,
          lastUpdated: Date.now(),
        };

        await metadataStorage.saveMetadata(`user-${version}`, metadata);
        const loaded = await metadataStorage.loadMetadata(`user-${version}`);

        expect(loaded?.version).toBe(version);
      }
    });
  });

  describe("session counter", () => {
    test("persists session count correctly", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);
      const metadata: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash",
        sessionCount: 0,
        lastUpdated: Date.now(),
      };

      await metadataStorage.saveMetadata("user-123", metadata);
      const loaded = await metadataStorage.loadMetadata("user-123");

      expect(loaded?.sessionCount).toBe(0);
    });

    test("handles large session counts", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);
      const metadata: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash",
        sessionCount: 1_000_000,
        lastUpdated: Date.now(),
      };

      await metadataStorage.saveMetadata("user-123", metadata);
      const loaded = await metadataStorage.loadMetadata("user-123");

      expect(loaded?.sessionCount).toBe(1_000_000);
    });
  });

  describe("error handling", () => {
    test("returns null when BaseStore throws on get", async () => {
      const store = createFailingMockBaseStore("get");
      const metadataStorage = createMetadataStorage(store);

      const result = await metadataStorage.loadMetadata("user-123");

      expect(result).toBeNull();
    });

    test("returns false when BaseStore throws on put", async () => {
      const store = createFailingMockBaseStore("put");
      const metadataStorage = createMetadataStorage(store);
      const metadata = createValidMetadata();

      const result = await metadataStorage.saveMetadata("user-123", metadata);

      expect(result).toBe(false);
    });

    test("returns null when BaseStore is completely unavailable", async () => {
      const store = createFailingMockBaseStore("all");
      const metadataStorage = createMetadataStorage(store);

      const result = await metadataStorage.loadMetadata("user-123");

      expect(result).toBeNull();
    });

    test("returns false when saving and BaseStore is unavailable", async () => {
      const store = createFailingMockBaseStore("all");
      const metadataStorage = createMetadataStorage(store);
      const metadata = createValidMetadata();

      const result = await metadataStorage.saveMetadata("user-123", metadata);

      expect(result).toBe(false);
    });
  });

  describe("timestamp handling", () => {
    test("preserves lastUpdated timestamp through roundtrip", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);
      const timestamp = 1_704_067_200_000; // Fixed timestamp
      const metadata: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash",
        sessionCount: 5,
        lastUpdated: timestamp,
      };

      await metadataStorage.saveMetadata("user-123", metadata);
      const loaded = await metadataStorage.loadMetadata("user-123");

      expect(loaded?.lastUpdated).toBe(timestamp);
    });

    test("handles current timestamps correctly", async () => {
      const store = createMockBaseStore();
      const metadataStorage = createMetadataStorage(store);
      const beforeSave = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

      const metadata: SessionMetadata = {
        version: "1.0.0",
        configHash: "hash",
        sessionCount: 1,
        lastUpdated: Date.now(),
      };

      await metadataStorage.saveMetadata("user-123", metadata);
      const loaded = await metadataStorage.loadMetadata("user-123");

      const afterLoad = Math.floor(Date.now() / 1000) + 1; // Add buffer

      expect(loaded?.lastUpdated).toBeGreaterThanOrEqual(beforeSave * 1000);
      expect(loaded?.lastUpdated).toBeLessThanOrEqual(afterLoad * 1000);
    });
  });
});
