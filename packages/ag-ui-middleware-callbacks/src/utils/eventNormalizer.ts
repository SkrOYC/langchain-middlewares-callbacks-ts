import type {
  AGUIEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageChunkEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallChunkEvent,
} from "../events";
import { EventType } from "../events";
import { generateId } from "./idGenerator";

/**
 * Normalizes and expands convenience events into their explicit counterparts.
 *
 * @param event - The event to expand
 * @returns An array of explicit AG-UI events
 */
export function expandEvent(event: AGUIEvent): AGUIEvent[] {
  switch (event.type) {
    case EventType.TEXT_MESSAGE_CHUNK: {
      const chunkEvent = event as TextMessageChunkEvent;
      const messageId = chunkEvent.messageId || generateId();
      const results: AGUIEvent[] = [];

      if (chunkEvent.role) {
        results.push({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: chunkEvent.role,
        } as TextMessageStartEvent);
      }

      if (chunkEvent.delta) {
        results.push({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: chunkEvent.delta,
        } as TextMessageContentEvent);
      }

      // If it has a role and delta, we assume it's a complete short message
      if (chunkEvent.role && chunkEvent.delta) {
        results.push({
          type: EventType.TEXT_MESSAGE_END,
          messageId,
        } as TextMessageEndEvent);
      }

      return results.length > 0 ? results : [event];
    }

    case EventType.TOOL_CALL_CHUNK: {
      const chunkEvent = event as ToolCallChunkEvent;
      const toolCallId = chunkEvent.toolCallId || generateId();
      const results: AGUIEvent[] = [];

      if (chunkEvent.toolCallName) {
        results.push({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: chunkEvent.toolCallName,
          parentMessageId: chunkEvent.parentMessageId,
        } as ToolCallStartEvent);
      }

      if (chunkEvent.delta) {
        results.push({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: chunkEvent.delta,
        } as ToolCallArgsEvent);
      }

      if (chunkEvent.toolCallName && chunkEvent.delta) {
        results.push({
          type: EventType.TOOL_CALL_END,
          toolCallId,
          parentMessageId: chunkEvent.parentMessageId,
        } as ToolCallEndEvent);
      }

      return results.length > 0 ? results : [event];
    }

    default:
      return [event];
  }
}
