import type { BaseStore } from "@langchain/langgraph-checkpoint";
import {
  createEmptyMessageBuffer,
  type MessageBuffer,
  MessageBufferSchema,
} from "@/schemas/index";

/**
 * Interface for message buffer storage operations.
 * Persists message buffers to BaseStore for cross-thread continuity.
 */
export interface MessageBufferStorage {
  /**
   * Load message buffer for a user from BaseStore.
   * Returns empty buffer if none exists or on error.
   * @param userId - The user identifier
   * @returns MessageBuffer or empty buffer
   */
  loadBuffer(userId: string): Promise<MessageBuffer>;

  /**
   * Save message buffer for a user to BaseStore.
   * @param userId - The user identifier
   * @param buffer - The message buffer to persist
   * @returns true on success, false on failure
   */
  saveBuffer(userId: string, buffer: MessageBuffer): Promise<boolean>;

  /**
   * Clear message buffer for a user.
   * @param userId - The user identifier
   * @returns true on success, false on failure
   */
  clearBuffer(userId: string): Promise<boolean>;
}

/**
 * Creates a MessageBufferStorage adapter for the given BaseStore instance.
 * @param store - BaseStore instance from @langchain/langgraph-checkpoint
 * @returns MessageBufferStorage implementation
 */
export function createMessageBufferStorage(
  store: BaseStore
): MessageBufferStorage {
  const NAMESPACE_KEY = "message-buffer" as const;

  const buildNamespace = (userId: string): string[] => [
    "rmm",
    userId,
    "buffer",
  ];

  return {
    async loadBuffer(userId: string): Promise<MessageBuffer> {
      try {
        const namespace = buildNamespace(userId);
        const item = await store.get(namespace, NAMESPACE_KEY);

        if (item === null || item === undefined) {
          return createEmptyMessageBuffer();
        }

        const parseResult = MessageBufferSchema.safeParse(item.value);

        if (!parseResult.success) {
          return createEmptyMessageBuffer();
        }

        return parseResult.data;
      } catch (error) {
        console.warn(
          "[message-buffer-storage] Error loading buffer, returning empty:",
          error instanceof Error ? error.message : String(error)
        );
        return createEmptyMessageBuffer();
      }
    },

    async saveBuffer(userId: string, buffer: MessageBuffer): Promise<boolean> {
      try {
        const namespace = buildNamespace(userId);

        const validationResult = MessageBufferSchema.safeParse(buffer);
        if (!validationResult.success) {
          console.warn(
            "[message-buffer-storage] Buffer validation failed:",
            validationResult.error
          );
          return false;
        }

        await store.put(namespace, NAMESPACE_KEY, validationResult.data);
        return true;
      } catch (error) {
        console.warn(
          "[message-buffer-storage] Error saving buffer:",
          error instanceof Error ? error.message : String(error)
        );
        return false;
      }
    },

    async clearBuffer(userId: string): Promise<boolean> {
      try {
        const namespace = buildNamespace(userId);
        await store.put(namespace, NAMESPACE_KEY, createEmptyMessageBuffer());
        return true;
      } catch (error) {
        console.warn(
          "[message-buffer-storage] Error clearing buffer:",
          error instanceof Error ? error.message : String(error)
        );
        return false;
      }
    },
  };
}
