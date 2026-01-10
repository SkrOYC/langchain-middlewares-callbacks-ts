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
import type { ToolKind, ToolCall, ToolCallUpdate, SessionId, PermissionOptionKind, RequestPermissionRequest, RequestPermissionResponse } from "../types/acp.js";
import type { PermissionPolicyConfig } from "../types/middleware.js";
import { mapToolKind } from "./createACPToolMiddleware.js";

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
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
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
 * Extracts location information from tool arguments.
 * 
 * @param args - The tool arguments
 * @returns Array of location objects with path property
 */
function extractLocations(args: Record<string, unknown>): Array<{ path: string }> {
  const locations: Array<{ path: string }> = [];
  
  // Check for common path keys
  const pathKeys = ['path', 'file', 'filePath', 'filepath', 'targetPath', 'sourcePath', 'uri', 'url'];
  
  for (const key of pathKeys) {
    if (args[key] && typeof args[key] === 'string') {
      locations.push({ path: args[key] as string });
    } else if (args[key] && Array.isArray(args[key])) {
      for (const item of args[key] as unknown[]) {
        if (typeof item === 'string') {
          locations.push({ path: item });
        }
      }
    }
  }
  
  return locations;
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
      const toolCallId = (request as any).toolCallId ?? (request as any).id ?? "unknown";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolName = (request as any).name ?? (request as any).tool ?? "unknown_tool";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args = (request as any).args ?? (request as any).input ?? {};
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const runtimeAny = (handler as any).runtime as any;
      const agentConfig = runtimeAny.config ?? {};
      const threadId = runtimeAny.context?.threadId ?? 
                       runtimeAny.context?.thread_id ?? 
                       (agentConfig.configurable?.thread_id as string) ??
                       "default";
      
      const threadStateInstance = getThreadState(threadId);
      const sessionId = threadStateInstance.sessionId ?? 
                        (runtimeAny.context?.sessionId ?? 
                         runtimeAny.context?.session_id ?? 
                         (agentConfig.configurable?.session_id as SessionId | undefined));
      
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorContent: any = {
          type: "content",
          content: {
            type: "text",
            _meta: null,
            annotations: null,
            text: "Permission request cancelled by user",
          },
        };
        
        const failedUpdate: ToolCallUpdate & { sessionUpdate: "tool_call_update" } = {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "failed",
          _meta: null,
          content: [errorContent],
        };
        
        try {
          await transport.sessionUpdate({
            sessionId,
            update: failedUpdate,
          });
        } catch {
          // Fail-safe: don't let emit errors break agent execution
        }
        
        throw new Error("Permission request cancelled by user");
      }
      
      // Handle selected outcome
      if (outcome.outcome === "selected") {
        const { optionId } = outcome;
        
        // Check for denial options
        if (optionId === "rejectOnce" || optionId === "rejectAlways") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const errorContent: any = {
            type: "content",
            content: {
              type: "text",
              _meta: null,
              annotations: null,
              text: "Permission denied by user",
            },
          };
          
          const failedUpdate: ToolCallUpdate & { sessionUpdate: "tool_call_update" } = {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: "failed",
            _meta: null,
            content: [errorContent],
          };
          
          try {
            await transport.sessionUpdate({
              sessionId,
              update: failedUpdate,
            });
          } catch {
            // Fail-safe: don't let emit errors break agent execution
          }
          
          throw new Error("Permission denied by user");
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
