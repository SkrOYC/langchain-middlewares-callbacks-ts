/**
 * Core TypeScript Type Definitions
 *
 * Additional type definitions that complement the Zod schemas.
 * Most types are inferred from schemas, but some need explicit definitions.
 */

import type { CallbackHandlerMethods } from "@langchain/core/callbacks/base";
import type {
  ErrorObject,
  FunctionTool,
  OpenResponsesEvent,
  OpenResponsesRequest,
  OpenResponsesResponse,
  ToolChoice,
} from "./schemas.js";

// =============================================================================
// Persistence Types
// =============================================================================

/**
 * Canonical stored record for continuation persistence.
 * This is the package's persistence schema - not a database table,
 * but the required logical record shape.
 */
export interface StoredResponseRecord {
  response_id: string;
  created_at: number;
  completed_at: number | null;
  model: string;
  request: {
    model: string;
    input: OpenResponsesRequest["input"];
    metadata: Record<string, string>;
    tools: FunctionTool[];
    tool_choice?: ToolChoice;
    parallel_tool_calls: boolean;
  };
  response: OpenResponsesResponse;
  status: "completed" | "failed" | "incomplete";
  error: ErrorObject | null;
}

/**
 * Port interface for continuation persistence.
 * Builders must implement this to enable previous_response_id continuation.
 */
export interface PreviousResponseStore {
  load(
    responseId: string,
    signal?: AbortSignal
  ): Promise<StoredResponseRecord | null>;
  save(record: StoredResponseRecord, signal?: AbortSignal): Promise<void>;
}

// =============================================================================
// Agent Interface Types
// =============================================================================

/**
 * LangChain message-like structure.
 * Used for internal message representation.
 */
export interface LangChainMessageLike {
  type: string;
  [key: string]: unknown;
}

/**
 * Agent interface contract for Open Responses adapter.
 *
 * The agent MUST support both invoke() for non-streaming responses and stream()
 * for streaming responses with truthful live SSE semantics.
 *
 * - invoke(): Returns final response synchronously (no chunk-level streaming)
 * - stream(): Returns AsyncIterable for actual token-by-token streaming
 *
 * The adapter uses stream() when the client requests streaming (Accept: text/event-stream).
 * Callback handlers can be used with both methods, but actual streaming requires stream().
 */
export interface OpenResponsesCompatibleAgent {
  invoke(
    input: { messages: LangChainMessageLike[] },
    config?: Record<string, unknown>
  ): Promise<unknown>;
  stream(
    input: { messages: LangChainMessageLike[] },
    config?: Record<string, unknown>
  ): AsyncIterable<unknown>;
}

// =============================================================================
// Handler Options
// =============================================================================

/**
 * Options for creating an Open Responses handler.
 */
export interface OpenResponsesHandlerOptions {
  agent: OpenResponsesCompatibleAgent;
  callbacks?: CallbackHandlerMethods[];
  middleware?: unknown[];
  previousResponseStore?: PreviousResponseStore;
  onError?: (error: unknown) => ErrorObject;
  clock?: () => number;
  generateId?: () => string;
}

// =============================================================================
// Normalized Request Types
// =============================================================================

/**
 * Tool policy derived from request normalization.
 */
export type NormalizedToolPolicy =
  | { mode: "none" }
  | { mode: "auto" }
  | { mode: "required" }
  | { mode: "specific"; tools: string[] };

/**
 * Normalized request after input transformation.
 */
export interface NormalizedRequest {
  messages: LangChainMessageLike[];
  original: OpenResponsesRequest;
  toolPolicy: NormalizedToolPolicy;
}

// =============================================================================
// Canonical Response State
// =============================================================================

/**
 * Item state within the accumulator.
 */
export interface CanonicalItemState {
  id: string;
  type: "message" | "function_call";
  status: "in_progress" | "completed" | "incomplete";
  role?: "assistant";
  name?: string;
  call_id?: string;
  content: CanonicalContentPart[];
}

/**
 * Content part state within an item.
 */
export interface CanonicalContentPart {
  type: "output_text";
  status: "in_progress" | "completed";
  delta: string;
  final: string;
}

/**
 * Complete canonical response state.
 */
export interface CanonicalResponseState {
  responseId: string;
  model: string;
  createdAt: number;
  completedAt: number | null;
  status: "queued" | "in_progress" | "completed" | "failed" | "incomplete";
  items: CanonicalItemState[];
  error: ErrorObject | null;
}

// =============================================================================
// Serialization Types
// =============================================================================

/**
 * SSE frame structure.
 */
export interface SSEFrame {
  event: OpenResponsesEvent["type"];
  data: string;
}

/**
 * Sequence number generator.
 */
export interface SequenceGenerator {
  next(): number;
  current(): number;
}
