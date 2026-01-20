import { EventType, type BaseEvent } from "../events";
import { generateId } from "./idGenerator";

/**
 * Normalizes and expands convenience events into their explicit counterparts.
 *
 * @param event - The event to expand
 * @returns An array of explicit AG-UI events
 */
export function expandEvent(event: BaseEvent): BaseEvent[] {
  switch (event.type) {
    case EventType.TEXT_MESSAGE_CHUNK: {
      const chunkEvent = event as any;
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

      // If it has a role and delta, we assume it's a complete short message
      if (chunkEvent.role && chunkEvent.delta) {
        results.push({
          type: EventType.TEXT_MESSAGE_END,
          messageId,
        } as unknown as BaseEvent);
      }

      return results.length > 0 ? results : [event];
    }

    case EventType.TOOL_CALL_CHUNK: {
      const chunkEvent = event as any;
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

    default:
      return [event];
  }
}
