/**
 * Middleware Configuration Types
 * 
 * Type definitions for configuring ACP middleware and callback handlers
 * for LangChain agent integration.
 * 
 * @packageDocumentation
 */

import type { 
  ContentBlock, 
  StopReason,
  ToolKind,
  SessionId,
  SessionUpdate,
  ToolCallContent,
} from "./acp.js";
import type { ContentBlockMapper } from "../utils/contentBlockMapper.js";

/**
 * Connection interface for ACP communication in callback handlers.
 * This provides a simplified interface that can be implemented by various
 * transport mechanisms while providing the specific methods needed by
 * the callback handler.
 */
export interface ACPConnection {
  /**
   * Sends an agent message to the ACP client.
   */
  sendAgentMessage(params: AgentMessageParams): Promise<void>;
  
  /**
   * Sends a session update event to the ACP client.
   * Used for tool calls, state updates, and other session-level events.
   */
  sessionUpdate(params: SessionUpdateParams): Promise<void>;
  
  /**
   * Closes the connection.
   */
  close(): Promise<void>;
}

/**
 * Parameters for sending an agent message.
 */
export interface AgentMessageParams {
  /**
   * Unique identifier for this message.
   */
  messageId: string;
  
  /**
   * The role of the message sender.
   */
  role: "user" | "agent" | "assistant" | "tool";
  
  /**
   * The content blocks of the message.
   */
  content: ContentBlock[];
  
  /**
   * The format of the content.
   */
  contentFormat: string;
  
  /**
   * Optional text delta for streaming.
   */
  delta?: {
    type: string;
    text: string;
  };
  
  /**
   * Optional stop reason for the message.
   */
  stopReason?: StopReason;
}

/**
 * Parameters for sending a session update.
 * Used for tool calls and other session-level events.
 */
export interface SessionUpdateParams {
  /**
   * The session ID for this update.
   */
  sessionId: SessionId;
  
  /**
   * The session update payload.
   * Uses the SessionUpdate type from the SDK which includes all variants:
   * tool_call, tool_call_update, agent_thought_chunk, current_mode_update, etc.
   */
  update: SessionUpdate;
}

/**
 * Payload for tool call creation/update.
 */
export interface ToolCallUpdatePayload {
  /**
   * Type of session update.
   */
  sessionUpdate: "tool_call";
  
  /**
   * Unique identifier for this tool call.
   */
  toolCallId: string;
  
  /**
   * Human-readable title for the tool call.
   */
  title: string;
  
  /**
   * Category of tool being invoked.
   */
  kind?: ToolKind;
  
  /**
   * Current execution status.
   */
  status: "pending" | "in_progress";
  
  /**
   * Files involved in this operation.
   */
  locations?: Array<{
    path: string;
  }>;
  
  /**
   * Raw input parameters.
   */
  rawInput?: unknown;
}

/**
 * Payload for tool call status updates (completion/failure).
 */
export interface ToolCallUpdateResultPayload {
  /**
   * Type of session update.
   */
  sessionUpdate: "tool_call_update";
  
  /**
   * Unique identifier for this tool call.
   */
  toolCallId: string;
  
  /**
   * Updated execution status.
   */
  status: "completed" | "failed";
  
  /**
   * Content produced by the tool call.
   * Uses ToolCallContent which wraps ContentBlock plus tool-specific types (diff, terminal).
   */
  content?: Array<ToolCallContent>;
  
  /**
   * Raw output from the tool.
   */
  rawOutput?: unknown;
  
  /**
   * Metadata for the update.
   */
  _meta?: Record<string, unknown> | null;
}

/**
 * Configuration object for Runnable operations.
 * This is a simplified type to avoid direct LangChain dependencies in foundation phase.
 */
type RunnableConfig = Record<string, unknown>;

/**
 * Generic agent state type.
 */
type AgentState = Record<string, unknown>;

/**
 * Configuration for the ACP session middleware.
 * 
 * This middleware handles session lifecycle events and state management
 * for LangChain agents running in ACP-compatible environments.
 */
export interface ACPMiddlewareConfig {
  /**
   * Custom function to extract session ID from agent configuration.
   * If not provided, defaults to extracting from config.configurable.thread_id.
   */
  sessionIdExtractor?: (config: RunnableConfig) => string | undefined;
  
  /**
   * Controls when state snapshots are emitted during agent execution.
   * - "initial": Emit only the initial state
   * - "final": Emit only the final state (default)
   * - "all": Emit all intermediate states
   * - "none": Don't emit state snapshots
   */
  emitStateSnapshots?: "initial" | "final" | "all" | "none";
  
  /**
   * Custom function to transform state before emitting to ACP.
   * Useful for filtering sensitive data or optimizing payload size.
   */
  stateMapper?: (state: AgentState) => Record<string, unknown>;
  
  /**
   * Whether to emit tool execution results as part of session updates.
   * @default true
   */
  emitToolResults?: boolean;
  
