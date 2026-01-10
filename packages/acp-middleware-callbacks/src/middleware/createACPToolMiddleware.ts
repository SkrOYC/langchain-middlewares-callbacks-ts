/**
 * ACP Tool Middleware
 * 
 * Intercepts LangChain tool calls and emits ACP tool_call/tool_call_update events.
 * Handles tool lifecycle with status transitions: pending -> in_progress -> completed|failed.
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
} from "../types/acp.js";
import type { ContentBlockMapper, DefaultContentBlockMapper } from "../utils/contentBlockMapper.js";
import type { ContentBlock } from "../types/acp.js";

/**
 * Configuration for the ACP tool middleware.
 */
export interface ACPToolMiddlewareConfig {
  /**
   * Whether to emit tool call start events.
   * @default false
   */
  emitToolStart?: boolean;
  
  /**
   * Whether to emit tool execution results.
   * @default true
   */
  emitToolResults?: boolean;
  
  /**
   * Custom mapper function to determine tool kind for specific tools.
   * Useful for categorizing tools in the ACP protocol.
   * Defaults to mapToolKind() implementation.
   */
  toolKindMapper?: (toolName: string) => ToolKind;
  
  /**
   * Custom mapper function to convert tool results to ACP content blocks.
   * Defaults to converting the result to a text content block.
   */
  contentMapper?: (result: unknown) => ContentBlock[];
  
  /**
   * Custom content block mapper for converting between
   * LangChain and ACP content formats.
   */
  contentBlockMapper?: ContentBlockMapper;
}

/**
 * Default content mapper that converts a tool result to a text content block.
 * 
 * @param result - The tool result to convert
 * @returns Array containing a single text content block
 */
function defaultContentMapper(result: unknown): ContentBlock[] {
  if (result === undefined || result === null) {
    return [{
      type: "text",
      _meta: null,
      annotations: null,
      text: String(result ?? ""),
    }];
  }
  
  if (typeof result === "string") {
    return [{
      type: "text",
      _meta: null,
      annotations: null,
      text: result,
    }];
  }
  
  if (typeof result === "object") {
    try {
      return [{
        type: "text",
        _meta: null,
        annotations: null,
        text: JSON.stringify(result, null, 2),
      }];
    } catch {
      return [{
        type: "text",
        _meta: null,
        annotations: null,
        text: String(result),
      }];
    }
  }
  
  return [{
    type: "text",
    _meta: null,
    annotations: null,
    text: String(result),
  }];
}

/**
 * Maps a tool name to its corresponding ToolKind based on naming conventions.
 * 
 * This implements the SPEC.md ToolKind mapping guide with heuristic-based detection.
 * 
 * @param toolName - The name of the tool to categorize
 * @returns The corresponding ToolKind category
 * 
 * @example
 * ```typescript
 * mapToolKind("read_file") // returns "read"
 * mapToolKind("edit_file") // returns "edit"
 * mapToolKind("bash") // returns "execute"
 * ```
 */
export function mapToolKind(toolName: string): ToolKind {
  const name = toolName.toLowerCase();
  
  // Network requests (check before generic "get")
  if (name.includes('fetch') || name.includes('http') || name.includes('curl') || 
      name.includes('wget') || name.includes('url')) {
    return 'fetch';
  }
  
  // File reading operations
  if (name.includes('read') || name.includes('get') || name.includes('view') || name.includes('load')) {
    return 'read';
  }
  
  // File editing operations
  if (name.includes('edit') || name.includes('modify') || name.includes('patch') || name.includes('update')) {
    return 'edit';
  }
  
  // File deletion operations
  if (name.includes('delete') || name.includes('remove') || name.includes('unlink') || name.includes('rm')) {
    return 'delete';
  }
  
  // File moving/renaming operations
  if (name.includes('move') || name.includes('rename') || name.includes('mv')) {
    return 'move';
  }
  
  // Search operations
  if (name.includes('search') || name.includes('grep') || name.includes('find') || name.includes('query')) {
    return 'search';
  }
  
  // Command execution
  if (name.includes('bash') || name.includes('run') || name.includes('exec') || 
      name.includes('shell') || name.includes('command') || name.includes('execute')) {
    return 'execute';
  }
  
  // Internal reasoning/thinking
  if (name.includes('think') || name.includes('reason') || name.includes('analyze')) {
    return 'think';
  }
  
  // Mode switching
  if (name.includes('mode') || name.includes('context') || name.includes('switch')) {
    return 'switch_mode';
  }
  
  return 'other';
}

