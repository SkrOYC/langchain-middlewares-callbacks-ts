import type { StoredMessage } from "@langchain/core/messages";

/**
 * Checks if a message is a human message.
 * Uses LangChain's StoredMessage format with type property and data.role.
 * @param message - The message to check
 * @returns true if the message is from a human user
 */
export function isHumanMessage(message: StoredMessage): boolean {
  // Check for simple type property first
  if (message.type === "human") {
    return true;
  }

  // Check data.role for nested format
  if (message.data?.role === "human") {
    return true;
  }

  return false;
}

/**
 * Counts human messages in a StoredMessage[] array.
 * Uses for-loop to avoid array allocation from filter.
 * @param messages - Array of StoredMessage objects
 * @returns Count of human messages
 */
export function countHumanMessages(messages: StoredMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (isHumanMessage(message)) {
      count++;
    }
  }
  return count;
}

/**
 * Gets the last human message from a StoredMessage[] array.
 * @param messages - Array of StoredMessage objects
 * @returns The last human message or undefined
 */
export function getLastHumanMessage(
  messages: StoredMessage[]
): StoredMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message && isHumanMessage(message)) {
      return message;
    }
  }
  return undefined;
}
