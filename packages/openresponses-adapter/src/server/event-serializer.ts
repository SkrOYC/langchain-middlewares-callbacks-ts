import {
  agentExecutionFailed,
  type InternalError,
  internalErrorToPublicError,
  isInternalError,
} from "@/core/errors.js";
import type { InternalSemanticEvent } from "@/core/events.js";
import type {
  OpenResponsesEvent,
  OpenResponsesResponse,
} from "@/core/schemas.js";
import { OpenResponsesEventSchema } from "@/core/schemas.js";
import type {
  OpenResponsesRequestSnapshot,
  SequenceGenerator,
  SSEFrame,
} from "@/core/types.js";
import type { AsyncEventQueue } from "@/state/async-event-queue.js";
import type { CanonicalItemAccumulator } from "@/state/item-accumulator.js";
import { materializeResponseSnapshot } from "@/state/response-aggregate.js";
import type { ResponseLifecycle } from "@/state/response-lifecycle.js";

export const createSequenceGenerator = (): SequenceGenerator => {
  let counter = 0;
  return {
    next(): number {
      return ++counter;
    },
    current(): number {
      return counter;
    },
  };
};

export const validateOutgoingEvent = (
  event: OpenResponsesEvent
): OpenResponsesEvent => {
  return OpenResponsesEventSchema.parse(event);
};

export interface SerializerContext {
  accumulator: CanonicalItemAccumulator;
  inProgressEmitted?: { value: boolean };
  lifecycle: ResponseLifecycle;
  request: OpenResponsesRequestSnapshot;
  responseId: string;
  sequence: SequenceGenerator;
  itemOutputIndices: Map<string, number>;
}

const defaultRequestSnapshot = (): OpenResponsesRequestSnapshot => {
  return {
    model: "test-model",
    input: [],
    previous_response_id: null,
    include: [],
    tools: [],
    tool_choice: "auto",
    parallel_tool_calls: true,
    instructions: null,
    store: false,
    background: false,
    truncation: "disabled",
    text: { format: { type: "text" }, verbosity: "medium" },
    reasoning: null,
    top_p: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
    top_logprobs: 0,
    temperature: 1,
    max_output_tokens: null,
    max_tool_calls: null,
    service_tier: "default",
    safety_identifier: null,
    prompt_cache_key: null,
    metadata: {},
    stream_options: null,
  };
};

const errorToErrorObject = (error: unknown) => {
  if (isInternalError(error)) {
    return internalErrorToPublicError(error as InternalError);
  }

  const internal = agentExecutionFailed(
    error instanceof Error ? error.message : "Agent execution failed",
    error
  );

  return internalErrorToPublicError(internal);
};

const buildResponseSnapshot = (
  context: SerializerContext,
  status?: OpenResponsesResponse["status"],
  overrides?: {
    error?: OpenResponsesResponse["error"];
    incompleteDetails?: OpenResponsesResponse["incomplete_details"];
  }
) => {
  return materializeResponseSnapshot({
    request: context.request,
    responseId: context.responseId,
    createdAt: context.lifecycle.createdAt,
    completedAt: context.lifecycle.getCompletedAt(),
    status: status ?? context.lifecycle.getStatus(),
    output: context.accumulator.snapshot(),
    error:
      (overrides?.error as OpenResponsesResponse["error"]) ??
      context.lifecycle.getError(),
    incompleteDetails: overrides?.incompleteDetails,
  });
};

const getOutputIndexOrThrow = (
  context: SerializerContext,
  itemId: string,
  eventType: string
): number => {
  const outputIndex = context.itemOutputIndices.get(itemId);
  if (outputIndex === undefined) {
    throw new Error(
      `Invariant violation: received ${eventType} for unknown item ID "${itemId}"`
    );
  }

  return outputIndex;
};

const nextOutputIndex = (
  context: SerializerContext,
  itemId: string
): number => {
  const outputIndex = context.itemOutputIndices.size;
  context.itemOutputIndices.set(itemId, outputIndex);
  return outputIndex;
};

const ensureInProgressEvent = (
  context: SerializerContext
): OpenResponsesEvent | null => {
  if (context.inProgressEmitted?.value) {
    return null;
  }

  if (context.lifecycle.getStatus() === "queued") {
    context.lifecycle.start();
  }

  if (context.inProgressEmitted) {
    context.inProgressEmitted.value = true;
  }

  return emitLifecycleEvent("response.in_progress", context, "in_progress");
};

