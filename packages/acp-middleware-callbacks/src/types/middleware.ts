/**
 * Middleware Configuration Types
 *
 * Type definitions for configuring ACP middleware and callback handlers
 * for LangChain agent integration.
 *
 * Note: Protocol types are imported directly from @agentclientprotocol/sdk.
 * This file contains only our package's configuration types.
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
} from "@agentclientprotocol/sdk";
import type { ContentBlockMapper } from "../utils/contentBlockMapper.js";

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
 * Represents a persistent permission option that can be configured in the permission policy.
 * Persistent options allow developers to expose allow_always and reject_always choices
 * to users, enabling them to make permanent permission decisions.
 * 
 * This is a subset of the {@link PermissionOption} type from @agentclientprotocol/sdk,
 * limited to the persistent option kinds (allow_always, reject_always).
 * 
 * Note: This provides the mechanism for persistent permissions. Decision caching and storage
 * is the responsibility of the developer implementing this middleware (Option B pattern).
 * 
 * @see PermissionOption - Full permission option type from ACP protocol SDK
 */
export interface PersistentOption {
  /**
   * Unique identifier for this option, returned in permission outcomes.
   * e.g., "allow_always", "reject_always"
   */
  optionId: string;
  
  /**
   * Human-readable name shown in permission dialogs.
   * e.g., "Always allow", "Always reject"
   */
  name: string;
  
  /**
   * The type of persistent permission.
   * - 'allow_always': Permanently allow matching actions
   * - 'reject_always': Permanently deny matching actions
   */
  kind: 'allow_always' | 'reject_always';
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
   * Persistent permission options to expose for this tool.
   * These options enable users to make permanent allow/deny decisions.
   * 
   * When configured, these options are merged with the default one-time options
   * (approve, edit, reject) and passed to the ACP protocol.
   * 
   * Example:
   * ```typescript
   * {
   *   persistentOptions: [
   *     { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
   *     { optionId: "reject_always", name: "Always reject", kind: "reject_always" },
   *   ]
   * }
   * ```
   * 
   * Note: The middleware does not cache these decisions. Developers must implement
   * their own decision storage and caching mechanism if needed (Option B pattern).
   */
  persistentOptions?: PersistentOption[];
  
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
   * The AgentSideConnection for sending events to the ACP client.
   * This is provided by the SDK when creating an agent connection.
   */
  connection: any; // AgentSideConnection - using any to avoid SDK dependency

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
 * ACP session state for middleware state management.
 * 
 * This interface defines the typed state fields used by ACP middleware
 * to track session lifecycle, mode information, and snapshot emission.
 * All fields are optional since middleware returns partial state updates
 * that get merged into the agent state.
 */
export interface ACPSessionState {
  /**
   * Current session ID for the agent execution.
   */
  acp_sessionId?: SessionId;
  
  /**
   * Thread identifier for the current execution context.
   */
  acp_threadId?: string;
  
  /**
   * Number of turns processed in the current session.
   */
  acp_turnCount?: number;
  
  /**
   * Current mode identifier for the agent.
   */
  acp_mode?: string;
  
  /**
   * Mode configuration for the current execution.
   */
  acp_modeConfig?: ACPModeConfig;
  
  /**
   * Whether a state snapshot has been emitted.
   */
  acp_snapshotEmitted?: boolean;
  
  /**
   * Whether a state snapshot should be emitted.
   */
  acp_shouldEmitSnapshot?: boolean;
  
  /**
   * Final state mapping when snapshot emission is configured.
   */
  acp_finalState?: Record<string, unknown>;
}

/**
 * ACP middleware state return type compatible with LangChain's MiddlewareResult.
 * Includes optional jumpTo property for execution control.
 */
export type ACPMiddlewareStateReturn = Partial<ACPSessionState> & {
  /**
   * Optional jumpTo target for execution control.
   */
  jumpTo?: "model" | "tools" | "end";
} & Record<string, unknown>;

/**
 * Configuration for a specific mode in the ACP mode middleware.
 */
export interface ACPModeConfig {
  /**
   * System prompt to use when this mode is active.
   * This is prepended to the agent's existing system message.
   */
  systemPrompt: string;
  
  /**
   * Human-readable description of this mode.
   */
  description?: string;
  
  /**
   * List of tool names allowed in this mode.
   * If undefined, all tools are allowed.
   */
  allowedTools?: string[];
  
  /**
   * Whether this mode requires user permission for tool execution.
   * @default false
   */
  requirePermission?: boolean;
}