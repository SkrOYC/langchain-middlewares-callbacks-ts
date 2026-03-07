/**
 * In-Memory Previous Response Store
 *
 * Development-only in-memory implementation of PreviousResponseStore.
 * NOT for production use - use a proper database adapter.
 */

import type { PreviousResponseStore, StoredResponseRecord } from "../core/types.js";

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
		async load(
			responseId: string,
			_signal?: AbortSignal
		): Promise<StoredResponseRecord | null> {
			return store.get(responseId) ?? null;
		},

		async save(
			record: StoredResponseRecord,
			_signal?: AbortSignal
		): Promise<void> {
			store.set(record.response_id, record);
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
 * Creates a pre-populated in-memory store for testing.
 */
export function createPopulatedInMemoryStore(
	records: StoredResponseRecord[]
): InMemoryPreviousResponseStore {
	const store = createInMemoryPreviousResponseStore();
	for (const record of records) {
		store.save(record);
	}
	return store;
}
