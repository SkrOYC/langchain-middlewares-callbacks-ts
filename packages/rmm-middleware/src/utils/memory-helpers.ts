/**
 * Memory helper utilities for Retrospective Reflection
 *
 * Provides helper functions for:
 * - Extracting the last human message from conversation state
 * - Formatting memories for injection into model context
 * - Sampling without replacement for Gumbel-Softmax
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
      // Format dialogue turns
      const dialogueBlock = memory.rawDialogue
        ? `\n    ${memory.rawDialogue}`
        : "";

      return `– Memory [${index}]: ${memory.topicSummary}${dialogueBlock}`;
    })
    .join("\n");

  return `<memories>\n${formattedMemories}\n</memories>`;
}

/**
 * Performs weighted sampling without replacement
 *
 * Uses the Gumbel-Softmax trick for differentiable sampling.
 * Each item is sampled based on its probability, then removed
 * from the pool for subsequent selections.
 *
 * @param probabilities - Array of sampling probabilities (will be normalized)
 * @param topM - Number of items to sample
 * @returns Array of selected indices
 */
export function sampleWithoutReplacement(
  probabilities: number[],
  topM: number
): number[] {
  if (!probabilities || probabilities.length === 0 || topM <= 0) {
    return [];
  }

  // If topM >= number of items, return all indices
  if (topM >= probabilities.length) {
    return Array.from({ length: probabilities.length }, (_, i) => i);
  }

  // Normalize probabilities to sum to 1
  const sum = probabilities.reduce((acc, p) => acc + Math.max(0, p), 0);
  if (sum === 0) {
    // If all probabilities are 0, return random selection
    const indices = Array.from({ length: probabilities.length }, (_, i) => i);
    // Shuffle and return topM
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, topM);
  }

  const normalizedProbs = probabilities.map((p) => Math.max(0, p) / sum);

  // Gumbel-Softmax sampling
  // g_i = -log(-log(u_i)) where u_i ~ Uniform(0, 1)
  const gumbelNoise = normalizedProbs.map(
    () => -Math.log(-Math.log(Math.random()))
  );

  // s̃_i = s_i + g_i
  const perturbedScores = normalizedProbs.map((p, i) => p + gumbelNoise[i]);

  // Compute softmax probabilities
  const maxScore = Math.max(...perturbedScores);
  const expScores = perturbedScores.map((s) => Math.exp((s - maxScore) / 0.5)); // Use 0.5 as default temperature
  const expSum = expScores.reduce((acc, e) => acc + e, 0);
  const softmaxProbs = expScores.map((e) => e / expSum);

  // Sample without replacement using softmax probabilities
  return performWeightedSampling(softmaxProbs, topM);
}

/**
 * Performs weighted sampling without replacement
 */
function performWeightedSampling(
  probabilities: number[],
  count: number
): number[] {
  const selectedIndices: number[] = [];
  const remainingProbabilities = [...probabilities];

  for (let i = 0; i < count && remainingProbabilities.length > 0; i++) {
    // Renormalize probabilities
    const total = remainingProbabilities.reduce((a, b) => a + b, 0);
    if (total === 0) {
      break;
    }

    const normalizedProbs = remainingProbabilities.map((p) => p / total);

    // Sample based on normalized probabilities
    const random = Math.random();
    let cumulative = 0;

    for (let j = 0; j < normalizedProbs.length; j++) {
      cumulative += normalizedProbs[j];

      if (random <= cumulative) {
        selectedIndices.push(j);
        remainingProbabilities.splice(j, 1);
        break;
      }
    }
  }

  return selectedIndices;
}
