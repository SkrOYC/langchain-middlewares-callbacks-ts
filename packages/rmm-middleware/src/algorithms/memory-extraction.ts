import { randomUUID } from "crypto";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { Embeddings } from "@langchain/core/embeddings";

import type { MemoryEntry } from "@/schemas/index";

/**
 * Formats a session history into a dialogue string with turn markers.
 *
 * @param history - Array of BaseMessage objects representing the conversation
 * @returns Formatted dialogue string with turn markers
 */
function formatSessionHistory(history: BaseMessage[]): string {
  if (history.length === 0) {
    return "";
  }

  const dialogueParts: string[] = [];

  for (let i = 0; i < history.length; i++) {
    const message = history[i]!;
    const turnNumber = Math.floor(i / 2);
    const speaker = message.type;

    dialogueParts.push(
      `* Turn ${turnNumber}:\n  – ${speaker}: ${message.content}`
    );
  }

  return dialogueParts.join("\n");
}

/**
 * Interface for the extraction output from LLM
 */
interface ExtractionOutput {
  extracted_memories: Array<{
    summary: string;
    reference: number[];
  }>;
}

/**
 * Interface for minimal summarization model needed by this algorithm
 */
interface SummarizationModelInterface {
  invoke(input: string): Promise<{ content: any }>;
}

/**
 * Extracts memories from a session dialogue using LLM-based summarization.
 *
 * This function implements the Prospective Reflection memory extraction algorithm.
 * It formats the session history, calls an LLM to extract topic-based memories,
 * and returns them as MemoryEntry objects with embeddings.
 *
 * @param sessionHistory - Array of BaseMessage objects representing the conversation
 * @param summarizationModel - LLM for extracting memories from dialogue
 * @param embeddings - Embeddings model for generating memory vectors
 * @param speakerPrompt - Prompt template function for memory extraction
 * @param sessionId - Optional session identifier for tracking
 * @returns Array of MemoryEntry objects or null on failure
 *
 * @example
 * ```typescript
 * const memories = await extractMemories(
 *   messages,
 *   llm,
 *   embeddings,
 *   extractSpeaker1,
 *   "session-123"
 * );
 * ```
 */
export async function extractMemories(
  sessionHistory: BaseMessage[],
  summarizationModel: SummarizationModelInterface,
  embeddings: Embeddings,
  speakerPrompt: (dialogueSession: string) => string,
  sessionId?: string
): Promise<MemoryEntry[] | null> {
  // Handle empty session
  if (sessionHistory.length === 0) {
    return [];
  }

  try {
    // Step 1: Format session history into dialogue string
    const dialogueSession = formatSessionHistory(sessionHistory);

    // Step 2: Build the extraction prompt
    const prompt = speakerPrompt(dialogueSession);

    // Step 3: Call LLM with extraction prompt
    const response = await summarizationModel.invoke(prompt);
    const responseContent = response.content;

    // Step 4: Handle NO_TRAIT special case
    if (responseContent === "NO_TRAIT") {
      return [];
    }

    // Step 5: Parse JSON response
    let extractionOutput: ExtractionOutput;

    try {
      extractionOutput = JSON.parse(responseContent as string) as ExtractionOutput;
    } catch {
      // Invalid JSON - return null for graceful degradation
      console.warn(
        "[memory-extraction] Failed to parse LLM response as JSON:",
        responseContent
      );
      return null;
    }

    // Step 6: Validate extraction output structure
    if (
      !extractionOutput.extracted_memories ||
      !Array.isArray(extractionOutput.extracted_memories)
    ) {
      console.warn(
        "[memory-extraction] Invalid extraction output structure:",
        extractionOutput
      );
      return null;
    }

    // Step 7: Generate embeddings for each extracted memory
    const summaries = extractionOutput.extracted_memories.map(
      (mem) => mem.summary
    );

    const embeddingVectors = await embeddings.embedDocuments(summaries);

    // Step 8: Create MemoryEntry objects
    const memories: MemoryEntry[] = [];
    const timestamp = Date.now();
    const effectiveSessionId = sessionId || randomUUID();

    for (let i = 0; i < extractionOutput.extracted_memories.length; i++) {
      const extracted = extractionOutput.extracted_memories[i]!;

      // Build raw dialogue from turn references
      const rawDialogueTurns = extracted.reference
        .map((turnIndex) => {
          const messageIndex = turnIndex * 2;
          if (messageIndex < sessionHistory.length) {
            return sessionHistory[messageIndex]!.content;
          }
          return "";
        })
        .filter((content) => content !== "")
        .join(" | ");

      const memory: MemoryEntry = {
        id: randomUUID(),
        topicSummary: extracted.summary,
        rawDialogue: rawDialogueTurns || extracted.summary,
        timestamp,
        sessionId: effectiveSessionId,
        embedding: embeddingVectors[i]!,
        turnReferences: extracted.reference,
      };

      memories.push(memory);
    }

    return memories;
  } catch (error) {
    // LLM failure - return null for graceful degradation
    console.warn("[memory-extraction] Error during memory extraction:", error);
    return null;
  }
}