  /**
   * Whether to emit tool execution start events.
   * @default false
   */
  emitToolStart?: boolean;
  
  /**
   * Custom mapper function to determine tool kind for specific tools.
   * Useful for categorizing tools in the ACP protocol.
   */
  toolKindMapper?: (toolName: string) => ToolKind;
  
  /**
   * Permission policy configuration for tool execution.
   * Maps tool names to their required permission levels.
   */
  permissionPolicy?: Record<string, PermissionPolicyConfig>;
  
  /**
   * MCP server configurations for multi-server MCP clients.
   */
  mcpServers?: MCPServerConfig;
  
  /**
   * Options for MCP tool integration.
   */
  mcpToolOptions?: MCPToolOptions;
}

/**
 * Permission policy configuration for a specific tool.
 */
export interface PermissionPolicyConfig {
  /**
   * Whether this tool requires user permission before execution.
   * @default false
   */
  requiresPermission?: boolean;
  
  /**
   * The tool kind for categorization in permission requests.
   * If not specified, will be inferred from the tool name.
   */
  kind?: ToolKind;
  
  /**
   * Human-readable description of what the tool does.
   * Shown to users when requesting permission.
   */
  description?: string;
  
  /**
   * List of allowed response options when permission is requested.
   * @default ["approve", "reject"]
   */
  allowedResponses?: Array<'approve' | 'edit' | 'reject'>;
  
  /**
   * Whether to automatically deny this tool.
   * Useful for dangerous operations that should always require explicit user action.
   * @default false
   */
  autoDeny?: boolean;
}

// ============================================================
// HITL (Human-in-the-Loop) Types for Permission Middleware
// ============================================================

/**
 * Represents an action request for human review.
 * Used in HITL permission workflow to describe tool calls needing approval.
 */
export interface ActionRequest {
  /** The unique identifier for this tool call. */
  toolCallId: string;
  
  /** The name of the action/tool being requested. */
  name: string;
  
  /** Key-value pairs of arguments needed for the action. */
  args: Record<string, unknown>;
  
  /** Human-readable description of the action. */
  description?: string;
}

/**
 * Review configuration for a specific action in HITL workflow.
 */
export interface ReviewConfig {
  /** Name of the action associated with this review configuration. */
  actionName: string;
  
  /** The decisions that are allowed for this request. */
  allowedDecisions: Array<'approve' | 'edit' | 'reject'>;
  
  /** JSON schema for the arguments, used when edits are allowed. */
  argsSchema?: Record<string, unknown>;
}

/**
 * HITL Request structure passed to interrupt() for permission checkpoints.
 */
export interface HITLRequest {
  /** List of agent actions awaiting human review. */
  actionRequests: ActionRequest[];
  
  /** Review configuration for all possible actions. */
  reviewConfigs: ReviewConfig[];
}

/**
 * Decision types for HITL approval workflow.
 */
export type HITLDecision =
  | ApproveDecision
  | EditDecision
  | RejectDecision;

/**
 * Approve decision - allows the tool call to proceed with original arguments.
 */
export interface ApproveDecision {
  type: 'approve';
}

/**
 * Edit decision - modifies the tool name and/or arguments before execution.
 */
export interface EditDecision {
  type: 'edit';
  
  /** The modified action with new name and/or arguments. */
  editedAction: {
    name: string;
    args: Record<string, unknown>;
  };
}

/**
 * Reject decision - denies the tool call and returns human feedback.
 */
export interface RejectDecision {
  type: 'reject';
  
  /** Optional message to send back to the model explaining the rejection. */
  message?: string;
}

/**
 * HITL Response structure returned from Command.resume after human decision.
 */
export interface HITLResponse {
  /** Array of decisions for each action request. */
  decisions: HITLDecision[];
}

/**
 * Callback for handling session cancellation during permission wait.
 */
export type SessionCancelCallback = (sessionId: SessionId) => void;

/**
 * Configuration for MCP server connections.
 */
export interface MCPServerConfig {
  [serverName: string]: {
    /**
     * Transport type for the MCP server connection.
     * @default "stdio"
     */
    transport?: "stdio" | "http" | "websocket";
    
    /**
     * Command to execute the MCP server.
     * Used for stdio transport.
     */
    command?: string;
    
    /**
     * Arguments to pass to the MCP server command.
     * Used for stdio transport.
     */
    args?: string[];
    
    /**
     * URL for HTTP/WebSocket transport connections.
     */
    url?: string;
    
    /**
     * Headers for HTTP/WebSocket transport connections.
     */
    headers?: Record<string, string>;
    
    /**
     * Restart configuration for the MCP server.
     */
    restart?: {
      /**
       * Whether automatic restart is enabled.
       * @default false
       */
      enabled?: boolean;
      
      /**
       * Maximum number of restart attempts.
       * @default 3
       */
      maxAttempts?: number;
      
      /**
       * Delay in milliseconds between restart attempts.
       * @default 1000
       */
      delayMs?: number;
    };
    
    /**
     * Environment variables to pass to the MCP server.
     */
    env?: Record<string, string>;
  };
}

