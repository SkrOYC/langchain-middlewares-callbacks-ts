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

type ContentPartEventPart = Extract<
  OpenResponsesEvent,
  { type: "response.content_part.added" }
>["part"];
type OutputTextContentPart = Extract<
  ContentPartEventPart,
  { type: "output_text" }
>;
type RefusalContentPart = Extract<ContentPartEventPart, { type: "refusal" }>;

type LifecycleEventType =
  | "response.created"
  | "response.queued"
  | "response.in_progress"
  | "response.completed"
  | "response.failed"
  | "response.incomplete";

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

const emitErrorEvent = (
  context: SerializerContext,
  error: NonNullable<OpenResponsesResponse["error"]>
): OpenResponsesEvent => {
  return {
    type: "error",
    sequence_number: context.sequence.next(),
    error: {
      type: error.type,
      code: error.code,
      message: error.message,
      param: error.param ?? null,
    },
  } as OpenResponsesEvent;
};

const emitFailedTerminalEvents = (
  context: SerializerContext,
  error: NonNullable<OpenResponsesResponse["error"]>
): OpenResponsesEvent[] => {
  return [
    emitErrorEvent(context, error),
    emitLifecycleEvent("response.failed", context, "failed", {
      error,
    }),
  ];
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

const emitLifecycleEvent = (
  type: LifecycleEventType,
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

const asContentPart = (part: ContentPartEventPart): ContentPartEventPart =>
  part;

const isOutputTextContentPart = (
  part: unknown
): part is OutputTextContentPart => {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    part.type === "output_text" &&
    "text" in part &&
    typeof part.text === "string" &&
    "annotations" in part &&
    Array.isArray(part.annotations) &&
    "logprobs" in part &&
    Array.isArray(part.logprobs)
  );
};

const isRefusalContentPart = (part: unknown): part is RefusalContentPart => {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    part.type === "refusal" &&
    "refusal" in part &&
    typeof part.refusal === "string"
  );
};

const getOutputTextStartedPartOrThrow = (
  itemId: string,
  part: unknown
): OutputTextContentPart => {
  if (!isOutputTextContentPart(part)) {
    throw new Error(
      `Invariant violation: expected output_text for canonical item "${itemId}"`
    );
  }

  return part;
};

const getRefusalStartedPartOrThrow = (
  itemId: string,
  part: unknown
): RefusalContentPart => {
  if (!isRefusalContentPart(part)) {
    throw new Error(
      `Invariant violation: expected refusal for canonical item "${itemId}"`
    );
  }

  return part;
};

const createStartedEvents = (
  context: SerializerContext,
  itemId: string,
  item: Extract<
    OpenResponsesEvent,
    { type: "response.output_item.added" }
  >["item"],
  part: ContentPartEventPart
): OpenResponsesEvent[] => {
  const outputIndex = nextOutputIndex(context, itemId);
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
      item_id: itemId,
      output_index: outputIndex,
      content_index: 0,
      part,
    }
  );

  return events;
};

