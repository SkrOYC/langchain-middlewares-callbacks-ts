import { describe, expect, test } from "bun:test";
import type { BaseStore, Item } from "@langchain/langgraph-checkpoint";
import type { MessageBuffer } from "@/schemas/index";
import { createMessageBufferStorage } from "@/storage/message-buffer-storage";
import { createSerializedMessage } from "@/tests/helpers/messages";

/**
 * Tests for MessageBufferStorage
 *
 * These tests verify:
 * 1. Basic buffer operations (load, save, clear)
 * 2. Staging pattern (stageBuffer, clearStaging)
 * 3. Custom namespace isolation
 */

function createMockStore(existingItems?: Map<string, Item>): {
  get: BaseStore["get"];
  put: BaseStore["put"];
  delete: BaseStore["delete"];
} {
  const storeItems = existingItems ?? new Map<string, Item>();

  return {
    async get(namespace, key) {
      const fullKey = [...namespace, key].join("|");
      return await Promise.resolve(storeItems.get(fullKey) ?? null);
    },
    async put(namespace, key, value) {
      const fullKey = [...namespace, key].join("|");
      storeItems.set(fullKey, {
        value,
        key,
        namespace,
        created_at: new Date(),
        updated_at: new Date(),
      });
      return await Promise.resolve();
    },
    async delete(namespace, key) {
      const fullKey = [...namespace, key].join("|");
      storeItems.delete(fullKey);
      return await Promise.resolve();
    },
  };
}

