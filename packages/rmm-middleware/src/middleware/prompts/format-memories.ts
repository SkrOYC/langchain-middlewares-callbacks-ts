/**
 * Memory block formatter utility
 *
 * Formats memories into the XML-like block structure required by
 * the generateWithCitations prompt (Appendix D.2).
 */

/**
 * Represents a single dialogue turn for memory formatting
 */
export interface DialogueTurn {
  speaker: string;
  text: string;
}

/**
 * Memory input interface for formatting
 */
export interface FormattedMemory {
  topicSummary: string;
  dialogueTurns: DialogueTurn[];
}

/**
 * Format memories into XML block structure
 *
 * @param memories - Array of memories to format
 * @returns Formatted memory block string
 */
export function formatMemories(memories: FormattedMemory[]): string {
  if (memories.length === 0) {
    return "";
  }

  const formattedMemories = memories
    .map((memory, index) => {
      const dialogueBlock = memory.dialogueTurns
        .map((turn) => {
          // Replace newlines with spaces to keep each turn on a single line
          const formattedText = turn.text.replace(/\n/g, " ");
          return `    ${turn.speaker}: ${formattedText}`;
        })
        .join("\n");

      return `– Memory [${index}]: ${memory.topicSummary}\n${dialogueBlock}`;
    })
    .join("\n");

  return `<memories>\n${formattedMemories}\n</memories>`;
}
