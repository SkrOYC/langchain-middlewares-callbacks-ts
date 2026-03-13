import { type BaseEvent, EventType } from "@ag-ui/core";
import { validateEvent } from "../utils/validation";
import {
  type AGUIEventSerializer,
  resolvePublisherSerializer,
} from "./serializer";

export type AGUIRunPublisherValidationMode = boolean | "strict";
export type AGUIRunPublisherListener = (event: BaseEvent) => void;

export interface AGUIRunPublisherConfig {
  serializer?: AGUIEventSerializer;
  transport?: "sse";
  validateEvents?: AGUIRunPublisherValidationMode;
}

export interface AGUIRunPublisher {
  publish(event: BaseEvent): void;
  complete(result?: unknown): void;
  error(error: unknown): void;
  subscribe(listener: AGUIRunPublisherListener): () => void;
  toReadableStream(): ReadableStream<Uint8Array>;
}

interface RunContext {
  runId: string;
  threadId: string;
}

interface RunErrorLike {
  code?: unknown;
  message?: unknown;
}

function isValidationEnabled(mode: AGUIRunPublisherValidationMode): boolean {
  return mode === true || mode === "strict";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const candidate = value[field];
  return typeof candidate === "string" ? candidate : undefined;
}

function getRunContext(event: BaseEvent): RunContext | undefined {
  const runId = getStringField(event, "runId");
  const threadId = getStringField(event, "threadId");
  if (!runId || typeof threadId === "undefined") {
    return undefined;
  }

  return {
    runId,
    threadId,
  };
}

function toRunError(error: unknown): { message: string; code?: string } {
  if (typeof error === "string") {
    return { message: error };
  }

  if (error instanceof Error) {
    const code =
      typeof (error as RunErrorLike).code === "string"
        ? ((error as RunErrorLike).code as string)
        : undefined;

    return {
      message: error.message,
      code,
    };
  }

  if (isRecord(error)) {
    const message =
      typeof error.message === "string"
        ? error.message
        : "Agent execution failed";
    const code = typeof error.code === "string" ? error.code : undefined;

    return {
      message,
      code,
    };
  }

  return {
    message: "Agent execution failed",
  };
}

