import type { BaseStore, Item } from "@langchain/langgraph-checkpoint";

/**
 * Mock implementation of BaseStore for testing storage adapters
 * Uses an in-memory Map to simulate storage operations
 */
export function createMockBaseStore(): BaseStore {
  const storage = new Map<string, Item>();

  const buildPath = (namespace: string[], key: string): string =>
    [...namespace, key].join(":");

  return {
    async get(namespace: string[], key: string): Promise<Item | null> {
      const path = buildPath(namespace, key);
      const item = storage.get(path);
      return await Promise.resolve(item ?? null);
    },

    async put(
      namespace: string[],
      key: string,
      value: Record<string, unknown>
    ): Promise<void> {
      const path = buildPath(namespace, key);
      const now = new Date();

      // Check if item exists to preserve createdAt
      const existing = storage.get(path);
      const createdAt = existing?.createdAt ?? now;

      const item: Item = {
        value,
        key,
        namespace,
        createdAt,
        updatedAt: now,
      };

      storage.set(path, item);
      return await Promise.resolve();
    },

    async delete(namespace: string[], key: string): Promise<void> {
      const path = buildPath(namespace, key);
      storage.delete(path);
      return await Promise.resolve();
    },

    async batch(): Promise<never> {
      return await Promise.reject(new Error("batch not implemented in mock"));
    },

    async search(): Promise<never> {
      return await Promise.reject(new Error("search not implemented in mock"));
    },

    async listNamespaces(): Promise<never> {
      return await Promise.reject(new Error("listNamespaces not implemented in mock"));
    },
  };
}

/**
 * Creates a mock BaseStore that simulates failures for error testing
 */
export function createFailingMockBaseStore(
  failOperation: "get" | "put" | "delete" | "all" = "all"
): BaseStore {
  const error = new Error(`Simulated ${failOperation} failure`);

  return {
    async get(): Promise<never> {
      if (failOperation === "get" || failOperation === "all") {
        return await Promise.reject(error);
      }
      return await Promise.reject(new Error("Unexpected success in failing mock"));
    },

    async put(): Promise<never> {
      if (failOperation === "put" || failOperation === "all") {
        return await Promise.reject(error);
      }
      return await Promise.reject(new Error("Unexpected success in failing mock"));
    },

    async delete(): Promise<never> {
      if (failOperation === "delete" || failOperation === "all") {
        return await Promise.reject(error);
      }
      return await Promise.reject(new Error("Unexpected success in failing mock"));
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