/**
 * Extracts location information from tool arguments.
 * Looks for common path-related keys in the arguments.
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
      // Handle array of paths
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
 * Creates tool middleware for ACP-compatible LangChain agents.
 * 
 * This middleware intercepts tool calls and emits ACP session update events:
 * - tool_call: Initial tool call with pending status
 * - tool_call_update: Status transitions (in_progress, completed, failed)
 * 
 * @param config - Configuration options for the tool middleware
 * @returns AgentMiddleware instance with tool call interception hooks
 * 
 * @example
 * ```typescript
 * const toolMiddleware = createACPToolMiddleware({
 *   emitToolStart: true,
 *   emitToolResults: true,
 *   toolKindMapper: customMapper,
 * });
 * ```
 */
export function createACPToolMiddleware(
  config: ACPToolMiddlewareConfig = {}
) {
  // Default configuration
  const emitToolStart = config.emitToolStart ?? false;
  const emitToolResults = config.emitToolResults ?? true;
  const toolKindMapper = config.toolKindMapper ?? mapToolKind;
  const contentMapper = config.contentMapper ?? defaultContentMapper;
  const contentBlockMapper = config.contentBlockMapper;
  
  // Per-thread state for tracking tool execution context
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
    name: "acp-tool-lifecycle",
    
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
      
      const toolKind = toolKindMapper(toolName);
      const locations = extractLocations(args as Record<string, unknown>);
      const contentBlockMapperInstance = contentBlockMapper;
      
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
      
      // Get the connection from runtime to send session updates
      const connection = (runtimeAny as any).connection;
      
      if (connection?.sessionUpdate) {
        try {
          await connection.sessionUpdate({
            sessionId,
            update: toolCallPayload,
          });
        } catch {
          // Fail-safe: don't let emit errors break agent execution
        }
      }
      
      // 2. Emit in_progress status (if enabled)
      if (emitToolStart) {
        const inProgressUpdate: ToolCallUpdate & { sessionUpdate: "tool_call_update" } = {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "in_progress",
          _meta: null,
        };
        
        if (connection?.sessionUpdate) {
          try {
            await connection.sessionUpdate({
              sessionId,
              update: inProgressUpdate,
            });
          } catch {
            // Fail-safe: don't let emit errors break agent execution
          }
        }
      }
      
      // 3. Execute tool
      try {
        const result = await handler(request);
        
        // 4. Emit completed status
        if (emitToolResults) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolContent: any = {
            type: "content",
            content: {
              type: "text",
              _meta: null,
              annotations: null,
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          };
          
          const completedUpdate: ToolCallUpdate & { sessionUpdate: "tool_call_update" } = {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: "completed",
            _meta: null,
            content: [toolContent],
            rawOutput: result,
          };
          
          if (connection?.sessionUpdate) {
            try {
              await connection.sessionUpdate({
                sessionId,
                update: completedUpdate,
              });
            } catch {
              // Fail-safe: don't let emit errors break agent execution
            }
          }
        }
        
        return result;
      } catch (error) {
        // 4. Emit failed status
        const errorMessage = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorContent: any = {
          type: "content",
          content: {
            type: "text",
            _meta: null,
            annotations: null,
            text: errorMessage,
          },
        };
        
        const failedUpdate: ToolCallUpdate & { sessionUpdate: "tool_call_update" } = {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "failed",
          _meta: null,
          content: [errorContent],
          rawOutput: error,
        };
        
        if (connection?.sessionUpdate) {
          try {
            await connection.sessionUpdate({
              sessionId,
              update: failedUpdate,
            });
          } catch {
            // Fail-safe: don't let emit errors break agent execution
          }
        }
        
        throw error;
      }
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
