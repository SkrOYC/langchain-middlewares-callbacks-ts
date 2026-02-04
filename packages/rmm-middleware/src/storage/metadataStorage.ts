import type { BaseStore } from "@langchain/langgraph-checkpoint";
import {
  type SessionMetadata,
  SessionMetadataSchema,
} from "../schemas/index.ts";

/**
 * MetadataStorage interface for persisting session metadata to BaseStore
 */
export interface MetadataStorage {
  /**
   * Load session metadata for a user from BaseStore
   * @param userId - The user identifier
   * @returns SessionMetadata or null if not found/invalid
   */
  loadMetadata(userId: string): Promise<SessionMetadata | null>;

  /**
   * Save session metadata for a user to BaseStore
   * @param userId - The user identifier
   * @param metadata - The session metadata to persist
   * @returns true on success, false on failure
   */
  saveMetadata(userId: string, metadata: SessionMetadata): Promise<boolean>;
}

/**
 * Creates a MetadataStorage adapter for the given BaseStore instance
 * @param store - BaseStore instance from @langchain/langgraph-checkpoint
 * @returns MetadataStorage implementation
 */
export function createMetadataStorage(store: BaseStore): MetadataStorage {
  const NAMESPACE_KEY = "session" as const;

  const buildNamespace = (userId: string): string[] => [
    "rmm",
    userId,
    "metadata",
  ];

  return {
    async loadMetadata(userId: string): Promise<SessionMetadata | null> {
      try {
        const namespace = buildNamespace(userId);
        const item = await store.get(namespace, NAMESPACE_KEY);

        if (item === null || item === undefined) {
          return null;
        }

        // Validate the data against schema
        const parseResult = SessionMetadataSchema.safeParse(item.value);

        if (!parseResult.success) {
          return null;
        }

        return parseResult.data;
      } catch {
        // Graceful degradation: return null on any error
        return null;
      }
    },

    async saveMetadata(
      userId: string,
      metadata: SessionMetadata
    ): Promise<boolean> {
      try {
        const namespace = buildNamespace(userId);

        // Validate metadata before saving
        const validationResult = SessionMetadataSchema.safeParse(metadata);
        if (!validationResult.success) {
          return false;
        }

        await store.put(namespace, NAMESPACE_KEY, validationResult.data);
        return true;
      } catch {
        // Graceful degradation: return false on any error
        return false;
      }
    },
  };
}
