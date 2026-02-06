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

import type { BaseMessage } from "@langchain/core/messages";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import {
  createEmptyMessageBuffer,
  DEFAULT_REFLECTION_CONFIG,
  type MessageBuffer,
  type ReflectionConfig,
} from "@/schemas";
import { createMessageBufferStorage } from "@/storage/message-buffer-storage";
import { countHumanMessages, isHumanMessage } from "@/utils/message-helpers";

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
  extractSpeaker1?: (dialogueSession: string) => string;
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
 * Appends current session messages to the buffer.
 * Returns updated buffer with new messages and counts.
 */
function appendMessagesToBuffer(
  buffer: MessageBuffer,
  messages: BaseMessage[],
  now: number
): MessageBuffer {
  const newMessages = [...buffer.messages, ...messages];
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

    const { userId, store, reflectionConfig } = deps ?? {};
    const config = reflectionConfig ?? DEFAULT_REFLECTION_CONFIG;
    const now = Date.now();

    // If no store or userId, we can't persist - just return
    if (!userId || !store) {
      return {};
    }

    // Load existing buffer or create new one
    const bufferStorage = createMessageBufferStorage(store);
    let buffer = await bufferStorage.loadBuffer(userId);

    // Append new messages to buffer
    buffer = appendMessagesToBuffer(buffer, state.messages, now);

    // Enforce max buffer size (trim oldest messages)
    if (buffer.messages.length > config.maxBufferSize) {
      const excess = buffer.messages.length - config.maxBufferSize;
      buffer.messages = buffer.messages.slice(excess);
      buffer.humanMessageCount = countHumanMessages(buffer.messages);
    }

    // Persist buffer (BaseStore will update updated_at automatically)
    await bufferStorage.saveBuffer(userId, buffer);

    return {};
  } catch (error) {
    console.warn(
      "[after-agent] Error during message buffering, continuing:",
      error instanceof Error ? error.message : String(error)
    );
    return {};
  }
}
