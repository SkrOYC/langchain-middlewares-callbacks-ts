import { describe, expect, test } from "bun:test";

import {
  buildBaseStoreKey,
  FILESYSTEM_UNRESPONSIVE_MESSAGE,
  FileNotFoundError,
  FilesystemUnresponsiveError,
  VirtualStoreAdapter,
} from "@/infrastructure/virtual-store";

interface MemoryStore {
  data: Map<string, string>;
  mget: (keys: string[]) => Promise<(string | undefined)[]>;
  mset: (pairs: [string, string][]) => Promise<void>;
  mdelete: (keys: string[]) => Promise<void>;
  yieldKeys: (prefix?: string) => AsyncGenerator<string, void, unknown>;
}

function createMemoryStore(): MemoryStore {
  const data = new Map<string, string>();

  return {
    data,
    mget(keys: string[]) {
      return Promise.resolve(keys.map((key) => data.get(key)));
    },
    mset(pairs: [string, string][]) {
      for (const [key, value] of pairs) {
        data.set(key, value);
      }

      return Promise.resolve();
    },
    mdelete(keys: string[]) {
      for (const key of keys) {
        data.delete(key);
      }

      return Promise.resolve();
    },
    async *yieldKeys(prefix?: string) {
      await Promise.resolve();

      for (const key of data.keys()) {
        if (prefix === undefined || key.startsWith(prefix)) {
          yield key;
        }
      }
    },
  };
}

describe("VirtualStoreAdapter", () => {
  test("persists and retrieves data by namespace tuple + key", async () => {
    const store = createMemoryStore();
    const adapter = new VirtualStoreAdapter(store, ["workspaces", "agent-1"]);

    await adapter.write("docs/readme.md", "hello");

    const content = await adapter.read("docs/readme.md");

    expect(content).toBe("hello");
  });

  test("throws FileNotFoundError when key is missing", async () => {
    const store = createMemoryStore();
    const adapter = new VirtualStoreAdapter(store, ["workspaces", "agent-1"]);

    await expect(adapter.read("missing.txt")).rejects.toBeInstanceOf(
      FileNotFoundError
    );
  });

  test("lists only direct children that match namespace + prefix", async () => {
    const store = createMemoryStore();
    const namespaceA = ["workspaces", "agent-a"];
    const namespaceB = ["workspaces", "agent-b"];

    store.data.set(buildBaseStoreKey(namespaceA, "docs/a.md"), "A");
    store.data.set(buildBaseStoreKey(namespaceA, "docs/b.md"), "B");
    store.data.set(buildBaseStoreKey(namespaceA, "docs/nested/c.md"), "C");
    store.data.set(buildBaseStoreKey(namespaceA, "src/main.ts"), "D");
    store.data.set(buildBaseStoreKey(namespaceB, "docs/foreign.md"), "E");

    const adapter = new VirtualStoreAdapter(store, namespaceA);
    const listed = await adapter.list("docs");

    expect(listed).toEqual(["docs/a.md", "docs/b.md", "docs/nested"]);
  });

  test("edits existing files and reports replacement count", async () => {
    const store = createMemoryStore();
    const adapter = new VirtualStoreAdapter(store, ["workspaces", "agent-1"]);

    await adapter.write("file.txt", "alpha beta alpha");

    const count = await adapter.edit("file.txt", "alpha", "ALPHA");
    const content = await adapter.read("file.txt");

    expect(count).toBe(1);
    expect(content).toBe("ALPHA beta alpha");
  });

  test("times out list operations for unresponsive stores", async () => {
    let iteratorClosed = false;

    const delayedStore = {
      mget() {
        return Promise.resolve([undefined]);
      },
      mset() {
        return Promise.resolve();
      },
      mdelete() {
        return Promise.resolve();
      },
      async *yieldKeys() {
        try {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
          yield "ignored";
        } finally {
          iteratorClosed = true;
        }
      },
    };

    const adapter = new VirtualStoreAdapter(
      delayedStore,
      ["workspaces", "agent-1"],
      {
        timeoutMs: 5,
      }
    );

    await expect(adapter.list("docs")).rejects.toBeInstanceOf(
      FilesystemUnresponsiveError
    );
    await expect(adapter.list("docs")).rejects.toThrow(
      FILESYSTEM_UNRESPONSIVE_MESSAGE
    );

    expect(iteratorClosed).toBe(true);
  });
});
