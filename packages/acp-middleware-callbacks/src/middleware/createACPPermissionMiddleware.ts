/**
 * ACP Permission Middleware
 * 
 * Implements HITL (Human-in-the-Loop) permission workflow for ACP agents.
 * Uses afterModel hook with interrupt() for proper LangGraph checkpointing,
 * aligned with LangChain's built-in HITL middleware pattern.
 * 
 * @packageDocumentation
 */

import { createMiddleware } from "langchain";
import { z } from "zod";
import type { 
  ToolKind, 
  ToolCall, 
  ToolCallUpdate, 
  SessionId, 
  PermissionOptionKind,
  ToolCallContent 
} from "../types/acp.js";
import type { 
  PermissionPolicyConfig,
  HITLRequest,
  HITLResponse,
  HITLDecision,
  ActionRequest,
  ReviewConfig,
  ApproveDecision,
  EditDecision,
  RejectDecision,
} from "../types/middleware.js";
import { mapToolKind } from "./createACPToolMiddleware.js";
import { extractLocations } from "../utils/extractLocations.js";

/**
 * Structure of the selected permission outcome.
 */
export interface SelectedPermissionOutcome {
  _meta?: Record<string, unknown> | null;
  optionId: string;
}

/**
 * Possible outcomes from a permission request (legacy pattern).
 */
export type RequestPermissionOutcome =
  | { outcome: 'cancelled' }
  | (SelectedPermissionOutcome & { outcome: 'selected' });

/**
 * Configuration for the ACP permission middleware.
 */
export interface ACPPermissionMiddlewareConfig {
  /**
   * Permission policy mapping tool patterns to their requirements.
   * Keys are tool name patterns (supports wildcards like "*").
   */
  permissionPolicy: Record<string, PermissionPolicyConfig>;
  
  /**
   * The connection for sending notifications and updates to the client.
   */
  transport: {
    /**
     * Sends a notification message to the client (fire-and-forget).
     * Used for session/request_permission before interrupt.
     */
    sendNotification(method: string, params: unknown): void;
    
    /**
     * Sends a session update to the client.
     */
    sessionUpdate(params: { sessionId: SessionId; update: ToolCall | ToolCallUpdate }): Promise<void>;
  };
  
  /**
   * Optional callback for handling session cancellation.
     * Called when client sends session/cancel notification during permission wait.
   */
  onSessionCancel?: (sessionId: SessionId) => void;
  
  /**
   * Custom mapper function to determine tool kind for specific tools.
   * Defaults to mapToolKind() from createACPToolMiddleware.
   */
  toolKindMapper?: (toolName: string) => ToolKind;
  
  /**
   * Custom mapper function to convert error messages to ACP ToolCallContent.
   * Defaults to wrapping message in a ToolCallContent structure.
   */
  contentMapper?: (message: string) => Array<ToolCallContent>;
  
  /**
   * Optional description prefix for permission requests.
   * @default "Tool execution requires approval"
   */
  descriptionPrefix?: string;
}

/**
 * Default content mapper that converts a message to a ToolCallContent.
 * 
 * @param message - The message to convert
 * @returns Array containing a single ToolCallContent with wrapped text
 */
function defaultContentMapper(message: string): Array<ToolCallContent> {
  return [{
    type: "content",
    content: {
      type: "text",
      _meta: null,
      annotations: null,
      text: message,
    },
  }];
}

/**
 * Default permission options for HITL decisions.
 */
