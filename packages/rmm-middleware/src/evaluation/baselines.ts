/**
 * Baseline retrieval middleware used for agent-level evaluations.
 */

import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import { createMiddleware } from "langchain";
import { z } from "zod";
import { extractLastHumanMessage } from "@/utils/memory-helpers";

interface RetrievedMemory {
  id: string;
  topicSummary: string;
  rawDialogue: string;
  timestamp: number;
  sessionId: string;
  turnReferences: number[];
  relevanceScore: number;
}

interface BaselineState {
  messages: BaseMessage[];
  _retrievedMemories?: RetrievedMemory[];
}

export interface BaselineMiddlewareOptions {
  vectorStore: VectorStoreInterface;
  topK?: number;
  topM?: number;
}

/**
 * Creates a simple RAG-style middleware for baseline comparisons.
 */
export function createRagMiddleware(options: BaselineMiddlewareOptions) {
  const topK = options.topK ?? 20;
  const topM = options.topM ?? 5;

  return createMiddleware({
    name: "LongMemEvalRagBaseline",
    stateSchema: z.object({
      _retrievedMemories: z
        .array(
          z.object({
            id: z.string(),
            topicSummary: z.string(),
            rawDialogue: z.string(),
            timestamp: z.number(),
            sessionId: z.string(),
            turnReferences: z.array(z.number()),
            relevanceScore: z.number(),
          })
        )
        .optional(),
    }),
    beforeModel: async (state: BaselineState) => {
      const query = extractLastHumanMessage(state.messages);
      if (!query) {
        return {
          _retrievedMemories: [],
        };
      }

      const docs = await options.vectorStore.similaritySearch(query, topK);
      return {
        _retrievedMemories: docs.map((doc, index) => {
          const metadata = doc.metadata as Record<string, unknown> | undefined;
          return {
            id: String(metadata?.id ?? `baseline-${index}`),
            topicSummary: doc.pageContent,
            rawDialogue: String(metadata?.rawDialogue ?? doc.pageContent),
            timestamp: Number(metadata?.timestamp ?? Date.now()),
            sessionId: String(metadata?.sessionId ?? "unknown"),
            turnReferences: Array.isArray(metadata?.turnReferences)
              ? (metadata.turnReferences as number[])
              : [],
            relevanceScore: Number(metadata?.score ?? 0),
          } satisfies RetrievedMemory;
        }),
      };
    },
    wrapModelCall: (request, handler) => {
      const memories =
        (request.state as BaselineState)._retrievedMemories?.slice(0, topM) ??
        [];

      if (memories.length === 0) {
        return handler(request);
      }

      const contextBlock = memories
        .map(
          (memory, idx) =>
            `[${idx}] Session ${memory.sessionId}: ${memory.topicSummary}`
        )
        .join("\n");

      const memoryMessage = new HumanMessage({
        content: [
          "Use the following retrieved memories when answering the user.",
          contextBlock,
        ].join("\n\n"),
      });

      return handler({
        ...request,
        messages: [...request.messages, memoryMessage],
      });
    },
  });
}

/**
 * Oracle baseline currently shares the same retrieval/injection path as RAG,
 * but is configured with an oracle vector store.
 */
export function createOracleBaselineMiddleware(
  options: BaselineMiddlewareOptions
) {
  return createRagMiddleware(options);
}