/**
 * Options for MCP tool integration.
 */
export interface MCPToolOptions {
  /**
   * Whether to prefix tool names with the server name.
   * @default true
   */
  prefixToolNameWithServerName?: boolean;
  
  /**
   * Additional prefix to add to all MCP tool names.
   */
  additionalToolNamePrefix?: string;
}

/**
 * Configuration for the ACP callback handler.
 * 
 * The callback handler is responsible for emitting events to the ACP client
 * during agent execution, including state updates, tool calls, and results.
 */
export interface ACPCallbackHandlerConfig {
  /**
   * The connection for sending events to the ACP client.
   * Must implement the ACPConnection interface.
   */
  connection: ACPConnection;
  
  /**
   * Optional session ID for this callback handler.
   * If provided, tool calls will use sessionUpdate events.
   * Can be set later via setSessionId() method.
   */
  sessionId?: string;
  
  /**
   * Whether to emit text content as individual chunks.
   * When true, text content is split into smaller chunks for streaming.
   * @default false
   */
  emitTextChunks?: boolean;
  
  /**
   * Custom content block mapper for converting between
   * LangChain and ACP content formats.
   * Defaults to DefaultContentBlockMapper if not provided.
   */
  contentBlockMapper?: ContentBlockMapper;
  
  /**
   * Whether to include intermediate states in updates.
   * @default true
   */
  includeIntermediateStates?: boolean;
  
  /**
   * Maximum number of messages to include in state snapshots.
   * Useful for preventing overly large payloads.
   * @default 50
   */
  maxMessagesInSnapshot?: number;
  
  /**
   * Whether to emit reasoning content as agent_thought_chunk.
   * When true, reasoning blocks are emitted as agent_thought_chunk with
   * audience: ['assistant'] annotation per ACP protocol.
   * When false, reasoning content falls back to agent_message_chunk.
   * @default true
   */
  emitReasoningAsThought?: boolean;
}

/**
 * Transport interface for ACP communication.
 * 
 * Implementations should handle the specifics of message delivery
 * (e.g., stdio, HTTP, WebSocket) while providing this common interface.
 */
export interface ACPTransport {
  /**
   * Sends an agent request message to the client.
   */
  sendRequest(method: string, params: unknown): Promise<unknown>;
  
  /**
   * Sends a notification message to the client (fire-and-forget).
   */
  sendNotification(method: string, params: unknown): void;
  
  /**
   * Closes the transport connection.
   */
  close(): void;
}

/**
 * Complete configuration for an ACP-compatible LangChain agent.
 */
export interface ACPAgentConfig {
  /**
   * The language model to use for agent reasoning.
   */
  model: LanguageModel;
  
  /**
   * List of tools available to the agent.
   */
  tools?: StructuredTool[];
  
  /**
   * Additional middleware to apply to the agent.
   */
  middleware?: unknown[];
  
  /**
   * Additional callback handlers to use with the agent.
   */
  callbacks?: CallbackHandler[];
  
  /**
   * The transport mechanism for ACP communication.
   */
  transport: ACPTransport;
  
  /**
   * Middleware configuration options.
   */
  middlewareConfig?: ACPMiddlewareConfig;
  
  /**
   * Callback handler configuration options.
   */
  callbackConfig?: ACPCallbackHandlerConfig;
  
  /**
   * Custom state schema for the agent (optional).
   * Defaults to the standard agent state if not provided.
   */
  stateSchema?: Record<string, unknown>;
  
  /**
   * Checkpointer for persisting agent state.
   * Required for session management functionality.
   */
  checkpointer?: BaseStore;
}

/**
 * Result type for middleware operations.
 */
export interface ACPMiddlewareResult {
  /**
   * Optional session ID for the current execution.
   */
  sessionId?: string;
  
  /**
   * Whether this execution should emit a state snapshot.
   */
  shouldEmitSnapshot?: boolean;
  
  /**
   * Optional error to propagate.
   */
  error?: Error;
}

/**
 * ACP-specific agent state extensions.
 * 
 * These properties are added to the agent state by ACP middleware
 * to track protocol-specific information.
 */
export interface ACPAgentState {
  /**
   * Current session ID.
   */
  sessionId?: SessionId;
  
  /**
   * Number of turns in the current session.
   */
  turnCount?: number;
  
   /**
    * Current stop reason for the agent's response.
    */
  stopReason?: StopReason;
  
  /**
   * Whether a permission request is currently pending.
   */
  permissionPending?: boolean;
  
  /**
   * Last tool call that was made.
   */
  lastToolCall?: string;
}

/**
 * Type for language models supported by the agent.
 */
export type LanguageModel = any;

/**
 * Type for structured tools supported by the agent.
 */
export type StructuredTool = any;

/**
 * Type for callback handlers supported by the agent.
 */
export type CallbackHandler = any;

/**
 * Type for base store (checkpointer) supported by the agent.
 */
export type BaseStore = any;