const DEFAULT_PERMISSION_OPTIONS: Array<{
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}> = [
  { optionId: "approve", name: "Approve", kind: "allow_once" },
  { optionId: "edit", name: "Edit", kind: "allow_once" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];

/**
 * Escapes special regex characters in a string.
 * Prevents ReDoS vulnerabilities when patterns contain regex operators.
 * 
 * @param str - The string to escape
 * @returns The escaped string
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if a tool name matches a pattern in the permission policy.
 * Supports exact matches and wildcard patterns.
 * 
 * @param toolName - The name of the tool to check
 * @param pattern - The pattern to match against
 * @returns True if the tool matches the pattern
 */
function matchesPattern(toolName: string, pattern: string): boolean {
  // Exact match
  if (pattern === toolName) {
    return true;
  }
  
  // Wildcard match (e.g., "*", "file_*", "*_file")
  if (pattern.includes('*')) {
    const escapedPattern = escapeRegExp(pattern);
    const regex = new RegExp('^' + escapedPattern.replace(/\*/g, '.*') + '$');
    return regex.test(toolName);
  }
  
  return false;
}

/**
 * Finds the matching policy config for a given tool name.
 * 
 * @param toolName - The name of the tool
 * @param policy - The permission policy configuration
 * @returns The matching policy config or undefined if no match
 */
function findMatchingPolicy(
  toolName: string,
  policy: Record<string, PermissionPolicyConfig>
): PermissionPolicyConfig | undefined {
  // First, check for exact or wildcard matches
  for (const [pattern, config] of Object.entries(policy)) {
    if (matchesPattern(toolName, pattern)) {
      return config;
    }
  }
  
  return undefined;
}

/**
 * Extracts tool calls from the agent state.
 * Looks for the last AIMessage and returns its tool_calls array.
 * 
 * @param state - The agent state
 * @returns Array of tool calls from the last AIMessage, or undefined
 */
function extractToolCallsFromState(state: Record<string, unknown>): Array<{
  id: string;
  name: string;
  args: Record<string, unknown>;
}> | undefined {
  const stateAny = state as any;
  const messages = stateAny.messages;
  
  if (!messages || !Array.isArray(messages)) {
    return undefined;
  }
  
  // Find the last AIMessage in the conversation
  const lastMessage = [...messages].reverse().find(
    (msg: any) => msg && msg._getType && msg._getType() === 'ai'
  );
  
  if (!lastMessage || !lastMessage.tool_calls || !Array.isArray(lastMessage.tool_calls)) {
    return undefined;
  }
  
  return lastMessage.tool_calls.map((tc: any) => ({
    id: tc.id ?? `tc-${Math.random().toString(36).slice(2, 9)}`,
    name: tc.name ?? 'unknown',
    args: tc.args ?? {},
  }));
}

/**
 * Categorizes tool calls into those requiring permission vs auto-approved.
 * 
 * @param toolCalls - Array of tool calls from the agent
 * @param policy - Permission policy configuration
 * @returns Object with permissionRequired and autoApproved arrays
 */
function categorizeToolCalls(
  toolCalls: Array<{ name: string; id: string; args: Record<string, unknown> }>,
  policy: Record<string, PermissionPolicyConfig>
): {
  permissionRequired: Array<{ name: string; id: string; args: Record<string, unknown> }>;
  autoApproved: Array<{ name: string; id: string; args: Record<string, unknown> }>;
} {
  const permissionRequired: Array<{ name: string; id: string; args: Record<string, unknown> }> = [];
  const autoApproved: Array<{ name: string; id: string; args: Record<string, unknown> }> = [];
  
  for (const toolCall of toolCalls) {
    const policyConfig = findMatchingPolicy(toolCall.name, policy);
    
    if (policyConfig?.requiresPermission) {
      permissionRequired.push(toolCall);
    } else {
      autoApproved.push(toolCall);
    }
  }
  
  return { permissionRequired, autoApproved };
}

/**
 * Builds the HITL request structure for interrupt().
 * 
 * @param toolCalls - Tool calls requiring permission
 * @param policy - Permission policy configuration
 * @param descriptionPrefix - Optional prefix for descriptions
 * @returns HITLRequest structure
 */
function buildHITLRequest(
  toolCalls: Array<{ name: string; id: string; args: Record<string, unknown> }>,
  policy: Record<string, PermissionPolicyConfig>,
  descriptionPrefix: string = "Tool execution requires approval"
): HITLRequest {
  const actionRequests: ActionRequest[] = [];
  const reviewConfigs: ReviewConfig[] = [];
  
  for (const toolCall of toolCalls) {
    const policyConfig = findMatchingPolicy(toolCall.name, policy);
    
    // Build action request
    actionRequests.push({
      toolCallId: toolCall.id,
      name: toolCall.name,
      args: toolCall.args,
      description: policyConfig?.description ?? `Calling ${toolCall.name}`,
    });
    
    // Build review config
    reviewConfigs.push({
      actionName: toolCall.name,
      allowedDecisions: policyConfig?.allowedResponses ?? ['approve', 'edit', 'reject'],
      argsSchema: undefined, // Could add schema from tool definition
    });
  }
  
  return { actionRequests, reviewConfigs };
}

/**
 * Processes HITL decisions and returns modified tool calls and any artificial messages.
 * 
 * @param decisions - Array of HITL decisions from human
 * @param toolCalls - Original tool calls that were interrupted
 * @param contentMapper - Function to convert messages to ToolCallContent
 * @returns Object with revisedToolCalls and artificialMessages arrays
 */
function processDecisions(
  decisions: HITLDecision[],
  toolCalls: Array<{ name: string; id: string; args: Record<string, unknown> }>,
  contentMapper: (message: string) => Array<ToolCallContent>
): {
  revisedToolCalls: Array<{ name: string; id: string; args: Record<string, unknown> }>;
  artificialMessages: Array<{ role: string; content: Array<ToolCallContent>; tool_call_id: string; name: string }>;
} {
  const revisedToolCalls: Array<{ name: string; id: string; args: Record<string, unknown> }> = [];
  const artificialMessages: Array<{ role: string; content: Array<ToolCallContent>; tool_call_id: string; name: string }> = [];
  
  for (let i = 0; i < decisions.length; i++) {
    const decision = decisions[i]!;
    const toolCall = toolCalls[i]!;
    
    switch (decision.type) {
      case 'approve':
        // Return tool call unchanged
        revisedToolCalls.push(toolCall);
        break;
        
      case 'edit':
        // Return tool call with modified name/args
        revisedToolCalls.push({
          ...toolCall,
          name: decision.editedAction.name,
          args: decision.editedAction.args,
        });
        break;
        
      case 'reject':
        // Create a tool message with rejection reason instead of executing
        artificialMessages.push({
          role: 'tool',
          content: contentMapper(decision.message ?? 'Permission denied by user'),
          tool_call_id: toolCall.id,
          name: toolCall.name,
        });
        // Don't add to revisedToolCalls - causes model to see rejection
        break;
    }
  }
  
  return { revisedToolCalls, artificialMessages };
}

/**
 * Creates permission middleware for ACP-compatible LangChain agents.
 * 
 * This middleware implements the HITL (Human-in-the-Loop) permission workflow:
 * 1. afterModel hook intercepts tool calls after the model generates them
 * 2. Categorize tool calls: permission required vs auto-approved
 * 3. Send session/request_permission notification for protocol compliance
 * 4. Call interrupt() to checkpoint state and pause execution
 * 5. Resume with Command({ resume: { decisions: [...] } })
 * 6. Process decisions (approve/edit/reject) and update state
 * 
 * @param config - Configuration options for the permission middleware
 * @returns AgentMiddleware instance with permission enforcement hooks
 * 
 * @example
 * ```typescript
 * const permissionMiddleware = createACPPermissionMiddleware({
 *   permissionPolicy: {
 *     "delete_*": { requirePermission: true, kind: "delete" },
 *     "*_file": { requirePermission: true, kind: "edit" },
 *   },
 *   transport: connection,
 * });
 * ```
 */
export function createACPPermissionMiddleware(
  config: ACPPermissionMiddlewareConfig
) {
  // Validate configuration
  if (!config.permissionPolicy || Object.keys(config.permissionPolicy).length === 0) {
    throw new Error("Permission middleware requires a permissionPolicy configuration");
  }
  
  if (!config.transport) {
    throw new Error("Permission middleware requires a transport configuration");
  }
  
  const toolKindMapper = config.toolKindMapper ?? mapToolKind;
  const contentMapper = config.contentMapper ?? defaultContentMapper;
  const { transport } = config;
  const descriptionPrefix = config.descriptionPrefix ?? "Tool execution requires approval";
  
  // Per-thread state for tracking permission context
  const threadState = new Map<string, { sessionId?: SessionId }>();
  
  /**
   * Get or create state for a specific thread.
   */
  function getThreadState(threadId: string): { sessionId?: SessionId } {
    let state = threadState.get(threadId);
    if (!state) {
      state = {};
      threadState.set(threadId, state);
    }
    return state;
  }
  
  /**
   * Clean up thread state after agent execution completes.
   */
  function cleanupThreadState(threadId: string): void {
    threadState.delete(threadId);
  }
  
  /**
   * Extracts session ID from runtime.
   */
  function getSessionId(runtime: any): SessionId | undefined {
    return (
      runtime.context?.sessionId ??
      runtime.context?.session_id ??
      runtime.config?.configurable?.session_id
    );
  }
  
  /**
   * Extracts thread ID from runtime.
   */
  function getThreadId(runtime: any): string {
    return (
      runtime.context?.threadId ??
      runtime.context?.thread_id ??
      runtime.config?.configurable?.thread_id ??
      "default"
    );
  }
  
  /**
   * Emits a tool call update with the specified status.
   */
  async function emitToolStatus(
    sessionId: SessionId | undefined,
    toolCallId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    status: 'pending' | 'in_progress' | 'completed' | 'failed',
    content?: Array<ToolCallContent>
  ): Promise<void> {
    if (!sessionId) return;
    
    const toolKind = toolKindMapper(toolName);
    const locations = extractLocations(toolArgs);
    
    if (status === 'pending') {
      const toolCallPayload: ToolCall & { sessionUpdate: "tool_call" } = {
        sessionUpdate: "tool_call",
        toolCallId,
        title: `${descriptionPrefix}: ${toolName}`,
        kind: toolKind,
        status: "pending",
        _meta: null,
        locations: locations.length > 0 ? locations : undefined,
        rawInput: toolArgs,
        content: undefined,
        rawOutput: undefined,
      };
      
      try {
        await transport.sessionUpdate({
          sessionId,
          update: toolCallPayload,
        });
      } catch {
        // Fail-safe: don't let emit errors break agent execution
      }
    } else {
      const updatePayload: ToolCallUpdate & { sessionUpdate: "tool_call_update" } = {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status,
        _meta: null,
        content,
        rawOutput: undefined,
      };
      
      try {
        await transport.sessionUpdate({
          sessionId,
          update: updatePayload,
        });
      } catch {
        // Fail-safe: don't let emit errors break agent execution
      }
    }
  }
  
  return createMiddleware({
    name: "acp-permission-control",
    
    contextSchema: z.object({
      thread_id: z.string().optional(),
      threadId: z.string().optional(),
      session_id: z.string().optional(),
      sessionId: z.string().optional(),
    }) as any,
    
    afterModel: {
      canJumpTo: ["model"],
      hook: async (state, runtime) => {
        const runtimeAny = runtime as any;
        const threadId = getThreadId(runtimeAny);
        const sessionId = getSessionId(runtimeAny);
        
        // Store session ID in thread state for potential use in other hooks
        const threadStateInstance = getThreadState(threadId);
        if (sessionId) {
          threadStateInstance.sessionId = sessionId;
        }
        
        // 1. Extract tool calls from state
        const toolCalls = extractToolCallsFromState(state);
        if (!toolCalls || toolCalls.length === 0) {
          return {};
        }
        
        // 2. Categorize: interrupt vs auto-approve
        const { permissionRequired, autoApproved } = categorizeToolCalls(
          toolCalls,
          config.permissionPolicy
        );
        
        // 3. If no permission needed, continue with auto-approved tool calls
        if (permissionRequired.length === 0) {
          return {};
        }
        
        // 4. Emit pending status for permission-required tools
        for (const toolCall of permissionRequired) {
          await emitToolStatus(
            sessionId,
            toolCall.id,
            toolCall.name,
            toolCall.args,
            'pending'
          );
        }
        
        // 5. Build HITL request for interrupt
        const hitlRequest = buildHITLRequest(
          permissionRequired,
          config.permissionPolicy,
          descriptionPrefix
        );
        
        // 6. Send session/request_permission notification before interrupting
        // This provides ACP protocol compliance
        if (transport.sendNotification && sessionId && permissionRequired.length > 0) {
          const firstToolCall = permissionRequired[0]!;
          try {
            transport.sendNotification("session/request_permission", {
              sessionId,
              toolCall: {
                toolCallId: firstToolCall.id,
                title: `${descriptionPrefix}: ${firstToolCall.name}`,
                kind: toolKindMapper(firstToolCall.name),
                status: "pending",
                _meta: null,
                locations: extractLocations(firstToolCall.args),
                rawInput: firstToolCall.args,
                content: undefined,
                rawOutput: undefined,
              },
              options: DEFAULT_PERMISSION_OPTIONS,
            });
          } catch {
            // Fail-safe: don't let notification errors break agent execution
          }
        }
        
        // 7. Call interrupt() - checkpoints state and waits for Command.resume
        // The runtime.interrupt function is provided by LangGraph
        if (!runtime.interrupt) {
          // Fallback for environments without interrupt support
          throw new Error("Interrupt not supported in this runtime");
        }
        
        const hitlResponse = (await runtime.interrupt(hitlRequest)) as HITLResponse;
        
        // 8. Process decisions from resume
        const { revisedToolCalls, artificialMessages } = processDecisions(
          hitlResponse.decisions,
          permissionRequired,
          contentMapper
        );
        
        // 9. Emit in_progress status for approved/edited tools
        for (const toolCall of revisedToolCalls) {
          await emitToolStatus(
            sessionId,
            toolCall.id,
            toolCall.name,
            toolCall.args,
            'in_progress'
          );
        }
        
        // 10. Update the last AIMessage to only include approved tool calls
        const stateAny = state as any;
        const messages = [...stateAny.messages];
        
        // Find the last AI message (iterate backwards to find the last match)
        let lastMessageIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i] as any;
          if (msg && msg._getType && msg._getType() === 'ai') {
            lastMessageIndex = i;
            break;
          }
        }
        
        if (lastMessageIndex !== -1) {
          // Combine auto-approved and revised (approved/edited) tool calls
          const finalToolCalls = [
            ...autoApproved.map(tc => ({
              id: tc.id,
              name: tc.name,
              args: tc.args,
            })),
            ...revisedToolCalls.map(tc => ({
              id: tc.id,
              name: tc.name,
              args: tc.args,
            })),
          ];
          
          // Update the message's tool_calls
          messages[lastMessageIndex] = {
            ...messages[lastMessageIndex],
            tool_calls: finalToolCalls,
          };
        }
        
        // 11. Check if any tool was rejected (jump back to model)
        const hasRejections = hitlResponse.decisions.some(d => d.type === 'reject');
        
        return {
          messages: [...messages, ...artificialMessages],
          jumpTo: hasRejections ? "model" : undefined,
        };
      },
    },
    
    afterAgent: async (state, runtime) => {
      const runtimeAny = runtime as any;
      const threadId = getThreadId(runtimeAny);
      
      // Clean up thread state after completion
      cleanupThreadState(threadId);
      
      return {};
    },
  });
}