const serializeMessageStarted = (
  event: Extract<InternalSemanticEvent, { type: "message.started" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
  const item = context.accumulator.startTextMessageItem({ id: event.itemId });
  const part = getOutputTextStartedPartOrThrow(event.itemId, item.content[0]);
  return createStartedEvents(context, event.itemId, item, asContentPart(part));
};

const serializeTextDelta = (
  event: Extract<InternalSemanticEvent, { type: "text.delta" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
  const outputIndex = getOutputIndexOrThrow(context, event.itemId, event.type);
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
};

const serializeTextCompleted = (
  event: Extract<InternalSemanticEvent, { type: "text.completed" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
  const outputIndex = getOutputIndexOrThrow(context, event.itemId, event.type);
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
};

const serializeRefusalStarted = (
  event: Extract<InternalSemanticEvent, { type: "refusal.started" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
  const item = context.accumulator.startRefusalMessageItem({
    id: event.itemId,
  });
  const part = getRefusalStartedPartOrThrow(event.itemId, item.content[0]);
  return createStartedEvents(context, event.itemId, item, asContentPart(part));
};

const serializeRefusalDelta = (
  event: Extract<InternalSemanticEvent, { type: "refusal.delta" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
  const outputIndex = getOutputIndexOrThrow(context, event.itemId, event.type);
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
};

const serializeRefusalCompleted = (
  event: Extract<InternalSemanticEvent, { type: "refusal.completed" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
  const outputIndex = getOutputIndexOrThrow(context, event.itemId, event.type);
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
};

const serializeReasoningStarted = (
  event: Extract<InternalSemanticEvent, { type: "reasoning.started" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
  const item = context.accumulator.startReasoningItem({ id: event.itemId });
  return createStartedEvents(context, event.itemId, item, {
    type: "reasoning_text",
    text: "",
  });
};

const serializeReasoningDelta = (
  event: Extract<InternalSemanticEvent, { type: "reasoning.delta" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
  const outputIndex = getOutputIndexOrThrow(context, event.itemId, event.type);
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
};

const serializeReasoningCompleted = (
  event: Extract<InternalSemanticEvent, { type: "reasoning.completed" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
  const outputIndex = getOutputIndexOrThrow(context, event.itemId, event.type);
  for (const summaryText of event.summaryTexts ?? []) {
    context.accumulator.appendReasoningSummary(event.itemId, summaryText);
  }
  const finalizedItem = context.accumulator.finalizeReasoningItem(event.itemId);
  const reasoningText = finalizedItem.content?.[0];

  if (!reasoningText || reasoningText.type !== "reasoning_text") {
    throw new Error(
      `Invariant violation: expected reasoning_text for canonical item "${event.itemId}"`
    );
  }

  const events: OpenResponsesEvent[] = [
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
  ];

  for (const [summaryIndex, summaryPart] of finalizedItem.summary.entries()) {
    const summaryText =
      summaryPart.type === "summary_text" ? summaryPart.text : "";
    events.push(
      {
        type: "response.reasoning_summary_part.added",
        sequence_number: context.sequence.next(),
        item_id: event.itemId,
        output_index: outputIndex,
        summary_index: summaryIndex,
        part: summaryPart,
      },
      {
        type: "response.reasoning_summary_text.delta",
        sequence_number: context.sequence.next(),
        item_id: event.itemId,
        output_index: outputIndex,
        summary_index: summaryIndex,
        delta: summaryText,
      },
      {
        type: "response.reasoning_summary_text.done",
        sequence_number: context.sequence.next(),
        item_id: event.itemId,
        output_index: outputIndex,
        summary_index: summaryIndex,
        text: summaryText,
      },
      {
        type: "response.reasoning_summary_part.done",
        sequence_number: context.sequence.next(),
        item_id: event.itemId,
        output_index: outputIndex,
        summary_index: summaryIndex,
        part: summaryPart,
      }
    );
  }

  events.push({
    type: "response.output_item.done",
    sequence_number: context.sequence.next(),
    output_index: outputIndex,
    item: finalizedItem,
  });

  return events;
};

const serializeAnnotationAdded = (
  event: Extract<
    InternalSemanticEvent,
    { type: "output_text.annotation.added" }
  >,
  context: SerializerContext
): OpenResponsesEvent[] => {
  const outputIndex = getOutputIndexOrThrow(context, event.itemId, event.type);
  context.accumulator.addOutputTextAnnotation(event.itemId, event.annotation);
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
};

const serializeFunctionCallStarted = (
  event: Extract<InternalSemanticEvent, { type: "function_call.started" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
  const events: OpenResponsesEvent[] = [];
  const inProgressEvent = ensureInProgressEvent(context);
  if (inProgressEvent) {
    events.push(inProgressEvent);
  }

  const item = context.accumulator.startFunctionCallItem({
    id: event.itemId,
    name: event.name,
    callId: event.callId,
    ...(event.arguments !== undefined ? { arguments: event.arguments } : {}),
  });
  const outputIndex = nextOutputIndex(context, event.itemId);
  events.push({
    type: "response.output_item.added",
    sequence_number: context.sequence.next(),
    output_index: outputIndex,
    item,
  });

  return events;
};

const serializeFunctionCallArgumentsDelta = (
  event: Extract<
    InternalSemanticEvent,
    { type: "function_call_arguments.delta" }
  >,
  context: SerializerContext
): OpenResponsesEvent[] => {
  const outputIndex = getOutputIndexOrThrow(context, event.itemId, event.type);
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
};

const serializeFunctionCallCompleted = (
  event: Extract<InternalSemanticEvent, { type: "function_call.completed" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
  const outputIndex = getOutputIndexOrThrow(context, event.itemId, event.type);
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
};

const serializeFunctionCallOutputCompleted = (
  event: Extract<
    InternalSemanticEvent,
    { type: "function_call_output.completed" }
  >,
  context: SerializerContext
): OpenResponsesEvent[] => {
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
};

const serializeRunCompleted = (
  event: Extract<InternalSemanticEvent, { type: "run.completed" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
  if (event.runId !== context.responseId) {
    return [];
  }

  if (context.lifecycle.getStatus() === "queued") {
    context.lifecycle.start();
  }
  context.lifecycle.complete();
  return [emitLifecycleEvent("response.completed", context, "completed")];
};

const serializeRunFailed = (
  event: Extract<InternalSemanticEvent, { type: "run.failed" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
  if (event.runId !== context.responseId) {
    return [];
  }

  const errorObject = errorToErrorObject(event.error);
  context.accumulator.finalizeOpenItemsAsIncomplete();
  if (context.lifecycle.getStatus() === "queued") {
    context.lifecycle.start();
  }
  context.lifecycle.fail(errorObject);
  return emitFailedTerminalEvents(context, errorObject);
};

const serializeRunIncomplete = (
  event: Extract<InternalSemanticEvent, { type: "run.incomplete" }>,
  context: SerializerContext
): OpenResponsesEvent[] => {
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
    case "message.started":
      return serializeMessageStarted(event, context);
    case "text.delta":
      return serializeTextDelta(event, context);
    case "text.completed":
      return serializeTextCompleted(event, context);
    case "refusal.started":
      return serializeRefusalStarted(event, context);
    case "refusal.delta":
      return serializeRefusalDelta(event, context);
    case "refusal.completed":
      return serializeRefusalCompleted(event, context);
    case "reasoning.started":
      return serializeReasoningStarted(event, context);
    case "reasoning.delta":
      return serializeReasoningDelta(event, context);
    case "reasoning.completed":
      return serializeReasoningCompleted(event, context);
    case "output_text.annotation.added":
      return serializeAnnotationAdded(event, context);
    case "function_call.started":
      return serializeFunctionCallStarted(event, context);
    case "function_call_arguments.delta":
      return serializeFunctionCallArgumentsDelta(event, context);
    case "function_call.completed":
      return serializeFunctionCallCompleted(event, context);
    case "function_call_output.completed":
      return serializeFunctionCallOutputCompleted(event, context);
    case "run.completed":
      return serializeRunCompleted(event, context);
    case "run.failed":
      return serializeRunFailed(event, context);
    case "run.incomplete":
      return serializeRunIncomplete(event, context);
    case "tool.started":
    case "tool.completed":
    case "tool.error":
      return [];
    default:
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
      for (const event of emitFailedTerminalEvents(context, errorObject)) {
        yield validateOutgoingEvent(event);
      }
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
