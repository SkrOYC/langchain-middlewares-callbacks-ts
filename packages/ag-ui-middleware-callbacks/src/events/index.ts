/**
 * AG-UI Protocol Event Types
 *
 * This module provides type definitions for the AG-UI protocol events.
 * It maintains backward compatibility with existing code while leveraging
 * @ag-ui/core for validation where applicable.
 * 
 * Based on the AG-UI protocol specification:
 * - Lifecycle Events: RUN_STARTED, RUN_FINISHED, RUN_ERROR, STEP_STARTED, STEP_FINISHED
 * - Text Message Events: TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT, TEXT_MESSAGE_END
 * - Tool Call Events: TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END, TOOL_CALL_RESULT, TOOL_CALL_CHUNK
 * - State Events: STATE_SNAPSHOT, STATE_DELTA, MESSAGES_SNAPSHOT
 * - Activity Events: ACTIVITY_SNAPSHOT, ACTIVITY_DELTA
 * - Thinking Events: THINKING_START, THINKING_TEXT_MESSAGE_START, THINKING_TEXT_MESSAGE_CONTENT, THINKING_TEXT_MESSAGE_END, THINKING_END
 * - Special Events: RAW, CUSTOM
 * 
 * @see https://docs.ag-ui.com/introduction
 * @packageDocumentation
 */

import type { Operation } from "fast-json-patch";
import type { EventType } from '@ag-ui/core';

// ============================================================================
// Re-export @ag-ui/core types and schemas for optional validation
// ============================================================================

export {
  EventType,
  EventSchemas,
  MessageSchema as AGUICoreMessageSchema,
  ToolCallSchema as AGUICoreToolCallSchema,
} from '@ag-ui/core';

// ============================================================================
// Message Types (backward compatible with existing code)
// ============================================================================

export type MessageRole = "developer" | "system" | "assistant" | "user" | "tool" | "activity";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  id: string;
  role: MessageRole;
  content?: string;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  error?: string;
}

// ============================================================================
// Lifecycle Events
// ============================================================================

export interface RunStartedEvent {
  type: EventType.RUN_STARTED;
  threadId: string;
  runId: string;
  parentRunId?: string;
  input?: unknown;
  timestamp?: number;
}

export interface RunFinishedEvent {
  type: EventType.RUN_FINISHED;
  threadId: string;
  runId: string;
  result?: unknown;
  timestamp?: number;
}

export interface RunErrorEvent {
  type: EventType.RUN_ERROR;
  message: string;
  code?: string;
  timestamp?: number;
}

export interface StepStartedEvent {
  type: EventType.STEP_STARTED;
  stepName: string;
  timestamp?: number;
}

export interface StepFinishedEvent {
  type: EventType.STEP_FINISHED;
  stepName: string;
  timestamp?: number;
}

// ============================================================================
// Text Message Events
// ============================================================================

export interface TextMessageStartEvent {
  type: EventType.TEXT_MESSAGE_START;
  messageId: string;
  role?: "developer" | "system" | "assistant" | "user";
  timestamp?: number;
}

export interface TextMessageContentEvent {
  type: EventType.TEXT_MESSAGE_CONTENT;
  messageId: string;
  delta: string;
  timestamp?: number;
}

export interface TextMessageEndEvent {
  type: EventType.TEXT_MESSAGE_END;
  messageId: string;
  timestamp?: number;
}

/**
 * TextMessageChunk (convenience): Auto-expands to Start → Content → End
 */
export interface TextMessageChunkEvent {
  type: EventType.TEXT_MESSAGE_CHUNK;
  messageId?: string;
  role?: "developer" | "system" | "assistant" | "user";
  delta?: string;
  timestamp?: number;
}

// ============================================================================
// Tool Call Events
// ============================================================================

export interface ToolCallStartEvent {
  type: EventType.TOOL_CALL_START;
  toolCallId: string;
  toolCallName: string;
  parentMessageId?: string;
  timestamp?: number;
}

export interface ToolCallArgsEvent {
  type: EventType.TOOL_CALL_ARGS;
  toolCallId: string;
  delta: string;
  timestamp?: number;
}

export interface ToolCallEndEvent {
  type: EventType.TOOL_CALL_END;
  toolCallId: string;
  timestamp?: number;
}

export interface ToolCallResultEvent {
  type: EventType.TOOL_CALL_RESULT;
  messageId: string;
  toolCallId: string;
  content: string;
  role?: "tool";
  timestamp?: number;
}

/**
 * ToolCallChunk (convenience): Auto-expands to Start → Args → End
 */
export interface ToolCallChunkEvent {
  type: EventType.TOOL_CALL_CHUNK;
  toolCallId?: string;
  toolCallName?: string;
  parentMessageId?: string;
  delta?: string;
  timestamp?: number;
}

// ============================================================================
// State Events
// ============================================================================

export interface StateSnapshotEvent {
  type: EventType.STATE_SNAPSHOT;
  snapshot: unknown;
  timestamp?: number;
}

export interface StateDeltaEvent {
  type: EventType.STATE_DELTA;
  delta: Operation[];
  timestamp?: number;
}

export interface MessagesSnapshotEvent {
  type: EventType.MESSAGES_SNAPSHOT;
  messages: Message[];
  timestamp?: number;
}

// ============================================================================
// Activity Events
// ============================================================================

export interface ActivitySnapshotEvent {
  type: EventType.ACTIVITY_SNAPSHOT;
  messageId: string;
  activityType: string;
  content: Record<string, unknown>;
  replace?: boolean;
  timestamp?: number;
}

export interface ActivityDeltaEvent {
  type: EventType.ACTIVITY_DELTA;
  messageId: string;
  activityType: string;
  patch: Operation[];
  timestamp?: number;
}

// ============================================================================
// Thinking Events
// ============================================================================

export interface ThinkingStartEvent {
  type: EventType.THINKING_START;
  title?: string;
  messageId?: string;
  timestamp?: number;
}

export interface ThinkingTextMessageStartEvent {
  type: EventType.THINKING_TEXT_MESSAGE_START;
  messageId: string;
  timestamp?: number;
}

export interface ThinkingTextMessageContentEvent {
  type: EventType.THINKING_TEXT_MESSAGE_CONTENT;
  messageId: string;
  delta: string;
  timestamp?: number;
}

export interface ThinkingTextMessageEndEvent {
  type: EventType.THINKING_TEXT_MESSAGE_END;
  messageId: string;
  timestamp?: number;
}

export interface ThinkingEndEvent {
  type: EventType.THINKING_END;
  timestamp?: number;
}

// ============================================================================
// Special Events
// ============================================================================

export interface RawEvent {
  type: EventType.RAW;
  event: unknown;
  source?: string;
}

/**
 * Custom event for application-specific functionality.
 * Allows passing arbitrary named events with any payload.
 */
export interface CustomEvent {
  type: EventType.CUSTOM;
  name: string;
  value: unknown;
}

// ============================================================================
// Union type for all AG-UI events
// ============================================================================

export type AGUIEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | StepStartedEvent
  | StepFinishedEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | TextMessageChunkEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | ToolCallChunkEvent
  | StateSnapshotEvent
  | StateDeltaEvent
  | MessagesSnapshotEvent
  | ActivitySnapshotEvent
  | ActivityDeltaEvent
  | ThinkingStartEvent
  | ThinkingTextMessageStartEvent
  | ThinkingTextMessageContentEvent
  | ThinkingTextMessageEndEvent
  | ThinkingEndEvent
  | RawEvent
  | CustomEvent;
