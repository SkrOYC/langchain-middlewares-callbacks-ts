/**
 * Probe middleware used to capture retrieved session IDs in agent evaluations.
 */

import type { BaseMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import { z } from "zod";

interface ProbeState {
  messages?: BaseMessage[];
  _retrievedMemories?: Array<{
    id?: string;
    sessionId?: string;
    topicSummary?: string;
    rawDialogue?: string;
    relevanceScore?: number;
  }>;
}

interface ProbeRuntimeContext {
  _selectedIndices?: number[];
}

export interface EvalProbeEvent {
  timestamp: string;
  event: "before_model" | "after_model" | "model_request" | "model_response";
  method?: string;
  questionId?: string;
  questionType?: string;
  callId?: string;
  retrievedSessionIds?: string[];
  selectedSessionIds?: string[];
  selectedMemoryIds?: string[];
  retrievedMemories?: Record<string, unknown>[];
  messages?: Record<string, unknown>[];
  response?: unknown;
}

export interface EvalProbeOptions {
  method?: string;
  questionId?: string;
  questionType?: string;
  includeMemoryContent?: boolean;
  includeMessageContent?: boolean;
  topM?: number;
  onEvent?: (event: EvalProbeEvent) => Promise<void> | void;
}

/**
 * Creates a middleware that records retrieved session IDs into state.
 */
export function createEvalProbeMiddleware(options: EvalProbeOptions = {}) {
  let callCount = 0;
  const includeMemoryContent = options.includeMemoryContent ?? true;
  const includeMessageContent = options.includeMessageContent ?? true;
  const topM = options.topM ?? 5;

  const emit = async (
    payload: Omit<EvalProbeEvent, "timestamp">
  ): Promise<void> => {
    if (!options.onEvent) {
      return;
    }
    await options.onEvent({
      timestamp: new Date().toISOString(),
      ...payload,
    });
  };

  return createMiddleware({
    name: "EvalProbeMiddleware",
    stateSchema: z.object({
      _evalRetrievedSessionIds: z.array(z.string()).optional(),
      _retrievedMemories: z
        .array(
          z.object({
            id: z.string().optional(),
            sessionId: z.string().optional(),
            topicSummary: z.string().optional(),
            rawDialogue: z.string().optional(),
            relevanceScore: z.number().optional(),
          })
        )
        .optional(),
    }),
    beforeModel: async (state) => {
      const probeState = state as ProbeState;
      const sessionIds = extractSessionIds(probeState);

      await emit({
        event: "before_model",
        method: options.method,
        questionId: options.questionId,
        questionType: options.questionType,
        retrievedSessionIds: sessionIds,
        retrievedMemories: serializeRetrievedMemories(
          probeState,
          includeMemoryContent
        ),
      });

      return {
        _evalRetrievedSessionIds: sessionIds,
      };
    },
    wrapModelCall: async (request, handler) => {
      const probeState = (request?.state ?? {}) as ProbeState;
      const requestRetrievedSessionIds = extractSessionIds(probeState);
      const selectedIndices = readSelectedIndicesFromRuntime(request);
      const selectedInfo = extractSelectedMemoryInfo(
        probeState,
        selectedIndices,
        topM
      );

      callCount += 1;
      const callId = [
        options.method ?? "unknown-method",
        options.questionId ?? "unknown-question",
        `call-${callCount}`,
      ].join("::");

      await emit({
        event: "model_request",
        method: options.method,
        questionId: options.questionId,
        questionType: options.questionType,
        callId,
        retrievedSessionIds: requestRetrievedSessionIds,
        selectedSessionIds: selectedInfo.sessionIds,
        selectedMemoryIds: selectedInfo.memoryIds,
        retrievedMemories: serializeRetrievedMemories(
          probeState,
          includeMemoryContent
        ),
        messages: serializeMessages(
          Array.isArray(request?.messages) ? request.messages : [],
          includeMessageContent
        ),
      });

      const response = await handler(request);
      const selectedIndicesAfter = readSelectedIndicesFromRuntime(request);
      const selectedInfoAfter = extractSelectedMemoryInfo(
        probeState,
        selectedIndicesAfter,
        topM
      );

      await emit({
        event: "model_response",
        method: options.method,
        questionId: options.questionId,
        questionType: options.questionType,
        callId,
        selectedSessionIds: selectedInfoAfter.sessionIds,
        selectedMemoryIds: selectedInfoAfter.memoryIds,
        response: includeMessageContent
          ? serializeResponse(response)
          : "[omitted]",
      });

      return response;
    },
    afterModel: async (state) => {
      const probeState = state as ProbeState;
      const sessionIds = extractSessionIds(probeState);

      await emit({
        event: "after_model",
        method: options.method,
        questionId: options.questionId,
        questionType: options.questionType,
        retrievedSessionIds: sessionIds,
        retrievedMemories: serializeRetrievedMemories(
          probeState,
          includeMemoryContent
        ),
      });

      return {
        _evalRetrievedSessionIds: sessionIds,
      };
    },
  });
}

function readSelectedIndicesFromRuntime(
  request: unknown
): number[] | undefined {
  const runtimeContext = (
    request as { runtime?: { context?: ProbeRuntimeContext } }
  )?.runtime?.context;
  return runtimeContext?._selectedIndices;
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      output.push(value);
    }
  }

  return output;
}

