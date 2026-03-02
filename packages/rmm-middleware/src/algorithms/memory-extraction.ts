import { randomUUID } from "node:crypto";
import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";

import type { MemoryEntry } from "@/schemas/index";
import { getLogger } from "@/utils/logger";

const logger = getLogger("memory-extraction");
const CODE_FENCE_JSON_REGEX = /```(?:json)?\s*([\s\S]*?)\s*```/i;

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
    const message = history[i];
    if (!message) {
      continue;
    }
    const turnNumber = Math.floor(i / 2);
    const speaker = normalizeSpeakerLabel(message.type);

    dialogueParts.push(
      `* Turn ${turnNumber}:\n  – ${speaker}: ${message.content}`
    );
  }

  return dialogueParts.join("\n");
}

function normalizeSpeakerLabel(type: string | undefined): string {
  if (type === "human" || type === "humanmessage") {
    return "SPEAKER_1";
  }
  if (type === "ai" || type === "aimessage" || type === "assistant") {
    return "SPEAKER_2";
  }
  return "SPEAKER_2";
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

interface ParsedExtractionResult {
  type: "no_trait" | "data" | "invalid";
  data?: ExtractionOutput;
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
  summarizationModel: BaseChatModel,
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
    const responseContent = extractTextFromModelResponse(response);

    // Step 4-6: Parse and normalize LLM extraction output
    const parsed = parseExtractionOutput(responseContent);
    if (parsed.type === "no_trait") {
      return [];
    }
    if (parsed.type === "invalid" || !parsed.data) {
      logger.warn(
        "Failed to parse LLM response as extraction JSON:",
        truncateForLog(responseContent)
      );
      return null;
    }
    const extractionOutput = parsed.data;

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
      const extracted = extractionOutput.extracted_memories[i];
      if (!extracted) {
        continue;
      }

      // Build raw dialogue from turn references
      const rawDialogueTurns = extracted.reference
        .map((turnIndex) => {
          const turnMessages = sessionHistory
            .filter(
              (_, messageIndex) => Math.floor(messageIndex / 2) === turnIndex
            )
            .map((message) => String(message.content ?? "").trim())
            .filter((content) => content.length > 0);
          return turnMessages.join(" ");
        })
        .filter((content) => content !== "")
        .join(" | ");

      const embedding = embeddingVectors[i];
      if (!embedding) {
        throw new Error(
          `[memory-extraction] Embedding generation mismatch at index ${i}: ` +
            `${extractionOutput.extracted_memories.length} memories, ` +
            `${embeddingVectors.length} embeddings`
        );
      }

      const memory: MemoryEntry = {
        id: randomUUID(),
        topicSummary: extracted.summary,
        rawDialogue: rawDialogueTurns || extracted.summary,
        timestamp,
        sessionId: effectiveSessionId,
        embedding,
        turnReferences: extracted.reference,
      };

      memories.push(memory);
    }

    return memories;
  } catch (error) {
    // LLM failure - return null for graceful degradation
    logger.warn("Error during memory extraction:", error);
    return null;
  }
}

function parseExtractionOutput(
  responseContent: string
): ParsedExtractionResult {
  const normalized = responseContent.trim();

  if (normalized === "NO_TRAIT") {
    return { type: "no_trait" };
  }

  const direct = tryParseExtractionJson(normalized);
  if (direct.type !== "invalid") {
    return direct;
  }

  const codeFenceMatch = normalized.match(CODE_FENCE_JSON_REGEX);
  const fencedBody = codeFenceMatch?.[1];
  if (fencedBody) {
    const fromFence = tryParseExtractionJson(fencedBody.trim());
    if (fromFence.type !== "invalid") {
      return fromFence;
    }
  }

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const jsonLike = normalized.slice(firstBrace, lastBrace + 1);
    const fromSlice = tryParseExtractionJson(jsonLike);
    if (fromSlice.type !== "invalid") {
      return fromSlice;
    }
  }

  return { type: "invalid" };
}

function extractTextFromModelResponse(response: unknown): string {
  if (typeof response === "string") {
    return response;
  }

  if (!response || typeof response !== "object") {
    return "";
  }

  const responseAny = response as {
    text?: unknown;
    content?: unknown;
  };

  if (typeof responseAny.text === "string" && responseAny.text.trim() !== "") {
    return responseAny.text;
  }

  const content = responseAny.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function tryParseExtractionJson(raw: string): ParsedExtractionResult {
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(raw);
  } catch {
    return { type: "invalid" };
  }

  if (parsedUnknown === "NO_TRAIT") {
    return { type: "no_trait" };
  }

  if (
    typeof parsedUnknown === "object" &&
    parsedUnknown !== null &&
    "extracted_memories" in parsedUnknown
  ) {
    const maybe = parsedUnknown as {
      extracted_memories?: unknown;
    };

    if (maybe.extracted_memories === "NO_TRAIT") {
      return { type: "no_trait" };
    }

    if (Array.isArray(maybe.extracted_memories)) {
      const isValid = maybe.extracted_memories.every(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as { summary?: unknown }).summary === "string" &&
          Array.isArray((entry as { reference?: unknown }).reference)
      );

      if (isValid) {
        return {
          type: "data",
          data: parsedUnknown as ExtractionOutput,
        };
      }
    }
  }

  return { type: "invalid" };
}

function truncateForLog(value: string, maxLength = 400): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
}
