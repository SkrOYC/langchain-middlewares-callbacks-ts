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
 * Gets content from a single message if its a human message
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
 *
 * Note: For memories created through the extraction pipeline, content
 * should already be sanitized. This provides defense-in-depth.
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
 * Format matches the papers Appendix D.2 citation format:
 * <memories>
 *  Memory [0]: topicSummary
 *   Original dialogue content
 *  Memory [1]: topicSummary
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

      return `Memory [${index}]: ${escapeXml(memory.topicSummary)}${dialogueBlock}`;
    })
    .join("\n");

  return `<memories>\n${formattedMemories}\n</memories>`;
}

/**
 * Formats the full citation prompt content for the ephemeral message
 *
 * This function creates the complete prompt that instructs the LLM to:
 * 1. Generate a natural response using the provided memories
 * 2. Cite useful memories using [i] notation
 * 3. Output [NO_CITE] when no memories are useful
 *
 * The prompt includes the full instructions and examples from Appendix D.2 of the paper,
 * adapted to be used within an ephemeral HumanMessage alongside the memories block.
 *
 * @param query - The user's query to answer
 * @param memories - Array of retrieved memories with topic summaries and raw dialogue
 * @returns Complete formatted prompt string for the LLM
 */
export function formatCitationPromptContent(
  query: string,
  memories: RetrievedMemory[]
): string {
  const memoriesBlock = formatMemoriesBlock(memories);

  return `<system-reminder>
Given the user query and the list of memories consisting of personal summaries with their corresponding original turns, generate a natural and fluent response while adhering to the following guidelines:

* Cite useful memories using [i], where i corresponds to the index of the cited memory.
* Do not cite memories that are not useful. If no useful memory exist, output [NO_CITE].
* Each memory is independent and may repeat or contradict others. The response must be directly supported by cited memories.
* If the response relies on multiple memories, list all corresponding indices, e.g., [i, j, k].
* The citation is evaluated based on whether the response references the original turns, not the summaries.

User Query: ${escapeXml(query)}

<examples>
Case 1: Useful Memories Found
INPUT:
* User Query: SPEAKER_1: What hobbies do I enjoy?
<memories>
Memory [0]: SPEAKER_1 enjoys hiking and often goes on weekend trips.
  Speaker 1: I love spending my weekends hiking in the mountains. Speaker 2: That sounds amazing! Do you go alone or with friends? Speaker 1: Last month, I hiked a new trail and it was amazing. Speaker 2: Nice! Which trail was it?
Memory [1]: SPEAKER_1 plays the guitar and occasionally performs at open mics.
  Speaker 1: I've been practicing guitar for years and love playing at open mics. Speaker 2: That's awesome! What songs do you usually play? Speaker 1: I performed at a local cafe last week and had a great time. Speaker 2: That must have been fun! Were there a lot of people?
Memory [2]: SPEAKER_1 is interested in astronomy and enjoys stargazing.
  Speaker 1: I recently bought a telescope to get a closer look at planets. Speaker 2: That's so cool! What have you seen so far? Speaker 1: I love stargazing, especially when there's a meteor shower. Speaker 2: I'd love to do that sometime. When's the next one?
</memories>

Output: You enjoy hiking, playing guitar, and stargazing. [0, 1, 2]

Case 2: No Useful Memories
INPUT:
* User Query: SPEAKER_1: What countries did I go to last summer?
<memories>
Memory [0]: SPEAKER_1 enjoys hiking and often goes on weekend trips.
  Speaker 1: I love spending my weekends hiking in the mountains. Speaker 2: That sounds amazing! Do you go alone or with friends? Speaker 1: Last month, I hiked a new trail and it was amazing. Speaker 2: Nice! Which trail was it?
Memory [1]: SPEAKER_1 plays the guitar and occasionally performs at open mics.
  Speaker 1: I've been practicing guitar for years and love playing at open mics. Speaker 2: That's awesome! What songs do you usually play? Speaker 1: I performed at a local cafe last week and had a great time. Speaker 2: That must have been fun! Were there a lot of people?
Memory [2]: SPEAKER_1 is interested in astronomy and enjoys stargazing.
  Speaker 1: I recently bought a telescope to get a closer look at planets. Speaker 2: That's so cool! What have you seen so far? Speaker 1: I love stargazing, especially when there's a meteor shower. Speaker 2: I'd love to do that sometime. When's the next one?
</memories>

Output: I don't have enough information to answer that. [NO_CITE]
</examples>

Additional Instructions:
* Ensure the response is fluent and directly answers the user's query.
* Always cite the useful memory indices explicitly.
* The citation is evaluated based on whether the response references the original turns, not the summaries.
* Follow the format of the examples provided above.

<memories>
${memories.length > 0 ? memoriesBlock : "<memories></memories>"}
</memories>

</system-reminder>`;
}
