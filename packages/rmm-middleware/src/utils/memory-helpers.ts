/**
 * Memory helper utilities for Retrospective Reflection
 *
 * Provides helper functions for:
 * - Extracting the last human message from conversation state
 * - Formatting memories for injection into model context
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { RetrievedMemory } from "@/schemas/index";

/**
 * Extracts the content from the last human message in a conversation
 *
 * @param messages - Array of conversation messages
 * @returns Content of the last human message, or null if none found
 */
export function extractLastHumanMessage(
  messages: BaseMessage[]
): string | null {
  if (!messages || messages.length === 0) {
    return null;
  }

  // Iterate backwards to find the last human message
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = getMessageContent(messages[i]);
    if (content !== null) {
      return content;
    }
  }

  return null;
}

/**
 * Gets content from a single message if it's a human message
 */
function getMessageContent(message: BaseMessage): string | null {
  const messageAny = message as {
    lc_serialized?: { type?: string };
    type?: string;
    _type?: string;
    content?: string | Array<{ type?: string; text?: string }>;
  };

  // Check for human message type
  const messageType =
    messageAny.lc_serialized?.type || messageAny.type || messageAny._type;

  if (messageType !== "human" && messageType !== "humanmessage") {
    return null;
  }

  // Extract content
  return extractContent(messageAny.content);
}

/**
 * Extracts string content from various content formats
 */
function extractContent(
  content?: string | Array<{ type?: string; text?: string }>
): string | null {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object") {
        const blockAny = block as { type?: string; text?: string };
        if (blockAny.type === "text" && typeof blockAny.text === "string") {
          return blockAny.text;
        }
      }
    }
  }

  return null;
}

/**
 * Escapes XML special characters to prevent injection attacks
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Formats memories into an XML-like block structure for injection
 *
 * Format matches the paper's Appendix D.2 citation format:
 * <memories>
 * – Memory [0]: topicSummary
 *   Original dialogue content
 * – Memory [1]: topicSummary
 *   Original dialogue content
 * </memories>
 *
 * @param memories - Array of retrieved memories to format
 * @returns Formatted memory block string
 */
export function formatMemoriesBlock(memories: RetrievedMemory[]): string {
  if (!memories || memories.length === 0) {
    return "";
  }

  const formattedMemories = memories
    .map((memory, index) => {
      // Format dialogue turns with XML escaping
      const dialogueBlock = memory.rawDialogue
        ? `\n    ${escapeXml(memory.rawDialogue)}`
        : "";

      return `– Memory [${index}]: ${escapeXml(memory.topicSummary)}${dialogueBlock}`;
    })
    .join("\n");

  return `<memories>\n${formattedMemories}\n</memories>`;
}