const emitLifecycleEvent = (
  type:
    | "response.created"
    | "response.queued"
    | "response.in_progress"
    | "response.completed"
    | "response.failed"
    | "response.incomplete",
  context: SerializerContext,
  status: OpenResponsesResponse["status"],
  overrides?: {
    error?: OpenResponsesResponse["error"];
    incompleteDetails?: OpenResponsesResponse["incomplete_details"];
  }
): OpenResponsesEvent => {
  return {
    type,
    sequence_number: context.sequence.next(),
    response: buildResponseSnapshot(context, status, overrides),
  } as OpenResponsesEvent;
};

export const serializeInternalEvent = (
  event: InternalSemanticEvent,
  context: SerializerContext
): OpenResponsesEvent[] => {
  switch (event.type) {
    case "run.started": {
      const inProgressEvent = ensureInProgressEvent(context);
      return inProgressEvent ? [inProgressEvent] : [];
    }

    case "message.started": {
      const item = context.accumulator.startTextMessageItem({
        id: event.itemId,
      });
      const outputIndex = nextOutputIndex(context, event.itemId);
      const events: OpenResponsesEvent[] = [];
      const inProgressEvent = ensureInProgressEvent(context);
      if (inProgressEvent) {
        events.push(inProgressEvent);
      }

      events.push(
        {
          type: "response.output_item.added",
          sequence_number: context.sequence.next(),
          output_index: outputIndex,
          item,
        },
        {
          type: "response.content_part.added",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          part: item.content[0] as OpenResponsesEvent extends never
            ? never
            : any,
        }
      );

      return events;
    }

    case "text.delta": {
      const outputIndex = getOutputIndexOrThrow(
        context,
        event.itemId,
        event.type
      );
      context.accumulator.appendOutputTextDelta(event.itemId, event.delta);
      return [
        {
          type: "response.output_text.delta",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          delta: event.delta,
          logprobs: [],
        },
      ];
    }

    case "text.completed": {
      const outputIndex = getOutputIndexOrThrow(
        context,
        event.itemId,
        event.type
      );
      const finalizedItem = context.accumulator.finalizeMessageItem(
        event.itemId,
        "completed"
      );
      const finalizedPart = finalizedItem.content[0];

      if (!finalizedPart || finalizedPart.type !== "output_text") {
        throw new Error(
          `Invariant violation: expected output_text for canonical item "${event.itemId}"`
        );
      }

      return [
        {
          type: "response.output_text.done",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          text: finalizedPart.text,
          logprobs: [],
        },
        {
          type: "response.content_part.done",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          part: finalizedPart,
        },
        {
          type: "response.output_item.done",
          sequence_number: context.sequence.next(),
          output_index: outputIndex,
          item: finalizedItem,
        },
      ];
    }

    case "refusal.started": {
      const item = context.accumulator.startRefusalMessageItem({
        id: event.itemId,
      });
      const outputIndex = nextOutputIndex(context, event.itemId);
      const events: OpenResponsesEvent[] = [];
      const inProgressEvent = ensureInProgressEvent(context);
      if (inProgressEvent) {
        events.push(inProgressEvent);
      }

      events.push(
        {
          type: "response.output_item.added",
          sequence_number: context.sequence.next(),
          output_index: outputIndex,
          item,
        },
        {
          type: "response.content_part.added",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          part: item.content[0] as OpenResponsesEvent extends never
            ? never
            : any,
        }
      );

      return events;
    }

    case "refusal.delta": {
      const outputIndex = getOutputIndexOrThrow(
        context,
        event.itemId,
        event.type
      );
      context.accumulator.appendRefusalDelta(event.itemId, event.delta);
      return [
        {
          type: "response.refusal.delta",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          delta: event.delta,
        },
      ];
    }

    case "refusal.completed": {
      const outputIndex = getOutputIndexOrThrow(
        context,
        event.itemId,
        event.type
      );
      const finalizedItem = context.accumulator.finalizeMessageItem(
        event.itemId,
        "completed"
      );
      const finalizedPart = finalizedItem.content[0];

      if (!finalizedPart || finalizedPart.type !== "refusal") {
        throw new Error(
          `Invariant violation: expected refusal for canonical item "${event.itemId}"`
        );
      }

      return [
        {
          type: "response.refusal.done",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          refusal: finalizedPart.refusal,
        },
        {
          type: "response.content_part.done",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          part: finalizedPart,
        },
        {
          type: "response.output_item.done",
          sequence_number: context.sequence.next(),
          output_index: outputIndex,
          item: finalizedItem,
        },
      ];
    }

    case "reasoning.started": {
      const item = context.accumulator.startReasoningItem({ id: event.itemId });
      const outputIndex = nextOutputIndex(context, event.itemId);
      const events: OpenResponsesEvent[] = [];
      const inProgressEvent = ensureInProgressEvent(context);
      if (inProgressEvent) {
        events.push(inProgressEvent);
      }

      events.push(
        {
          type: "response.output_item.added",
          sequence_number: context.sequence.next(),
          output_index: outputIndex,
          item,
        },
        {
          type: "response.content_part.added",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          part: { type: "reasoning_text", text: "" },
        }
      );

      return events;
    }

    case "reasoning.delta": {
      const outputIndex = getOutputIndexOrThrow(
        context,
        event.itemId,
        event.type
      );
      context.accumulator.appendReasoningDelta(event.itemId, event.delta);
      return [
        {
          type: "response.reasoning.delta",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          delta: event.delta,
        },
      ];
    }

    case "reasoning.completed": {
      const outputIndex = getOutputIndexOrThrow(
        context,
        event.itemId,
        event.type
      );
      for (const summaryText of event.summaryTexts ?? []) {
        context.accumulator.appendReasoningSummary(event.itemId, summaryText);
      }
      const finalizedItem = context.accumulator.finalizeReasoningItem(
        event.itemId
      );
      const reasoningText = finalizedItem.content?.[0];
      if (!reasoningText || reasoningText.type !== "reasoning_text") {
        throw new Error(
          `Invariant violation: expected reasoning_text for canonical item "${event.itemId}"`
        );
      }

      return [
        {
          type: "response.reasoning.done",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          text: reasoningText.text,
        },
        {
          type: "response.content_part.done",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          part: reasoningText,
        },
        {
          type: "response.output_item.done",
          sequence_number: context.sequence.next(),
          output_index: outputIndex,
          item: finalizedItem,
        },
      ];
    }

    case "output_text.annotation.added": {
      const outputIndex = getOutputIndexOrThrow(
        context,
        event.itemId,
        event.type
      );
      context.accumulator.addOutputTextAnnotation(
        event.itemId,
        event.annotation
      );
      const item = context.accumulator.snapshot().find((candidate) => {
        return candidate.type === "message" && candidate.id === event.itemId;
      });
      const textPart = item?.type === "message" ? item.content[0] : undefined;
      const annotationIndex =
        textPart?.type === "output_text" ? textPart.annotations.length - 1 : 0;

      return [
        {
          type: "response.output_text.annotation.added",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          annotation_index: Math.max(annotationIndex, 0),
          annotation: event.annotation,
        },
      ];
    }

    case "function_call.started": {
      const events: OpenResponsesEvent[] = [];
      const inProgressEvent = ensureInProgressEvent(context);
      if (inProgressEvent) {
        events.push(inProgressEvent);
      }
      const item = context.accumulator.startFunctionCallItem({
        id: event.itemId,
        name: event.name,
        callId: event.callId,
        ...(event.arguments !== undefined
          ? { arguments: event.arguments }
          : {}),
      });
      const outputIndex = nextOutputIndex(context, event.itemId);
      events.push({
        type: "response.output_item.added",
        sequence_number: context.sequence.next(),
        output_index: outputIndex,
        item,
      });

      return events;
    }

    case "function_call_arguments.delta": {
      const outputIndex = getOutputIndexOrThrow(
        context,
        event.itemId,
        event.type
      );
      context.accumulator.appendFunctionCallArgumentsDelta(
        event.itemId,
        event.delta
      );
      return [
        {
          type: "response.function_call_arguments.delta",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          delta: event.delta,
        },
      ];
    }

    case "function_call.completed": {
      const outputIndex = getOutputIndexOrThrow(
        context,
        event.itemId,
        event.type
      );
      const finalizedItem = context.accumulator.finalizeFunctionCallItem(
        event.itemId,
        "completed"
      );
      return [
        {
          type: "response.function_call_arguments.done",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          arguments: finalizedItem.arguments,
        },
        {
          type: "response.output_item.done",
          sequence_number: context.sequence.next(),
          output_index: outputIndex,
          item: finalizedItem,
        },
      ];
    }

    case "function_call_output.completed": {
      const item = context.accumulator.addFunctionCallOutputItem({
        id: event.itemId,
        callId: event.callId,
        output: event.output,
      });
      const outputIndex = nextOutputIndex(context, event.itemId);
      return [
        {
          type: "response.output_item.added",
          sequence_number: context.sequence.next(),
          output_index: outputIndex,
          item,
        },
        {
          type: "response.output_item.done",
          sequence_number: context.sequence.next(),
          output_index: outputIndex,
          item,
        },
      ];
    }

    case "run.completed": {
      if (event.runId !== context.responseId) {
        return [];
      }

      if (context.lifecycle.getStatus() === "queued") {
        context.lifecycle.start();
      }
      context.lifecycle.complete();
      return [emitLifecycleEvent("response.completed", context, "completed")];
    }

    case "run.failed": {
      if (event.runId !== context.responseId) {
        return [];
      }

      const errorObject = errorToErrorObject(event.error);
      context.accumulator.finalizeOpenItemsAsIncomplete();
      if (context.lifecycle.getStatus() === "queued") {
        context.lifecycle.start();
      }
      context.lifecycle.fail(errorObject);
      return [
        emitLifecycleEvent("response.failed", context, "failed", {
          error: errorObject,
        }),
      ];
    }

    case "run.incomplete": {
      if (event.runId !== context.responseId) {
        return [];
      }

      context.accumulator.finalizeOpenItemsAsIncomplete();
      if (context.lifecycle.getStatus() === "queued") {
        context.lifecycle.start();
      }
      context.lifecycle.incomplete();
      return [
        emitLifecycleEvent("response.incomplete", context, "incomplete", {
          incompleteDetails: {
            reason: event.reason ?? "stream_ended_before_terminal_state",
          },
        }),
      ];
    }

    case "tool.started":
    case "tool.completed":
    case "tool.error":
      return [];
  }
};

