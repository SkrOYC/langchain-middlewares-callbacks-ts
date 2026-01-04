/**
 * AG-UI Protocol Event Types
 * 
 * Based on the AG-UI protocol specification:
 * - Lifecycle Events: RUN_STARTED, RUN_FINISHED, RUN_ERROR, STEP_STARTED, STEP_FINISHED
 * - Text Message Events: TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT, TEXT_MESSAGE_END
 * - Tool Call Events: TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END, TOOL_CALL_RESULT, TOOL_CALL_CHUNK
 * - State Events: STATE_SNAPSHOT, STATE_DELTA, MESSAGES_SNAPSHOT
 */

// Lifecycle Events
export interface RunStartedEvent {
  type: "RUN_STARTED";
  threadId?: string;
  runId?: string;
  parentRunId?: string;
  input?: unknown;
}

export interface RunFinishedEvent {
  type: "RUN_FINISHED";
  threadId?: string;
  runId?: string;
}

export interface RunErrorEvent {
  type: "RUN_ERROR";
  threadId?: string;
  runId?: string;
  message?: string;
  code?: string;
  stack?: string;
}

export interface StepStartedEvent {
  type: "STEP_STARTED";
  stepIndex?: number;
}

export interface StepFinishedEvent {
  type: "STEP_FINISHED";
  stepIndex?: number;
}

// Text Message Events
export interface TextMessageStartEvent {
  type: "TEXT_MESSAGE_START";
  messageId: string;
  role: "assistant" | "user" | "system";
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
  content: string;
  role: "tool";
  parentMessageId?: string;
}

export interface ToolCallChunkEvent {
  type: "TOOL_CALL_CHUNK";
  toolCallId: string;
  chunk: string;
  index: number;
  parentMessageId?: string;
}

// State Events
export interface StateSnapshotEvent {
  type: "STATE_SNAPSHOT";
  snapshot: unknown;
}

export interface StateDeltaEvent {
  type: "STATE_DELTA";
  delta: unknown[];
}

export interface MessagesSnapshotEvent {
  type: "MESSAGES_SNAPSHOT";
  messages: unknown[];
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
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | ToolCallChunkEvent
  | StateSnapshotEvent
  | StateDeltaEvent
  | MessagesSnapshotEvent;