function serializeMessages(
  messages: BaseMessage[],
  includeContent: boolean
): Record<string, unknown>[] {
  return messages.map((message, index) => {
    const messageAny = message as {
      type?: string;
      _type?: string;
      lc_serialized?: { type?: string };
      content?: unknown;
    };

    return {
      index,
      role:
        messageAny.type ??
        messageAny._type ??
        messageAny.lc_serialized?.type ??
        "unknown",
      content: includeContent
        ? normalizeContentForLog(messageAny.content)
        : "[omitted]",
    };
  });
}

function extractSessionIds(state: ProbeState): string[] {
  return dedupePreserveOrder(
    (state._retrievedMemories ?? [])
      .map((memory) => memory.sessionId)
      .filter((id): id is string => typeof id === "string")
  );
}

function extractSelectedMemoryInfo(
  state: ProbeState,
  maybeSelectedIndices: unknown,
  topM: number
): { sessionIds: string[]; memoryIds: string[] } {
  const memories = state._retrievedMemories ?? [];
  if (memories.length === 0) {
    return { sessionIds: [], memoryIds: [] };
  }

  const selectedIndices = Array.isArray(maybeSelectedIndices)
    ? maybeSelectedIndices
        .filter((value): value is number => Number.isInteger(value))
        .filter((value) => value >= 0 && value < memories.length)
    : [];

  const effectiveIndices =
    selectedIndices.length > 0
      ? selectedIndices
      : Array.from(
          { length: Math.min(topM, memories.length) },
          (_, index) => index
        );

  const selectedMemories = effectiveIndices
    .map((index) => memories[index])
    .filter((memory): memory is NonNullable<typeof memory> => Boolean(memory));

  return {
    sessionIds: dedupePreserveOrder(
      selectedMemories
        .map((memory) => memory.sessionId)
        .filter((id): id is string => typeof id === "string")
    ),
    memoryIds: dedupePreserveOrder(
      selectedMemories
        .map((memory) => memory.id)
        .filter((id): id is string => typeof id === "string")
    ),
  };
}

function serializeRetrievedMemories(
  state: ProbeState,
  includeMemoryContent: boolean
): Record<string, unknown>[] {
  return (state._retrievedMemories ?? []).map((memory) => ({
    id: memory.id,
    sessionId: memory.sessionId,
    relevanceScore: memory.relevanceScore,
    topicSummary: includeMemoryContent ? memory.topicSummary : undefined,
    rawDialogue: includeMemoryContent ? memory.rawDialogue : undefined,
  }));
}

function serializeResponse(response: unknown): unknown {
  const responseAny = response as {
    content?: unknown;
    additional_kwargs?: unknown;
    response_metadata?: unknown;
  };

  return {
    content: normalizeContentForLog(responseAny?.content),
    additional_kwargs: responseAny?.additional_kwargs,
    response_metadata: responseAny?.response_metadata,
  };
}

function normalizeContentForLog(content: unknown): unknown {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (typeof block === "string") {
        return block;
      }
      if (block && typeof block === "object") {
        return block as Record<string, unknown>;
      }
      return String(block);
    });
  }
  if (content && typeof content === "object") {
    return content as Record<string, unknown>;
  }
  return content ?? "";
}
