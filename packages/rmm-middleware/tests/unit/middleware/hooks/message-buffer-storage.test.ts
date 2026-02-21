import { describe, expect, test } from "bun:test";
import type { MessageBuffer } from "@/schemas";
import { createMessageBufferStorage } from "@/storage/message-buffer-storage";
import { createMockBaseStore } from "@/tests/fixtures/mock-base-store";
import { createSerializedMessage } from "@/tests/helpers/messages";

function createBuffer(text: string): MessageBuffer {
  const now = Date.now();
  return {
    messages: [createSerializedMessage("human", text)],
    humanMessageCount: 1,
    lastMessageTimestamp: now,
    createdAt: now,
  };
}

describe("message buffer storage", () => {
  test("loadBuffer returns empty buffer when not found", async () => {
    const storage = createMessageBufferStorage(createMockBaseStore());
    const buffer = await storage.loadBuffer("u1");

    expect(buffer.messages).toHaveLength(0);
    expect(buffer.humanMessageCount).toBe(0);
  });

  test("saveBuffer and loadBuffer round-trip", async () => {
    const storage = createMessageBufferStorage(createMockBaseStore());

    const ok = await storage.saveBuffer("u1", createBuffer("hello"));
    expect(ok).toBe(true);

    const loaded = await storage.loadBuffer("u1");
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0]?.data.content).toBe("hello");
  });

  test("loadBufferItem exposes store timestamps", async () => {
    const storage = createMessageBufferStorage(createMockBaseStore());

    await storage.saveBuffer("u1", createBuffer("hello"));
    const item = await storage.loadBufferItem("u1");

    expect(item).not.toBeNull();
    if (!item) {
      return;
    }
    expect(item.createdAt).toBeInstanceOf(Date);
    expect(item.updatedAt).toBeInstanceOf(Date);
  });

  test("stageBuffer and clearStaging lifecycle", async () => {
    const storage = createMessageBufferStorage(createMockBaseStore());

    const staged = await storage.stageBuffer("u1", createBuffer("staged"));
    expect(staged).toBe(true);

    const beforeClear = await storage.loadStagingBuffer("u1");
    expect(beforeClear?.messages[0]?.data.content).toBe("staged");

    const cleared = await storage.clearStaging("u1");
    expect(cleared).toBe(true);

    const afterClear = await storage.loadStagingBuffer("u1");
    expect(afterClear).toBeNull();
  });

  test("clearBuffer resets main buffer", async () => {
    const storage = createMessageBufferStorage(createMockBaseStore());

    await storage.saveBuffer("u1", createBuffer("hello"));
    const ok = await storage.clearBuffer("u1");
    expect(ok).toBe(true);

    const loaded = await storage.loadBuffer("u1");
    expect(loaded.messages).toHaveLength(0);
    expect(loaded.humanMessageCount).toBe(0);
  });

  test("custom namespaces remain isolated", async () => {
    const store = createMockBaseStore();
    const storageA = createMessageBufferStorage(store, ["a"]);
    const storageB = createMessageBufferStorage(store, ["b"]);

    await storageA.saveBuffer("u1", createBuffer("A"));
    await storageB.saveBuffer("u1", createBuffer("B"));

    const loadedA = await storageA.loadBuffer("u1");
    const loadedB = await storageB.loadBuffer("u1");

    expect(loadedA.messages[0]?.data.content).toBe("A");
    expect(loadedB.messages[0]?.data.content).toBe("B");
  });

  test("saveBuffer returns false for invalid payload", async () => {
    const storage = createMessageBufferStorage(createMockBaseStore());

    const bad = { messages: "not-array" } as unknown as MessageBuffer;
    const ok = await storage.saveBuffer("u1", bad);

    expect(ok).toBe(false);
  });
});
