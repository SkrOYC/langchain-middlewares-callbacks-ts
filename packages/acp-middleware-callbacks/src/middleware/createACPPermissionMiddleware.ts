/**
 * ACP Permission Middleware
 * 
 * Implements HITL (Human-in-the-Loop) permission workflow for ACP agents.
 * Intercepts tool calls that require user permission and handles the request/response flow.
 * 
 * @packageDocumentation
 */

import { createMiddleware } from "langchain";
import { z } from "zod";
import type { ToolKind, ToolCall, ToolCallUpdate, SessionId, PermissionOptionKind, RequestPermissionRequest, RequestPermissionResponse, ToolCallContent } from "../types/acp.js";
import type { PermissionPolicyConfig } from "../types/middleware.js";
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
 * Possible outcomes from a permission request.
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
   * The connection for sending permission requests to the client.
   * Must implement the requestPermission method.
   */
  transport: {
    /**
     * Sends a permission request to the client and waits for response.
     */
    requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>;
    
    /**
     * Sends a session update to the client.
     */
    sessionUpdate(params: { sessionId: SessionId; update: ToolCall | ToolCallUpdate }): Promise<void>;
  };
  
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
 * Default permission options to present to the user.
 */
const DEFAULT_PERMISSION_OPTIONS: Array<{
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}> = [
  { optionId: "allowOnce", name: "Allow once", kind: "allow_once" },
  { optionId: "allowAlways", name: "Always Allow", kind: "allow_always" },
  { optionId: "rejectOnce", name: "Deny", kind: "reject_once" },
  { optionId: "rejectAlways", name: "Never Allow", kind: "reject_always" },
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
 * Creates permission middleware for ACP-compatible LangChain agents.
 * 
 * This middleware implements the HITL (Human-in-the-Loop) permission workflow:
 * 1. Check if tool requires permission via policy
 * 2. Emit tool_call with pending status
 * 3. Send requestPermission to client
 * 4. Handle outcome (cancelled/selected)
 * 5. Emit appropriate status updates
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
   * Emits a permission denied/failed update and throws an error.
   * 
   * @param reason - The reason for the failure
   * @param toolCallId - The tool call ID
   * @param sessionId - The session ID
   * @throws Error with the failure reason
   */
  async function emitPermissionDenied(
    reason: string,
    toolCallId: string,
    sessionId: SessionId
  ): Promise<never> {
    const failedUpdate: ToolCallUpdate & { sessionUpdate: "tool_call_update" } = {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "failed",
      _meta: null,
      content: contentMapper(reason),
    };
    
    try {
      await transport.sessionUpdate({
        sessionId,
        update: failedUpdate,
      });
    } catch {
      // Fail-safe: don't let emit errors break agent execution
    }
    
    throw new Error(reason);
  }
  
  return createMiddleware({
    name: "acp-permission-control",
    
    contextSchema: z.object({
      thread_id: z.string().optional(),
      threadId: z.string().optional(),
      session_id: z.string().optional(),
      sessionId: z.string().optional(),
    }) as any,
    
    wrapToolCall: async (request, handler) => {
      // Extract tool call information from the request
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const requestAny = request as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const runtimeAny = requestAny.runtime as any;
      
      const toolCallId = requestAny.toolCall?.id ?? "unknown";
      const toolName = requestAny.toolCall?.name ?? "unknown_tool";
      const args = requestAny.toolCall?.args ?? {};
      
      const agentConfig = runtimeAny?.config ?? {};
      const threadId = runtimeAny?.context?.threadId ?? 
                       runtimeAny?.context?.thread_id ?? 
                       (agentConfig?.configurable?.thread_id as string) ??
                       "default";
      
      const threadStateInstance = getThreadState(threadId);
      const sessionId = threadStateInstance.sessionId ?? 
                        (runtimeAny?.context?.sessionId ?? 
                         runtimeAny?.context?.session_id ?? 
                         (agentConfig?.configurable?.session_id as SessionId | undefined));
      
      // Check if tool requires permission
      const policyConfig = findMatchingPolicy(toolName, config.permissionPolicy);
      
      // If no policy match or permission not required, skip permission flow
      if (!policyConfig || !policyConfig.requiresPermission) {
        return handler(request);
      }
      
      const toolKind = policyConfig.kind ?? toolKindMapper(toolName);
      const locations = extractLocations(args as Record<string, unknown>);
      
      // 1. Emit pending tool call (with sessionUpdate discriminator)
      const toolCallPayload: ToolCall & { sessionUpdate: "tool_call" } = {
        sessionUpdate: "tool_call",
        toolCallId,
        title: `Calling ${toolName}`,
        kind: toolKind,
        status: "pending",
        _meta: null,
        locations: locations.length > 0 ? locations : undefined,
        rawInput: args,
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
      
      // 2. Send permission request to client
      const permissionResponse = await transport.requestPermission({
        sessionId,
        toolCall: {
          toolCallId,
          title: `Calling ${toolName}`,
          kind: toolKind,
          status: "pending",
          _meta: null,
          locations: locations.length > 0 ? locations : undefined,
          rawInput: args,
          content: undefined,
          rawOutput: undefined,
        },
        options: DEFAULT_PERMISSION_OPTIONS,
      });
      
      // 3. Handle the permission outcome
      const outcome = permissionResponse.outcome;
      
      // Handle cancelled outcome
      if (outcome.outcome === "cancelled") {
        await emitPermissionDenied("Permission request cancelled by user", toolCallId, sessionId);
      }
      
      // Handle selected outcome
      if (outcome.outcome === "selected") {
        const { optionId } = outcome;
        
        // Check for denial options
        if (optionId === "rejectOnce" || optionId === "rejectAlways") {
          await emitPermissionDenied("Permission denied by user", toolCallId, sessionId);
        }
        
        // Handle persistent permissions for "allowAlways"
        if (optionId === "allowAlways") {
          // Emit permission_update for persistent allowance
          try {
            await transport.sessionUpdate({
              sessionId,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              update: {
                sessionUpdate: "permission_update" as any,
                toolPattern: toolName,
                permission: "granted",
              } as any,
            });
          } catch {
            // Fail-safe: don't let emit errors break agent execution
          }
        }
      }
      
      // 4. Emit in_progress status after permission granted
      const inProgressUpdate: ToolCallUpdate & { sessionUpdate: "tool_call_update" } = {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "in_progress",
        _meta: null,
      };
      
      try {
        await transport.sessionUpdate({
          sessionId,
          update: inProgressUpdate,
        });
      } catch {
        // Fail-safe: don't let emit errors break agent execution
      }
      
      // 5. User approved - continue execution
      return handler(request);
    },
    
    afterAgent: async (state, runtime) => {
      const runtimeAny = runtime as any;
      const threadId = runtimeAny.context?.threadId ?? 
                       runtimeAny.context?.thread_id ?? 
                       "default";
      
      // Clean up thread state after completion
      cleanupThreadState(threadId);
      
      return {};
    },
  });
}
