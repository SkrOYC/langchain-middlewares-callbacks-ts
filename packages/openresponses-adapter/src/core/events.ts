/**
 * Internal Semantic Event Types
 *
 * These events are emitted by the callback bridge and consumed
 * by the accumulator and serializer. They are internal to the adapter
 * and map to Open Responses public events.
 */

/**
 * Union of all internal semantic events.
 * These derive from LangChain callbacks and are transformed into
 * Open Responses public events by the serializer.
 */
export type InternalSemanticEvent =
  | RunStartedEvent
  | MessageStartedEvent
  | TextDeltaEvent
  | TextCompletedEvent
  | FunctionCallStartedEvent
  | FunctionCallArgumentsDeltaEvent
  | FunctionCallCompletedEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ToolErrorEvent
  | RunCompletedEvent
  | RunFailedEvent;

/**
 * Agent/chain run started.
 */
export interface RunStartedEvent {
  type: "run.started";
  runId: string;
  parentRunId?: string;
}

/**
 * Assistant message item started.
 */
export interface MessageStartedEvent {
  type: "message.started";
  itemId: string;
  runId: string;
}

/**
 * Text delta for streaming output.
 */
export interface TextDeltaEvent {
  type: "text.delta";
  itemId: string;
  delta: string;
}

/**
 * Text content completed.
 */
export interface TextCompletedEvent {
  type: "text.completed";
  itemId: string;
}

/**
 * Function call (tool use) started.
 */
export interface FunctionCallStartedEvent {
  type: "function_call.started";
  itemId: string;
  name: string;
  callId: string;
}

/**
 * Function call arguments delta.
 */
export interface FunctionCallArgumentsDeltaEvent {
  type: "function_call_arguments.delta";
  itemId: string;
  delta: string;
}

/**
 * Function call completed.
 */
export interface FunctionCallCompletedEvent {
  type: "function_call.completed";
  itemId: string;
}

/**
 * Tool execution started.
 */
export interface ToolStartedEvent {
  type: "tool.started";
  runId: string;
  toolName: string;
  input: string;
}

/**
 * Tool execution completed.
 */
export interface ToolCompletedEvent {
  type: "tool.completed";
  runId: string;
  output: unknown;
}

/**
 * Tool execution error.
 */
export interface ToolErrorEvent {
  type: "tool.error";
  runId: string;
  error: unknown;
}

/**
 * Run/agent completed successfully.
 */
export interface RunCompletedEvent {
  type: "run.completed";
  runId: string;
}

/**
 * Run/agent failed with error.
 */
export interface RunFailedEvent {
  type: "run.failed";
  runId: string;
  error: unknown;
}

/**
 * Event emitter interface for callback handlers.
 */
export interface InternalEventEmitter {
  emit(event: InternalSemanticEvent): void;
}

/**
 * Event listener interface for consumers.
 */
export type InternalEventListener = (event: InternalSemanticEvent) => void;
