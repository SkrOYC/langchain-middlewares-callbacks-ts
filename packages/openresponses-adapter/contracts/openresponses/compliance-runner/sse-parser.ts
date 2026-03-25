import { z } from "zod";
import { errorStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/errorStreamingEventSchema.ts";
import { responseCompletedStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseCompletedStreamingEventSchema.ts";
import { responseContentPartAddedStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseContentPartAddedStreamingEventSchema.ts";
import { responseContentPartDoneStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseContentPartDoneStreamingEventSchema.ts";
import { responseCreatedStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseCreatedStreamingEventSchema.ts";
import { responseFailedStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseFailedStreamingEventSchema.ts";
import { responseFunctionCallArgumentsDeltaStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseFunctionCallArgumentsDeltaStreamingEventSchema.ts";
import { responseFunctionCallArgumentsDoneStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseFunctionCallArgumentsDoneStreamingEventSchema.ts";
import { responseIncompleteStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseIncompleteStreamingEventSchema.ts";
import { responseInProgressStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseInProgressStreamingEventSchema.ts";
import { responseOutputItemAddedStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseOutputItemAddedStreamingEventSchema.ts";
import { responseOutputItemDoneStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseOutputItemDoneStreamingEventSchema.ts";
import { responseOutputTextAnnotationAddedStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseOutputTextAnnotationAddedStreamingEventSchema.ts";
import { responseOutputTextDeltaStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseOutputTextDeltaStreamingEventSchema.ts";
import { responseOutputTextDoneStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseOutputTextDoneStreamingEventSchema.ts";
import { responseQueuedStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseQueuedStreamingEventSchema.ts";
import { responseReasoningDeltaStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseReasoningDeltaStreamingEventSchema.ts";
import { responseReasoningDoneStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseReasoningDoneStreamingEventSchema.ts";
import { responseReasoningSummaryDeltaStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseReasoningSummaryDeltaStreamingEventSchema.ts";
import { responseReasoningSummaryDoneStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseReasoningSummaryDoneStreamingEventSchema.ts";
import { responseReasoningSummaryPartAddedStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseReasoningSummaryPartAddedStreamingEventSchema.ts";
import { responseReasoningSummaryPartDoneStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseReasoningSummaryPartDoneStreamingEventSchema.ts";
import { responseRefusalDeltaStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseRefusalDeltaStreamingEventSchema.ts";
import { responseRefusalDoneStreamingEventSchema } from "../../../src/contract/generated/kubb/zod/responseRefusalDoneStreamingEventSchema.ts";
import type { responseResourceSchema } from "../../../src/contract/generated/kubb/zod/responseResourceSchema.ts";

export const streamingEventSchema = z.union([
  responseCreatedStreamingEventSchema,
  responseQueuedStreamingEventSchema,
  responseInProgressStreamingEventSchema,
  responseCompletedStreamingEventSchema,
  responseFailedStreamingEventSchema,
  responseIncompleteStreamingEventSchema,
  responseOutputItemAddedStreamingEventSchema,
  responseOutputItemDoneStreamingEventSchema,
  responseContentPartAddedStreamingEventSchema,
  responseContentPartDoneStreamingEventSchema,
  responseOutputTextDeltaStreamingEventSchema,
  responseOutputTextDoneStreamingEventSchema,
  responseRefusalDeltaStreamingEventSchema,
  responseRefusalDoneStreamingEventSchema,
  responseFunctionCallArgumentsDeltaStreamingEventSchema,
  responseFunctionCallArgumentsDoneStreamingEventSchema,
  responseReasoningSummaryPartAddedStreamingEventSchema,
  responseReasoningSummaryPartDoneStreamingEventSchema,
  responseReasoningDeltaStreamingEventSchema,
  responseReasoningDoneStreamingEventSchema,
  responseReasoningSummaryDeltaStreamingEventSchema,
  responseReasoningSummaryDoneStreamingEventSchema,
  responseOutputTextAnnotationAddedStreamingEventSchema,
  errorStreamingEventSchema,
]);

export type StreamingEvent = z.infer<typeof streamingEventSchema>;

export interface ParsedEvent {
  event: string;
  data: unknown;
  validationResult: ReturnType<typeof streamingEventSchema.safeParse>;
}

export interface SSEParseResult {
  events: ParsedEvent[];
  errors: string[];
  finalResponse: z.infer<typeof responseResourceSchema> | null;
}

export async function parseSSEStream(
  response: Response
): Promise<SSEParseResult> {
  const events: ParsedEvent[] = [];
  const errors: string[] = [];
  let finalResponse: z.infer<typeof responseResourceSchema> | null = null;

  const reader = response.body?.getReader();
  if (!reader) {
    return { events, errors: ["No response body"], finalResponse };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentData = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const nextDataLine = line.slice(5).trim();
          currentData = currentData
            ? `${currentData}\n${nextDataLine}`
            : nextDataLine;
        } else if (line === "" && currentData) {
          if (currentData === "[DONE]") {
            currentEvent = "";
            currentData = "";
            continue;
          }

          try {
            const parsed = JSON.parse(currentData);
            const validationResult = streamingEventSchema.safeParse(parsed);

            events.push({
              event: currentEvent || parsed.type || "unknown",
              data: parsed,
              validationResult,
            });

            if (!validationResult.success) {
              errors.push(
                `Event validation failed for ${parsed.type || "unknown"}: ${JSON.stringify(validationResult.error.issues)}`
              );
            }

            if (
              parsed.type === "response.completed" ||
              parsed.type === "response.failed" ||
              parsed.type === "response.incomplete"
            ) {
              finalResponse = parsed.response;
            }
          } catch {
            errors.push(`Failed to parse event data: ${currentData}`);
          }

          currentEvent = "";
          currentData = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { events, errors, finalResponse };
}