export function createAGUIRunPublisher(
  config: AGUIRunPublisherConfig = {}
): AGUIRunPublisher {
  const serializer = resolvePublisherSerializer(
    config.serializer,
    config.transport ?? "sse"
  );
  const validateEvents = config.validateEvents ?? false;
  const subscribers = new Set<AGUIRunPublisherListener>();
  const streamControllers = new Set<
    ReadableStreamDefaultController<Uint8Array>
  >();
  const eventHistory: BaseEvent[] = [];
  const pendingBeforeStart: BaseEvent[] = [];
  const openTextMessages = new Set<string>();
  const openToolCalls = new Set<string>();
  const openReasoningMessages = new Set<string>();
  const openReasoningPhases = new Set<string>();

  let hasStarted = false;
  let isTerminal = false;
  let runContext: RunContext | undefined;

  const emit = (event: BaseEvent) => {
    if (isValidationEnabled(validateEvents)) {
      const result = validateEvent(event);
      if (!result.success) {
        if (validateEvents === "strict") {
          throw new Error(`Invalid AG-UI event: ${result.error?.message}`);
        }

        console.warn(
          "[AG-UI Validation] Invalid event:",
          event.type,
          result.error
        );
      }
    }

    eventHistory.push(event);

    for (const subscriber of subscribers) {
      subscriber(event);
    }

    const chunk = serializer(event);
    for (const controller of streamControllers) {
      controller.enqueue(chunk);
    }
  };

  const closeOpenStreams = () => {
    for (const messageId of [...openTextMessages]) {
      openTextMessages.delete(messageId);
      emit({
        type: EventType.TEXT_MESSAGE_END,
        messageId,
        timestamp: Date.now(),
      } as BaseEvent);
    }

    for (const toolCallId of [...openToolCalls]) {
      openToolCalls.delete(toolCallId);
      emit({
        type: EventType.TOOL_CALL_END,
        toolCallId,
        timestamp: Date.now(),
      } as BaseEvent);
    }

    for (const messageId of [...openReasoningMessages]) {
      openReasoningMessages.delete(messageId);
      emit({
        type: EventType.REASONING_MESSAGE_END,
        messageId,
        timestamp: Date.now(),
      } as BaseEvent);
    }

    for (const messageId of [...openReasoningPhases]) {
      openReasoningPhases.delete(messageId);
      emit({
        type: EventType.REASONING_END,
        messageId,
        timestamp: Date.now(),
      } as BaseEvent);
    }
  };

  const finalize = (event: BaseEvent) => {
    if (isTerminal) {
      return;
    }

    closeOpenStreams();
    isTerminal = true;
    emit(event);

    for (const controller of streamControllers) {
      controller.close();
    }
    streamControllers.clear();
  };

  const publishStarted = (event: BaseEvent) => {
    if (isTerminal || hasStarted) {
      return;
    }

    hasStarted = true;
    runContext = getRunContext(event);
    emit(event);

    while (pendingBeforeStart.length > 0 && !isTerminal) {
      const nextEvent = pendingBeforeStart.shift();
      if (nextEvent) {
        publishInternal(nextEvent);
      }
    }
  };

  const emitStartedEvent = (
    event: BaseEvent,
    openEvents: Set<string>,
    idField: "messageId" | "toolCallId"
  ): boolean => {
    const eventId = getStringField(event, idField);
    if (!(eventId && !openEvents.has(eventId))) {
      return false;
    }

    openEvents.add(eventId);
    emit(event);
    return true;
  };

  const emitOngoingEvent = (
    event: BaseEvent,
    openEvents: Set<string>,
    idField: "messageId" | "toolCallId"
  ): boolean => {
    const eventId = getStringField(event, idField);
    if (!(eventId && openEvents.has(eventId))) {
      return false;
    }

    emit(event);
    return true;
  };

  const emitEndedEvent = (
    event: BaseEvent,
    openEvents: Set<string>,
    idField: "messageId" | "toolCallId"
  ): boolean => {
    const eventId = getStringField(event, idField);
    if (!(eventId && openEvents.has(eventId))) {
      return false;
    }

    openEvents.delete(eventId);
    emit(event);
    return true;
  };

  const handleTextEvent = (event: BaseEvent): boolean => {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_START:
        return emitStartedEvent(event, openTextMessages, "messageId");
      case EventType.TEXT_MESSAGE_CONTENT:
        return emitOngoingEvent(event, openTextMessages, "messageId");
      case EventType.TEXT_MESSAGE_END:
        return emitEndedEvent(event, openTextMessages, "messageId");
      default:
        return false;
    }
  };

  const handleToolEvent = (event: BaseEvent): boolean => {
    switch (event.type) {
      case EventType.TOOL_CALL_START:
        return emitStartedEvent(event, openToolCalls, "toolCallId");
      case EventType.TOOL_CALL_ARGS:
        return emitOngoingEvent(event, openToolCalls, "toolCallId");
      case EventType.TOOL_CALL_END:
        return emitEndedEvent(event, openToolCalls, "toolCallId");
      default:
        return false;
    }
  };

  const handleReasoningEvent = (event: BaseEvent): boolean => {
    switch (event.type) {
      case EventType.REASONING_START:
        return emitStartedEvent(event, openReasoningPhases, "messageId");
      case EventType.REASONING_END:
        return emitEndedEvent(event, openReasoningPhases, "messageId");
      case EventType.REASONING_MESSAGE_START:
        return emitStartedEvent(event, openReasoningMessages, "messageId");
      case EventType.REASONING_MESSAGE_CONTENT:
        return emitOngoingEvent(event, openReasoningMessages, "messageId");
      case EventType.REASONING_MESSAGE_END:
        return emitEndedEvent(event, openReasoningMessages, "messageId");
      default:
        return false;
    }
  };

  const handleTerminalEvent = (event: BaseEvent): boolean => {
    if (event.type === EventType.RUN_ERROR) {
      finalize(event);
      return true;
    }

    if (event.type !== EventType.RUN_FINISHED) {
      return false;
    }

    const context = getRunContext(event) ?? runContext;
    finalize({
      ...event,
      runId: context?.runId ?? getStringField(event, "runId"),
      threadId: context?.threadId ?? getStringField(event, "threadId"),
    } as BaseEvent);
    return true;
  };

  const publishInternal = (event: BaseEvent) => {
    if (isTerminal) {
      return;
    }

    if (event.type === EventType.RUN_STARTED) {
      publishStarted(event);
      return;
    }

    if (!hasStarted) {
      pendingBeforeStart.push(event);
      return;
    }

    if (handleTextEvent(event)) {
      return;
    }

    if (handleToolEvent(event)) {
      return;
    }

    if (handleReasoningEvent(event)) {
      return;
    }

    if (handleTerminalEvent(event)) {
      return;
    }

    emit(event);
  };

  return {
    publish(event) {
      publishInternal(event);
    },

    complete(result) {
      if (isTerminal) {
        return;
      }

      if (!runContext) {
        throw new Error(
          "Cannot complete a run that has not been started. A `RUN_STARTED` event must be published first."
        );
      }

      finalize({
        type: EventType.RUN_FINISHED,
        threadId: runContext.threadId,
        runId: runContext.runId,
        result,
        timestamp: Date.now(),
      } as BaseEvent);
    },

    error(error) {
      if (isTerminal) {
        return;
      }

      const runError = toRunError(error);
      finalize({
        type: EventType.RUN_ERROR,
        message: runError.message,
        code: runError.code,
        timestamp: Date.now(),
      } as BaseEvent);
    },

    subscribe(listener) {
      subscribers.add(listener);

      return () => {
        subscribers.delete(listener);
      };
    },

    toReadableStream() {
      let streamController:
        | ReadableStreamDefaultController<Uint8Array>
        | undefined;

      return new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;

          for (const event of eventHistory) {
            controller.enqueue(serializer(event));
          }

          if (isTerminal) {
            controller.close();
            return;
          }

          streamControllers.add(controller);
        },
        cancel() {
          if (streamController) {
            streamControllers.delete(streamController);
          }
        },
      });
    },
  };
}
