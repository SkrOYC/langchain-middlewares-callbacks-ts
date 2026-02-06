import type { BaseStore, Item } from "@langchain/langgraph-checkpoint";
import {
  createEmptyMessageBuffer,
  type MessageBuffer,
  MessageBufferSchema,
  serializeMessages,
  deserializeMessages,
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
   * Load the full Item (including BaseStore's updated_at) for trigger checks.
   * @param userId - The user identifier
   * @returns Item with buffer value, or null if not found
   */
  loadBufferItem(userId: string): Promise<Item | null>;

  /**
   * Load staging buffer for a user from BaseStore.
   * Used during async reflection to work on a snapshot.
   * @param userId - The user identifier
   * @returns MessageBuffer or null if not found
   */
  loadStagingBuffer(userId: string): Promise<MessageBuffer | null>;

  /**
   * Save message buffer for a user to BaseStore.
   * @param userId - The user identifier
   * @param buffer - The message buffer to persist
   * @returns true on success, false on failure
   */
  saveBuffer(userId: string, buffer: MessageBuffer): Promise<boolean>;

  /**
   * Stage current buffer for async processing.
   * Creates a snapshot of the buffer for reflection.
   * @param userId - The user identifier
   * @param buffer - The buffer to stage
   * @returns true on success, false on failure
   */
  stageBuffer(userId: string, buffer: MessageBuffer): Promise<boolean>;

  /**
   * Clear staging buffer after reflection completes.
   * @param userId - The user identifier
   * @returns true on success, false on failure
   */
  clearStaging(userId: string): Promise<boolean>;

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
 * @param customNamespace - Optional custom namespace prefix for isolation
 * @returns MessageBufferStorage implementation
 */
export function createMessageBufferStorage(
  store: BaseStore,
  customNamespace?: string[]
): MessageBufferStorage {
  const NAMESPACE_KEY = "message-buffer" as const;
  const STAGING_KEY = "staging" as const;

  const buildNamespace = (
    userId: string,
    type: "main" | "staging" = "main"
  ): string[] => {
    const baseNamespace = customNamespace ?? ["rmm", userId, "buffer"];

    if (type === "staging") {
      return [...baseNamespace, STAGING_KEY];
    }

    return baseNamespace;
  };

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

        // Deserialize messages back to BaseMessage instances
        const messages = deserializeMessages(parseResult.data.messages);
        return {
          ...parseResult.data,
          messages,
        };
      } catch (error) {
        console.warn(
          "[message-buffer-storage] Error loading buffer, returning empty:",
          error instanceof Error ? error.message : String(error)
        );
        return createEmptyMessageBuffer();
      }
    },

    async loadBufferItem(userId: string): Promise<Item | null> {
      try {
        const namespace = buildNamespace(userId, "main");
        return await store.get(namespace, NAMESPACE_KEY);
      } catch (error) {
        console.warn(
          "[message-buffer-storage] Error loading buffer item, returning null:",
          error instanceof Error ? error.message : String(error)
        );
        return null;
      }
    },

    async loadStagingBuffer(userId: string): Promise<MessageBuffer | null> {
      try {
        const namespace = buildNamespace(userId, "staging");
        const item = await store.get(namespace, NAMESPACE_KEY);

        if (item === null || item === undefined) {
          return null;
        }

        const parseResult = MessageBufferSchema.safeParse(item.value);

        if (!parseResult.success) {
          return null;
        }

        // Return null if buffer is empty (already cleared)
        if (parseResult.data.messages.length === 0) {
          return null;
        }

        // Deserialize messages back to BaseMessage instances
        const messages = deserializeMessages(parseResult.data.messages);
        return {
          ...parseResult.data,
          messages,
        };
      } catch (error) {
        console.warn(
          "[message-buffer-storage] Error loading staging buffer, returning null:",
          error instanceof Error ? error.message : String(error)
        );
        return null;
      }
    },

    async saveBuffer(userId: string, buffer: MessageBuffer): Promise<boolean> {
      try {
        const namespace = buildNamespace(userId, "main");

        // Validate and serialize messages for storage
        const serializedMessages = serializeMessages(buffer.messages);
        const dataToSave = {
          ...buffer,
          messages: serializedMessages,
        };

        const validationResult = MessageBufferSchema.safeParse(dataToSave);
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

    async stageBuffer(userId: string, buffer: MessageBuffer): Promise<boolean> {
      try {
        const namespace = buildNamespace(userId, "staging");

        // Validate and serialize messages for storage
        const serializedMessages = serializeMessages(buffer.messages);
        const dataToSave = {
          ...buffer,
          messages: serializedMessages,
        };

        const validationResult = MessageBufferSchema.safeParse(dataToSave);
        if (!validationResult.success) {
          console.warn(
            "[message-buffer-storage] Staging buffer validation failed:",
            validationResult.error
          );
          return false;
        }

        await store.put(namespace, NAMESPACE_KEY, validationResult.data);
        return true;
      } catch (error) {
        console.warn(
          "[message-buffer-storage] Error staging buffer:",
          error instanceof Error ? error.message : String(error)
        );
        return false;
      }
    },

    async clearStaging(userId: string): Promise<boolean> {
      try {
        const namespace = buildNamespace(userId, "staging");
        await store.put(namespace, NAMESPACE_KEY, createEmptyMessageBuffer());
        return true;
      } catch (error) {
        console.warn(
          "[message-buffer-storage] Error clearing staging:",
          error instanceof Error ? error.message : String(error)
        );
        return false;
      }
    },

    async clearBuffer(userId: string): Promise<boolean> {
      try {
        const namespace = buildNamespace(userId, "main");
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
