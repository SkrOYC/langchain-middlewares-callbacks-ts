/**
 * Event Serializer + SSE Framing
 *
 * Converts internal semantic events into public Open Responses events
 * with response-scoped sequence numbers, and formats SSE frames.
 */

import {
  agentExecutionFailed,
  type InternalError,
  internalErrorToPublicError,
} from "@/core/errors.js";
import type { InternalSemanticEvent } from "@/core/events.js";
import {
  type OpenResponsesEvent,
  OpenResponsesEventSchema,
} from "@/core/schemas.js";
import type { SequenceGenerator, SSEFrame } from "@/core/types.js";
import type { AsyncEventQueue } from "@/state/async-event-queue.js";
import type { CanonicalItemAccumulator } from "@/state/item-accumulator.js";
import type { ResponseLifecycle } from "@/state/response-lifecycle.js";
import { isInternalError } from "./previous-response.js";

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

const shouldValidateOutgoingEvents = (): boolean => {
  return process.env.NODE_ENV !== "production";
};

export const validateOutgoingEvent = (
  event: OpenResponsesEvent
): OpenResponsesEvent => {
  if (!shouldValidateOutgoingEvents()) {
    return event;
  }

  return OpenResponsesEventSchema.parse(event);
};

export interface SerializerContext {
  accumulator: CanonicalItemAccumulator;
  sequence: SequenceGenerator;
  responseId: string;
  lifecycle: ResponseLifecycle;
  inProgressEmitted: { value: boolean };
  itemOutputIndices: Map<string, number>;
}

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

const ensureInProgress = (
  context: SerializerContext
): OpenResponsesEvent | null => {
  if (context.inProgressEmitted.value) {
    return null;
  }

  if (context.lifecycle.getStatus() === "queued") {
    context.lifecycle.start();
  }

  context.inProgressEmitted.value = true;

  return {
    type: "response.in_progress",
    sequence_number: context.sequence.next(),
    response: {
      id: context.responseId,
      object: "response" as const,
      status: "in_progress" as const,
    },
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

export const serializeInternalEvent = (
  event: InternalSemanticEvent,
  context: SerializerContext
): OpenResponsesEvent[] => {
  switch (event.type) {
    case "run.started": {
      const inProgressEvent = ensureInProgress(context);
      return inProgressEvent ? [inProgressEvent] : [];
    }

    case "message.started": {
      const events: OpenResponsesEvent[] = [];

      const inProgressEvent = ensureInProgress(context);
      if (inProgressEvent) {
        events.push(inProgressEvent);
      }

      const item = context.accumulator.startMessageItem({ id: event.itemId });
      const outputIndex = context.itemOutputIndices.size;
      context.itemOutputIndices.set(event.itemId, outputIndex);

      const part = context.accumulator.startOutputTextPart(event.itemId);

      events.push({
        type: "response.output_item.added",
        sequence_number: context.sequence.next(),
        output_index: outputIndex,
        item,
      });

      events.push({
        type: "response.content_part.added",
        sequence_number: context.sequence.next(),
        item_id: event.itemId,
        output_index: outputIndex,
        content_index: 0,
        part,
      });

      return events;
    }

    case "text.delta": {
      const outputIndex = getOutputIndexOrThrow(
        context,
        event.itemId,
        "text.delta"
      );
      context.accumulator.appendOutputTextDelta(event.itemId, 0, event.delta);

      return [
        {
          type: "response.output_text.delta",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          delta: event.delta,
        },
      ];
    }

    case "text.completed": {
      const outputIndex = getOutputIndexOrThrow(
        context,
        event.itemId,
        "text.completed"
      );
      const finalizedPart = context.accumulator.finalizeOutputTextPart(
        event.itemId,
        0
      );
      const finalizedItem = context.accumulator.finalizeItem(
        event.itemId,
        "completed"
      );

      return [
        {
          type: "response.output_text.done",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          text: finalizedPart.text,
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

    case "function_call.started": {
      const events: OpenResponsesEvent[] = [];

      const inProgressEvent = ensureInProgress(context);
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
      const outputIndex = context.itemOutputIndices.size;
      context.itemOutputIndices.set(event.itemId, outputIndex);

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
        "function_call_arguments.delta"
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
          content_index: 0,
          delta: event.delta,
        },
      ];
    }

    case "function_call.completed": {
      const outputIndex = getOutputIndexOrThrow(
        context,
        event.itemId,
        "function_call.completed"
      );
      const finalizedItem = context.accumulator.finalizeItem(
        event.itemId,
        "completed"
      );

      const args =
        finalizedItem.type === "function_call" ? finalizedItem.arguments : "";

      return [
        {
          type: "response.function_call_arguments.done",
          sequence_number: context.sequence.next(),
          item_id: event.itemId,
          output_index: outputIndex,
          content_index: 0,
          arguments: args,
        },
        {
          type: "response.output_item.done",
          sequence_number: context.sequence.next(),
          output_index: outputIndex,
          item: finalizedItem,
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
      return [
        {
          type: "response.completed",
          sequence_number: context.sequence.next(),
          response: {
            id: context.responseId,
            object: "response" as const,
            status: "completed" as const,
          },
        },
      ];
    }

    case "run.failed": {
      if (event.runId !== context.responseId) {
        return [];
      }

      const errorObject = errorToErrorObject(event.error);

      if (context.lifecycle.getStatus() === "queued") {
        context.lifecycle.start();
      }
      context.lifecycle.fail(errorObject);

      return [
        {
          type: "response.failed",
          sequence_number: context.sequence.next(),
          response: {
            id: context.responseId,
            object: "response" as const,
            status: "failed" as const,
          },
          error: errorObject,
        },
      ];
    }

    // Internal-only events — not published to the wire
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
  responseId: string;
}): AsyncGenerator<OpenResponsesEvent | "[DONE]"> {
  const context: SerializerContext = {
    accumulator: params.accumulator,
    sequence: createSequenceGenerator(),
    responseId: params.responseId,
    lifecycle: params.lifecycle,
    inProgressEmitted: { value: false },
    itemOutputIndices: new Map(),
  };

  try {
    for await (const event of params.queue) {
      const publicEvents = serializeInternalEvent(event, context);
      for (const publicEvent of publicEvents) {
        yield validateOutgoingEvent(publicEvent);
      }
    }
  } catch (error) {
    // Queue was fail()ed or accumulator threw — emit response.failed if still in_progress
    const status = params.lifecycle.getStatus();
    if (status === "in_progress" || status === "queued") {
      const errorObject = errorToErrorObject(error);

      if (status === "queued") {
        params.lifecycle.start();
      }
      params.lifecycle.fail(errorObject);

      yield validateOutgoingEvent({
        type: "response.failed",
        sequence_number: context.sequence.next(),
        response: {
          id: params.responseId,
          object: "response" as const,
          status: "failed" as const,
        },
        error: errorObject,
      } satisfies OpenResponsesEvent);
    }
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
