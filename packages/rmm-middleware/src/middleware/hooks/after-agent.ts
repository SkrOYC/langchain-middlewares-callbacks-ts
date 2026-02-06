/**
 * afterAgent hook for Prospective Reflection - Append Only
 *
 * Responsibilities:
 * 1. Append new messages to the existing buffer
 * 2. Update humanMessageCount
 * 3. Persist buffer to BaseStore (which updates updated_at)
 *
 * Note: Trigger logic has been moved to beforeAgent hook to avoid contamination
 * from the current execution. This ensures triggers are checked using the buffer's
 * original state before any new messages are appended.
 */

import type { BaseMessage, StoredMessage } from "@langchain/core/messages";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { MessageBuffer, ReflectionConfig } from "@/schemas";
import { createMessageBufferStorage } from "@/storage/message-buffer-storage";
import { getLogger } from "@/utils/logger";
import { countHumanMessages } from "@/utils/message-helpers";

const logger = getLogger("after-agent");

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Interface for the afterAgent runtime context
 */
interface AfterAgentRuntimeContext {
  [key: string]: unknown;
}

/**
 * Interface for the afterAgent dependencies (injected for testing)
 */
interface AfterAgentDependencies {
  userId?: string;
  store?: BaseStore;
  reflectionConfig?: ReflectionConfig;
}

/**
 * State interface for the afterAgent hook
 */
interface AfterAgentState {
  messages: BaseMessage[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Converts a message to StoredMessage format.
 * Handles both BaseMessage instances and plain objects (already serialized).
 */
function toStoredMessage(message: BaseMessage | StoredMessage): StoredMessage {
  // If it's a BaseMessage with toDict method, use it
  if (
    typeof message === "object" &&
    message !== null &&
    "toDict" in message &&
    typeof message.toDict === "function"
  ) {
    return message.toDict() as StoredMessage;
  }

  // Otherwise, assume it's already in StoredMessage format
  return message as StoredMessage;
}

/**
 * Appends current session messages to the buffer.
 * Returns updated buffer with new messages and counts.
 *
 * @param buffer - Existing message buffer with StoredMessage[]
 * @param messages - New messages from agent state (BaseMessage[])
 * @param now - Current timestamp
 * @returns Updated MessageBuffer with StoredMessage[]
 */
function appendMessagesToBuffer(
  buffer: MessageBuffer,
  messages: BaseMessage[],
  now: number
): MessageBuffer {
  // Convert BaseMessage[] to StoredMessage[] and append
  const newMessages: StoredMessage[] = [
    ...buffer.messages,
    ...messages.map(toStoredMessage),
  ];
  const newHumanCount = countHumanMessages(newMessages);

  return {
    messages: newMessages,
    humanMessageCount: newHumanCount,
    lastMessageTimestamp: now,
    createdAt: buffer.createdAt,
  };
}

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Prospective Reflection: afterAgent hook implementation (Append Only)
 *
 * This hook appends new messages to the persisted buffer:
 * 1. Load persisted message buffer from BaseStore (user-scoped)
 * 2. Append current session messages to buffer
 * 3. Save updated buffer to BaseStore (which updates updated_at timestamp)
 *
 * Note: Trigger logic is handled in beforeAgent to avoid contamination.
 *
 * @param state - The current agent state containing messages
 * @param _runtime - The runtime context (unused in append-only mode)
 * @param deps - Optional dependencies (store, userId for persistence)
 * @returns Empty object (no state changes)
 */
export async function afterAgent(
  state: AfterAgentState,
  _runtime: { context: AfterAgentRuntimeContext },
  deps?: AfterAgentDependencies
): Promise<Record<string, unknown>> {
  try {
    // Skip if no messages
    if (!state.messages || state.messages.length === 0) {
      return {};
    }

    const { userId, store } = deps ?? {};
    const now = Date.now();

    // If no store or userId, we can't persist - just return
    if (!(userId && store)) {
      return {};
    }

    // Load existing buffer or create new one
    const bufferStorage = createMessageBufferStorage(store);
    let buffer = await bufferStorage.loadBuffer(userId);

    // Append new messages to buffer
    buffer = appendMessagesToBuffer(buffer, state.messages, now);

    // Persist buffer (BaseStore will update updated_at automatically)
    await bufferStorage.saveBuffer(userId, buffer);

    return {};
  } catch (error) {
    logger.warn(
      "Error during message buffering, continuing:",
      error instanceof Error ? error.message : String(error)
    );
    return {};
  }
}
