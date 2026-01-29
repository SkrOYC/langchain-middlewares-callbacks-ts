/**
 * Reasoning Blocks Utility
 *
 * Extracts and validates reasoning/thinking content blocks from LangChain V1 AIMessages.
 * Uses the canonical contentBlocks API which auto-translates provider-specific formats.
 */

import type { BaseMessage, AIMessage } from "@langchain/core/messages";

/**
 * Reasoning content block structure from LangChain V1 contentBlocks API.
 * Auto-translated from provider formats (Anthropic, Google, OpenAI, etc.)
 */
export interface ReasoningBlock {
  type: "reasoning";
  reasoning: string;
  signature?: string;
  index?: number;
}

/**
 * Type guard to check if a content block is a reasoning block.
 *
 * @param block - The content block to check
 * @returns True if the block is a reasoning block
 */
export function isReasoningBlock(block: ContentBlock): block is ReasoningBlock {
  return block != null && block.type === "reasoning";
}

/**
 * ContentBlock type from LangChain V1 messages.
 * This is a discriminated union covering all possible block types.
 */
type ContentBlock = {
  type: string;
  [key: string]: unknown;
};

/**
 * Extract all reasoning blocks from a BaseMessage.
 *
 * Uses LangChain V1's contentBlocks getter which auto-translates
 * provider-specific formats to a canonical structure.
 *
 * @param message - The message to extract reasoning blocks from
 * @returns Array of reasoning blocks, empty if not an AI message or no reasoning content
 */
export function extractReasoningBlocks(message: BaseMessage): ReasoningBlock[] {
  const aiMessage = message as AIMessage;

  // Only AI messages can have reasoning content
  if (aiMessage._getType() !== "ai") {
    return [];
  }

  // Access contentBlocks getter (LangChain V1 canonical API)
  const contentBlocks = aiMessage.contentBlocks;

  if (!Array.isArray(contentBlocks)) {
    return [];
  }

  return contentBlocks.filter(isReasoningBlock);
}

/**
 * Extract just the reasoning text strings from a message.
 *
 * @param message - The message to extract reasoning text from
 * @returns Array of reasoning text strings, filtered to non-empty strings
 */
export function extractReasoningText(message: BaseMessage): string[] {
  return extractReasoningBlocks(message)
    .map((block) => block.reasoning)
    .filter((text): text is string => typeof text === "string" && text.trim().length > 0);
}

/**
 * Group reasoning blocks by their index for coherent thinking phases.
 *
 * Multiple reasoning phases can occur (interleaved thinking pattern),
 * where the agent thinks, responds, calls a tool, thinks again, etc.
 * Each phase is identified by its index.
 *
 * @param message - The message to group reasoning blocks from
 * @returns Map of index to array of reasoning blocks for that phase
 */
export function groupReasoningBlocksByIndex(
  message: BaseMessage
): Map<number, ReasoningBlock[]> {
  const blocks = extractReasoningBlocks(message);
  const grouped = new Map<number, ReasoningBlock[]>();

  for (const block of blocks) {
    const index = block.index ?? 0;
    const existing = grouped.get(index) ?? [];
    existing.push(block);
    grouped.set(index, existing);
  }

  return grouped;
}
