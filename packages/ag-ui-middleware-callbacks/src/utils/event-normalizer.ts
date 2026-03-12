import { type BaseEvent, EventType } from "../events";
import { generateId } from "./id-generator";

type TextMessageChunkEventLike = BaseEvent & {
  messageId?: string;
  role?: "assistant" | "user" | "system" | "developer";
  delta?: string;
};

type ToolCallChunkEventLike = BaseEvent & {
  toolCallId?: string;
  toolCallName?: string;
  parentMessageId?: string;
  delta?: string;
};

function expandTextMessageChunk(
  event: BaseEvent,
  chunkEvent: TextMessageChunkEventLike
): BaseEvent[] {
  const messageId = chunkEvent.messageId || generateId();
  const results: BaseEvent[] = [];

  if (chunkEvent.role) {
    results.push({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: chunkEvent.role,
    } as unknown as BaseEvent);
  }

  if (chunkEvent.delta) {
    results.push({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: chunkEvent.delta,
    } as unknown as BaseEvent);
  }

  if (chunkEvent.role && chunkEvent.delta) {
    results.push({
      type: EventType.TEXT_MESSAGE_END,
      messageId,
    } as unknown as BaseEvent);
  }

  return results.length > 0 ? results : [event];
}

function expandToolCallChunk(
  event: BaseEvent,
  chunkEvent: ToolCallChunkEventLike
): BaseEvent[] {
  const toolCallId = chunkEvent.toolCallId || generateId();
  const results: BaseEvent[] = [];

  if (chunkEvent.toolCallName) {
    results.push({
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: chunkEvent.toolCallName,
      parentMessageId: chunkEvent.parentMessageId,
    } as unknown as BaseEvent);
  }

  if (chunkEvent.delta) {
    results.push({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: chunkEvent.delta,
    } as unknown as BaseEvent);
  }

  if (chunkEvent.toolCallName && chunkEvent.delta) {
    results.push({
      type: EventType.TOOL_CALL_END,
      toolCallId,
      parentMessageId: chunkEvent.parentMessageId,
    } as unknown as BaseEvent);
  }

  return results.length > 0 ? results : [event];
}

/**
 * Normalizes and expands convenience events into their explicit counterparts.
 *
 * @param event - The event to expand
 * @returns An array of explicit AG-UI events
 */
export function expandEvent(event: BaseEvent): BaseEvent[] {
  switch (event.type) {
    case EventType.TEXT_MESSAGE_CHUNK:
      return expandTextMessageChunk(event, event as TextMessageChunkEventLike);

    case EventType.TOOL_CALL_CHUNK:
      return expandToolCallChunk(event, event as ToolCallChunkEventLike);

    default:
      return [event];
  }
}
