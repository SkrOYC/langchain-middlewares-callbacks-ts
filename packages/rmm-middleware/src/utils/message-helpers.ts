import type { BaseMessage } from "@langchain/core/messages";

/**
 * Checks if a message is a human message.
 * Handles multiple message formats for compatibility:
 * - Simple objects with `type` property
 * - LangChain internal format with `lc_id` array
 * - LangChain serialized format with `lc_serialized.type`
 * @param message - The message to check
 * @returns true if the message is from a human user
 */
export function isHumanMessage(
  message: BaseMessage | Record<string, unknown>
): boolean {
  // Check for simple type property first
  if (message.type === "human") {
    return true;
  }

  // Check for LangChain internal format (lc_id: ["human"])
  if (Array.isArray(message.lc_id) && message.lc_id[0] === "human") {
    return true;
  }

  // Check for LangChain serialized format (lc_serialized: { type: "human" })
  if (
    message.lc_serialized &&
    typeof message.lc_serialized === "object" &&
    message.lc_serialized !== null
  ) {
    const serialized = message.lc_serialized as Record<string, unknown>;
    if (serialized.type === "human") {
      return true;
    }
  }

  return false;
}

/**
 * Counts human messages in a message array.
 * Uses for-loop to avoid array allocation from filter.
 * Note: We use manual counting instead of filterMessages because the buffer
 * stores serialized messages (plain objects), not runtime BaseMessage objects.
 * @param messages - Array of messages
 * @returns Count of human messages
 */
export function countHumanMessages(messages: BaseMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (isHumanMessage(message)) {
      count++;
    }
  }
  return count;
}

/**
 * Gets the last human message from an array.
 * @param messages - Array of messages
 * @returns The last human message or undefined
 */
export function getLastHumanMessage(
  messages: BaseMessage[]
): BaseMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message && isHumanMessage(message)) {
      return message;
    }
  }
  return undefined;
}
