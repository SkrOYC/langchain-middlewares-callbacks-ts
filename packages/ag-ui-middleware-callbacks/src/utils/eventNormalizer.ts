import type {
  AGUIEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
} from "../events";
import { generateId } from "./idGenerator";

/**
 * Normalizes and expands convenience events into their explicit counterparts.
 *
 * @param event - The event to expand
 * @returns An array of explicit AG-UI events
 */
export function expandEvent(event: AGUIEvent): AGUIEvent[] {
  switch (event.type) {
    case "TEXT_MESSAGE_CHUNK": {
      const messageId = event.messageId || generateId();
      const results: AGUIEvent[] = [];

      if (event.role) {
        results.push({
          type: "TEXT_MESSAGE_START",
          messageId,
          role: event.role,
        } as TextMessageStartEvent);
      }

      if (event.delta) {
        results.push({
          type: "TEXT_MESSAGE_CONTENT",
          messageId,
          delta: event.delta,
        } as TextMessageContentEvent);
      }

      // If it has a role and delta, we assume it's a complete short message
      if (event.role && event.delta) {
        results.push({
          type: "TEXT_MESSAGE_END",
          messageId,
        } as TextMessageEndEvent);
      }

      return results.length > 0 ? results : [event];
    }

    case "TOOL_CALL_CHUNK": {
      const toolCallId = event.toolCallId || generateId();
      const results: AGUIEvent[] = [];

      if (event.toolCallName) {
        results.push({
          type: "TOOL_CALL_START",
          toolCallId,
          toolCallName: event.toolCallName,
          parentMessageId: event.parentMessageId,
        } as ToolCallStartEvent);
      }

      if (event.delta) {
        results.push({
          type: "TOOL_CALL_ARGS",
          toolCallId,
          delta: event.delta,
        } as ToolCallArgsEvent);
      }

      if (event.toolCallName && event.delta) {
        results.push({
          type: "TOOL_CALL_END",
          toolCallId,
          parentMessageId: event.parentMessageId,
        } as ToolCallEndEvent);
      }

      return results.length > 0 ? results : [event];
    }

    default:
      return [event];
  }
}
