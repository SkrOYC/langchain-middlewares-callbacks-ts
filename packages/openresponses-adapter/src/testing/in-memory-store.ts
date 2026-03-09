/**
 * In-Memory Previous Response Store
 *
 * Development-only in-memory implementation of PreviousResponseStore.
 * NOT for production use - use a proper database adapter.
 */

import type {
  PreviousResponseStore,
  StoredResponseRecord,
} from "../core/types.js";
import {
  parseStoredResponseRecord,
  synchronizeStoredResponseRecord,
} from "../server/previous-response.js";

/**
 * In-memory store with additional testing utilities.
 */
export interface InMemoryPreviousResponseStore extends PreviousResponseStore {
  __getStore(): Map<string, StoredResponseRecord>;
  __clear(): void;
  __size(): number;
  __has(responseId: string): boolean;
  __delete(responseId: string): boolean;
}

/**
 * Creates an in-memory store for previous responses.
 *
 * @returns In-memory implementation of PreviousResponseStore
 */
export function createInMemoryPreviousResponseStore(): InMemoryPreviousResponseStore {
  const store = new Map<string, StoredResponseRecord>();

  const instance: InMemoryPreviousResponseStore = {
    load(
      responseId: string,
      _signal?: AbortSignal
    ): Promise<StoredResponseRecord | null> {
      const record = store.get(responseId);

      if (record === undefined) {
        return Promise.resolve(null);
      }

      return Promise.resolve(parseStoredResponseRecord(record, responseId));
    },

    save(record: StoredResponseRecord, _signal?: AbortSignal): Promise<void> {
      const synchronizedRecord = synchronizeStoredResponseRecord(record);
      store.set(synchronizedRecord.response_id, synchronizedRecord);
      return Promise.resolve();
    },

    // Testing utilities
    __getStore: () => store,
    __clear: () => store.clear(),
    __size: () => store.size,
    __has: (responseId: string) => store.has(responseId),
    __delete: (responseId: string) => store.delete(responseId),
  };

  return instance;
}

/**
 * Creates a pre-populated in-memory store for testing.
 */
export function createPopulatedInMemoryStore(
  records: StoredResponseRecord[]
): InMemoryPreviousResponseStore {
  const store = createInMemoryPreviousResponseStore();
  const backingStore = store.__getStore();

  for (const record of records) {
    const synchronizedRecord = synchronizeStoredResponseRecord(record);
    backingStore.set(synchronizedRecord.response_id, synchronizedRecord);
  }

  return store;
}