describe("MessageBufferStorage", () => {
  describe("Basic Operations", () => {
    test("loadBuffer returns empty buffer when none exists", async () => {
      const mockStore = createMockStore();
      const storage = createMessageBufferStorage(mockStore);

      const buffer = await storage.loadBuffer("test-user");

      expect(buffer.messages).toHaveLength(0);
      expect(buffer.humanMessageCount).toBe(0);
    });

    test("saveBuffer persists buffer correctly", async () => {
      const mockStore = createMockStore();
      const storage = createMessageBufferStorage(mockStore);

      const buffer: MessageBuffer = {
        messages: [createSerializedMessage("human", "Hello")],
        humanMessageCount: 1,
        lastMessageTimestamp: Date.now(),
        createdAt: Date.now(),
      };

      const result = await storage.saveBuffer("test-user", buffer);
      expect(result).toBe(true);

      const loadedBuffer = await storage.loadBuffer("test-user");
      expect(loadedBuffer.messages).toHaveLength(1);
      expect(loadedBuffer.humanMessageCount).toBe(1);
    });

    test("clearBuffer resets to empty buffer", async () => {
      const mockStore = createMockStore();
      const storage = createMessageBufferStorage(mockStore);

      // Save a buffer first
      const buffer: MessageBuffer = {
        messages: [createSerializedMessage("human", "Hello")],
        humanMessageCount: 1,
        lastMessageTimestamp: Date.now(),
        createdAt: Date.now(),
      };
      await storage.saveBuffer("test-user", buffer);

      // Clear it
      const result = await storage.clearBuffer("test-user");
      expect(result).toBe(true);

      // Verify empty
      const loadedBuffer = await storage.loadBuffer("test-user");
      expect(loadedBuffer.messages).toHaveLength(0);
      expect(loadedBuffer.humanMessageCount).toBe(0);
    });

    test("loadBufferItem returns Item with updatedAt", async () => {
      const storeItems = new Map<string, Item>();
      const mockStore = createMockStore(storeItems);

      const buffer: MessageBuffer = {
        messages: [createSerializedMessage("human", "Hello")],
        humanMessageCount: 1,
        lastMessageTimestamp: Date.now(),
        createdAt: Date.now(),
      };

      storeItems.set("rmm|test-user|buffer|message-buffer", {
        value: buffer,
        key: "message-buffer",
        namespace: ["rmm", "test-user", "buffer"],
        created_at: new Date(Date.now() - 1000),
        updated_at: new Date(),
      });

      const storage = createMessageBufferStorage(mockStore);
      const item = await storage.loadBufferItem("test-user");

      expect(item).not.toBeNull();
      expect(item?.updated_at.getTime()).toBeGreaterThan(
        item?.created_at.getTime()
      );
    });
  });

  describe("Staging Pattern", () => {
    test("stageBuffer creates staging copy of buffer", async () => {
      const mockStore = createMockStore();
      const storage = createMessageBufferStorage(mockStore);

      // Save initial buffer
      const buffer: MessageBuffer = {
        messages: [createSerializedMessage("human", "Original message")],
        humanMessageCount: 1,
        lastMessageTimestamp: Date.now(),
        createdAt: Date.now(),
      };
      await storage.saveBuffer("test-user", buffer);

      // Stage the buffer
      const result = await storage.stageBuffer("test-user", buffer);
      expect(result).toBe(true);

      // Verify staging buffer was created with same content
      const stagingBuffer = await storage.loadStagingBuffer("test-user");
      expect(stagingBuffer).not.toBeNull();
      expect(stagingBuffer?.messages).toHaveLength(1);
      expect(stagingBuffer?.messages[0].data.content).toBe("Original message");
    });

    test("loadStagingBuffer returns null when no staging exists", async () => {
      const mockStore = createMockStore();
      const storage = createMessageBufferStorage(mockStore);

      const stagingBuffer = await storage.loadStagingBuffer("test-user");
      expect(stagingBuffer).toBeNull();
    });

    test("clearStaging removes only staging area", async () => {
      const mockStore = createMockStore();
      const storage = createMessageBufferStorage(mockStore);

      // Save both main buffer and staging
      const buffer: MessageBuffer = {
        messages: [createSerializedMessage("human", "Main buffer")],
        humanMessageCount: 1,
        lastMessageTimestamp: Date.now(),
        createdAt: Date.now(),
      };

      await storage.saveBuffer("test-user", buffer);
      await storage.stageBuffer("test-user", buffer);

      // Clear staging
      const result = await storage.clearStaging("test-user");
      expect(result).toBe(true);

      // Verify staging is gone
      const stagingBuffer = await storage.loadStagingBuffer("test-user");
      expect(stagingBuffer).toBeNull();

      // Verify main buffer still exists
      const mainBuffer = await storage.loadBuffer("test-user");
      expect(mainBuffer.messages).toHaveLength(1);
      expect(mainBuffer.messages[0].data.content).toBe("Main buffer");
    });

    test("staging pattern prevents message loss during async operations", async () => {
      const mockStore = createMockStore();
      const storage = createMessageBufferStorage(mockStore);

      // Initial buffer
      const initialBuffer: MessageBuffer = {
        messages: [createSerializedMessage("human", "Message 1")],
        humanMessageCount: 1,
        lastMessageTimestamp: Date.now(),
        createdAt: Date.now(),
      };
      await storage.saveBuffer("test-user", initialBuffer);

      // Stage the buffer (simulating start of async reflection)
      await storage.stageBuffer("test-user", initialBuffer);

      // Simulate new message arriving during async operation
      const updatedBuffer: MessageBuffer = {
        messages: [
          createSerializedMessage("human", "Message 1"),
          createSerializedMessage("human", "Message 2 (arrived during async)"),
        ],
        humanMessageCount: 2,
        lastMessageTimestamp: Date.now(),
        createdAt: Date.now(),
      };
      await storage.saveBuffer("test-user", updatedBuffer);

      // Verify live buffer has new message
      const liveBuffer = await storage.loadBuffer("test-user");
      expect(liveBuffer.messages).toHaveLength(2);

      // Verify staging buffer still has original content
      const stagingBuffer = await storage.loadStagingBuffer("test-user");
      expect(stagingBuffer?.messages).toHaveLength(1);
      expect(stagingBuffer?.messages[0].data.content).toBe("Message 1");

      // Clear staging (simulating end of async reflection)
      await storage.clearStaging("test-user");

      // Verify new message is still in live buffer
      const finalLiveBuffer = await storage.loadBuffer("test-user");
      expect(finalLiveBuffer.messages).toHaveLength(2);
      expect(finalLiveBuffer.messages[1].data.content).toBe(
        "Message 2 (arrived during async)"
      );
    });
  });

  describe("Namespace Isolation", () => {
    test("custom namespace prefixes storage keys correctly", async () => {
      const mockStore = createMockStore();
      const storage = createMessageBufferStorage(mockStore, [
        "custom",
        "namespace",
      ]);

      const buffer: MessageBuffer = {
        messages: [createSerializedMessage("human", "Test")],
        humanMessageCount: 1,
        lastMessageTimestamp: Date.now(),
        createdAt: Date.now(),
      };

      await storage.saveBuffer("test-user", buffer);

      // Verify buffer was saved with custom namespace
      const loadedBuffer = await storage.loadBuffer("test-user");
      expect(loadedBuffer.messages).toHaveLength(1);
    });

    test("staging uses same custom namespace", async () => {
      const mockStore = createMockStore();
      const storage = createMessageBufferStorage(mockStore, [
        "custom",
        "namespace",
      ]);

      const buffer: MessageBuffer = {
        messages: [createSerializedMessage("human", "Test")],
        humanMessageCount: 1,
        lastMessageTimestamp: Date.now(),
        createdAt: Date.now(),
      };

      await storage.saveBuffer("test-user", buffer);
      await storage.stageBuffer("test-user", buffer);

      // Verify staging buffer exists
      const stagingBuffer = await storage.loadStagingBuffer("test-user");
      expect(stagingBuffer).not.toBeNull();
      expect(stagingBuffer?.messages).toHaveLength(1);
    });

    test("different namespaces create isolated storage", async () => {
      const mockStore = createMockStore();
      const storage1 = createMessageBufferStorage(mockStore, ["namespace-a"]);
      const storage2 = createMessageBufferStorage(mockStore, ["namespace-b"]);

      const buffer1: MessageBuffer = {
        messages: [createSerializedMessage("human", "A")],
        humanMessageCount: 1,
        lastMessageTimestamp: Date.now(),
        createdAt: Date.now(),
      };

      const buffer2: MessageBuffer = {
        messages: [createSerializedMessage("human", "B")],
        humanMessageCount: 1,
        lastMessageTimestamp: Date.now(),
        createdAt: Date.now(),
      };

      await storage1.saveBuffer("user-1", buffer1);
      await storage2.saveBuffer("user-1", buffer2);

      // Verify isolation
      const loaded1 = await storage1.loadBuffer("user-1");
      const loaded2 = await storage2.loadBuffer("user-1");

      expect(loaded1.messages[0].data.content).toBe("A");
      expect(loaded2.messages[0].data.content).toBe("B");
    });
  });

  describe("Error Handling", () => {
    test("loadBuffer handles store errors gracefully", async () => {
      const mockStore: BaseStore = {
        get: async () => {
          return await Promise.reject(new Error("Store error"));
        },
        put: async () => {
          return await Promise.resolve();
        },
        delete: async () => {
          return await Promise.resolve();
        },
        batch: async () => {
          return await Promise.resolve([]);
        },
        search: async () => {
          return await Promise.resolve([]);
        },
        listNamespaces: async () => {
          return await Promise.resolve([]);
        },
      };

      const storage = createMessageBufferStorage(mockStore);
      const buffer = await storage.loadBuffer("test-user");

      expect(buffer.messages).toHaveLength(0);
      expect(buffer.humanMessageCount).toBe(0);
    });

    test("saveBuffer handles validation errors gracefully", async () => {
      const mockStore = createMockStore();
      const storage = createMessageBufferStorage(mockStore);

      // Invalid buffer (missing required fields)
      const invalidBuffer = {
        messages: "not-an-array",
        humanMessageCount: "not-a-number",
      } as unknown as MessageBuffer;

      const result = await storage.saveBuffer("test-user", invalidBuffer);
      expect(result).toBe(false);
    });
  });
});