export async function* createEventSerializer(params: {
  queue: AsyncEventQueue<InternalSemanticEvent>;
  accumulator: CanonicalItemAccumulator;
  lifecycle: ResponseLifecycle;
  request?: OpenResponsesRequestSnapshot;
  responseId: string;
}): AsyncGenerator<OpenResponsesEvent | "[DONE]"> {
  const context: SerializerContext = {
    accumulator: params.accumulator,
    inProgressEmitted: { value: false },
    lifecycle: params.lifecycle,
    request: params.request ?? defaultRequestSnapshot(),
    responseId: params.responseId,
    sequence: createSequenceGenerator(),
    itemOutputIndices: new Map(),
  };

  yield validateOutgoingEvent(
    emitLifecycleEvent("response.created", context, "queued")
  );
  yield validateOutgoingEvent(
    emitLifecycleEvent("response.queued", context, "queued")
  );

  try {
    for await (const event of params.queue) {
      const publicEvents = serializeInternalEvent(event, context);
      for (const publicEvent of publicEvents) {
        yield validateOutgoingEvent(publicEvent);
      }
    }
  } catch (error) {
    const errorObject = errorToErrorObject(error);
    context.accumulator.finalizeOpenItemsAsIncomplete();
    if (params.lifecycle.getStatus() === "queued") {
      params.lifecycle.start();
    }
    if (params.lifecycle.getStatus() === "in_progress") {
      params.lifecycle.fail(errorObject);
      yield validateOutgoingEvent(
        emitLifecycleEvent("response.failed", context, "failed", {
          error: errorObject,
        })
      );
    }
  }

  const status = params.lifecycle.getStatus();
  if (status === "queued" || status === "in_progress") {
    context.accumulator.finalizeOpenItemsAsIncomplete();
    if (status === "queued") {
      params.lifecycle.start();
    }
    params.lifecycle.incomplete();
    yield validateOutgoingEvent(
      emitLifecycleEvent("response.incomplete", context, "incomplete", {
        incompleteDetails: {
          reason: "stream_ended_before_terminal_state",
        },
      })
    );
  }

  yield "[DONE]";
}

export const formatSSEFrame = (event: OpenResponsesEvent): SSEFrame => {
  validateOutgoingEvent(event);
  return {
    event: event.type,
    data: JSON.stringify(event),
  };
};
