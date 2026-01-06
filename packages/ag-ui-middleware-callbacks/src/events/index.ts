/**
 * AG-UI Protocol Event Types
 *
 * Based on the AG-UI protocol specification:
 * - Lifecycle Events: RUN_STARTED, RUN_FINISHED, RUN_ERROR, STEP_STARTED, STEP_FINISHED
 * - Text Message Events: TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT, TEXT_MESSAGE_END
 * - Tool Call Events: TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END, TOOL_CALL_RESULT, TOOL_CALL_CHUNK
 * - State Events: STATE_SNAPSHOT, STATE_DELTA, MESSAGES_SNAPSHOT
 * - Activity Events: ACTIVITY_SNAPSHOT, ACTIVITY_DELTA
 * - Thinking Events: THINKING_START, THINKING_TEXT_MESSAGE_START, THINKING_TEXT_MESSAGE_CONTENT, THINKING_TEXT_MESSAGE_END, THINKING_END
 * - Special Events: RAW, CUSTOM
 */

import { type Operation } from "fast-json-patch";

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
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  error?: string;
}

// Lifecycle Events
export interface RunStartedEvent {
  type: "RUN_STARTED";
  threadId: string;
  runId: string;
  parentRunId?: string;
  input?: unknown;
}

export interface RunFinishedEvent {
  type: "RUN_FINISHED";
  threadId: string;
  runId: string;
  result?: unknown;
}

export interface RunErrorEvent {
  type: "RUN_ERROR";
  threadId?: string;
  runId?: string;
  parentRunId?: string;
  message: string;
  code?: string;
}

export interface StepStartedEvent {
  type: "STEP_STARTED";
  stepName: string;
  runId?: string;
  threadId?: string;
}

export interface StepFinishedEvent {
  type: "STEP_FINISHED";
  stepName: string;
  runId?: string;
  threadId?: string;
}

// Text Message Events
export interface TextMessageStartEvent {
  type: "TEXT_MESSAGE_START";
  messageId: string;
  role: MessageRole;
}

export interface TextMessageContentEvent {
  type: "TEXT_MESSAGE_CONTENT";
  messageId: string;
  delta: string;
}

export interface TextMessageEndEvent {
  type: "TEXT_MESSAGE_END";
  messageId: string;
}

/**
 * TextMessageChunk (convenience): Auto-expands to Start → Content → End
 */
export interface TextMessageChunkEvent {
  type: "TEXT_MESSAGE_CHUNK";
  messageId?: string;
  role?: MessageRole;
  delta?: string;
}

// Tool Call Events
export interface ToolCallStartEvent {
  type: "TOOL_CALL_START";
  toolCallId: string;
  toolCallName: string;
  parentMessageId?: string;
}

export interface ToolCallArgsEvent {
  type: "TOOL_CALL_ARGS";
  toolCallId: string;
  delta: unknown;
}

export interface ToolCallEndEvent {
  type: "TOOL_CALL_END";
  toolCallId: string;
  parentMessageId?: string;
}

export interface ToolCallResultEvent {
  type: "TOOL_CALL_RESULT";
  messageId: string;
  toolCallId: string;
  toolCallName?: string;
  content: string;
  role: "tool";
  parentMessageId?: string;
}

/**
 * ToolCallChunk (convenience): Auto-expands to Start → Args → End
 */
export interface ToolCallChunkEvent {
  type: "TOOL_CALL_CHUNK";
  toolCallId?: string;
  toolCallName?: string;
  parentMessageId?: string;
  delta?: unknown;
}

// State Events
export interface StateSnapshotEvent {
  type: "STATE_SNAPSHOT";
  snapshot: unknown;
}

export interface StateDeltaEvent {
  type: "STATE_DELTA";
  delta: Operation[];
}

export interface MessagesSnapshotEvent {
  type: "MESSAGES_SNAPSHOT";
  messages: Message[];
}

// Activity Events
export interface ActivitySnapshotEvent {
  type: "ACTIVITY_SNAPSHOT";
  messageId: string;
  activityType: string;
  content: unknown;
  replace?: boolean;
}

export interface ActivityDeltaEvent {
  type: "ACTIVITY_DELTA";
  messageId: string;
  activityType: string;
  patch: unknown[];
}

// Thinking Events
export interface ThinkingStartEvent {
  type: "THINKING_START";
  messageId: string;
  title?: string;
}

export interface ThinkingTextMessageStartEvent {
  type: "THINKING_TEXT_MESSAGE_START";
  messageId: string;
}

export interface ThinkingTextMessageContentEvent {
  type: "THINKING_TEXT_MESSAGE_CONTENT";
  messageId: string;
  delta: string;
}

export interface ThinkingTextMessageEndEvent {
  type: "THINKING_TEXT_MESSAGE_END";
  messageId: string;
}

export interface ThinkingTextMessageChunkEvent {
  type: "THINKING_TEXT_MESSAGE_CHUNK";
  messageId?: string;
  delta?: string;
}

export interface ThinkingEndEvent {
  type: "THINKING_END";
  messageId: string;
}

// Special Events
export interface RawEvent {
  type: "RAW";
  event: unknown;
  source?: string;
}

export interface CustomEvent {
  type: "CUSTOM";
  name: string;
  value: unknown;
}

// Union type for all AG-UI events
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
  | ThinkingTextMessageChunkEvent
  | ThinkingEndEvent
  | RawEvent
  | CustomEvent;
