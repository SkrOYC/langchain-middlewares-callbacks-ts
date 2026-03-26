/**
 * Internal semantic event types consumed by the serializer.
 *
 * These events are derived from LangChain callbacks but remain provider-agnostic.
 */

export type InternalSemanticEvent =
  | RunStartedEvent
  | MessageStartedEvent
  | TextDeltaEvent
  | TextCompletedEvent
  | RefusalStartedEvent
  | RefusalDeltaEvent
  | RefusalCompletedEvent
  | ReasoningStartedEvent
  | ReasoningDeltaEvent
  | ReasoningCompletedEvent
  | OutputTextAnnotationAddedEvent
  | FunctionCallStartedEvent
  | FunctionCallArgumentsDeltaEvent
  | FunctionCallCompletedEvent
  | FunctionCallOutputCompletedEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ToolErrorEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunIncompleteEvent;

export interface RunStartedEvent {
  type: "run.started";
  runId: string;
  parentRunId?: string;
}

export interface MessageStartedEvent {
  type: "message.started";
  itemId: string;
  runId: string;
}

export interface TextDeltaEvent {
  type: "text.delta";
  itemId: string;
  delta: string;
}

export interface TextCompletedEvent {
  type: "text.completed";
  itemId: string;
}

export interface RefusalStartedEvent {
  type: "refusal.started";
  itemId: string;
  runId: string;
}

export interface RefusalDeltaEvent {
  type: "refusal.delta";
  itemId: string;
  delta: string;
}

export interface RefusalCompletedEvent {
  type: "refusal.completed";
  itemId: string;
}

export interface ReasoningStartedEvent {
  type: "reasoning.started";
  itemId: string;
  runId: string;
}

export interface ReasoningDeltaEvent {
  type: "reasoning.delta";
  itemId: string;
  delta: string;
}

export interface ReasoningCompletedEvent {
  type: "reasoning.completed";
  itemId: string;
  summaryTexts?: string[];
}

export interface OutputTextAnnotationAddedEvent {
  type: "output_text.annotation.added";
  itemId: string;
  annotation: Record<string, unknown>;
}

export interface FunctionCallStartedEvent {
  type: "function_call.started";
  itemId: string;
  name: string;
  callId: string;
  arguments?: string;
}

export interface FunctionCallArgumentsDeltaEvent {
  type: "function_call_arguments.delta";
  itemId: string;
  delta: string;
}

export interface FunctionCallCompletedEvent {
  type: "function_call.completed";
  itemId: string;
}

export interface FunctionCallOutputCompletedEvent {
  type: "function_call_output.completed";
  itemId: string;
  callId: string;
  output: string | Record<string, unknown>[];
}

export interface ToolStartedEvent {
  type: "tool.started";
  runId: string;
  toolName: string;
  input: string;
}

export interface ToolCompletedEvent {
  type: "tool.completed";
  runId: string;
  output: unknown;
  callId?: string;
}

export interface ToolErrorEvent {
  type: "tool.error";
  runId: string;
  error: unknown;
}

export interface RunCompletedEvent {
  type: "run.completed";
  runId: string;
}

export interface RunFailedEvent {
  type: "run.failed";
  runId: string;
  error: unknown;
}

export interface RunIncompleteEvent {
  type: "run.incomplete";
  runId: string;
  reason?: string;
}

export interface InternalEventEmitter {
  emit(event: InternalSemanticEvent): void;
}

export type InternalEventListener = (event: InternalSemanticEvent) => void;
