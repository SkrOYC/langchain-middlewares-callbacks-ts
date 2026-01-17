/**
 * ACP Mode Middleware
 *
 * Middleware for managing ACP mode switching and mode-specific configuration.
 * Handles mode transitions, tool permissions, and session updates.
 *
 * @packageDocumentation
 */

import { createMiddleware } from "langchain";
import { z } from "zod";
import type { SessionId } from "@agentclientprotocol/sdk";
import type { ACPSessionState, ACPModeConfig, ACPMiddlewareStateReturn } from "../types/middleware.js";

/**
 * Configuration for the ACP mode middleware.
 */
export interface ACPModeMiddlewareConfig {
  /**
   * Available modes for this agent.
   * Keys are mode IDs used to reference the mode.
   */
  modes: Record<string, ACPModeConfig>;

  /**
   * The default mode to use when no mode is specified.
   */
  defaultMode: string;

  /**
   * AgentSideConnection for sending session updates.
   * Required for emitting current_mode_update events.
   */
  transport?: any; // AgentSideConnection - using any to avoid SDK dependency

  /**
   * Custom function to extract session ID from agent configuration.
   * If not provided, defaults to extracting from config.configurable.session_id.
   */
  sessionIdExtractor?: (config: Record<string, unknown>) => string | undefined;
}

/**
 * Result type for mode middleware operations.
 */
export interface ACPModeMiddlewareResult {
  /**
   * The mode ID that was applied.
   */
  appliedMode?: string;
  
  /**
   * Whether the mode configuration was applied.
   */
  modeApplied?: boolean;
}

/**
 * Per-thread state for tracking mode context.
 */
interface ThreadModeState {
  sessionId?: SessionId;
}

/**
 * Standard mode configurations for common use cases.
 */
export const STANDARD_MODES: Record<string, ACPModeConfig> = {
  /**
   * Full autonomy mode - agent can use all tools without restrictions.
   */
  agentic: {
    systemPrompt: "You have full autonomy to accomplish tasks. You may use any available tools without seeking confirmation.",
    description: "Full autonomy - all tools available without restrictions",
    allowedTools: undefined, // All tools allowed
    requirePermission: false,
  },
  
  /**
   * Interactive mode - requires confirmation for sensitive operations.
   */
  interactive: {
    systemPrompt: "You should seek user confirmation before performing sensitive operations like file modifications, deletions, or system commands.",
    description: "Interactive - requires confirmation for sensitive operations",
    allowedTools: undefined, // All tools allowed
    requirePermission: true,
  },
  
  /**
   * Read-only mode - no tool execution, only read operations.
   */
  readonly: {
    systemPrompt: "You operate in read-only mode. You can analyze and provide information but cannot modify files or execute commands. Suggest actions for the user to take instead.",
    description: "Read-only - only read operations allowed",
    allowedTools: ["read_file", "search", "grep", "list_files", "get_file_info"],
    requirePermission: false,
  },
  
  /**
   * Planning mode - emits plan updates, tool execution deferred.
   */
  planning: {
    systemPrompt: "Focus on planning and analysis. Emit detailed plans for review before execution. Tool execution should be minimal and focused on gathering information needed for planning.",
    description: "Planning - emit plans, defer tool execution",
    allowedTools: ["read_file", "search", "grep", "list_files", "get_file_info", "think"],
    requirePermission: false,
  },
};

/**
 * Creates mode middleware for ACP-compatible LangChain agents.
 * 
 * This middleware handles:
 * - Mode extraction from agent configuration
 * - Mode-specific system prompt injection
 * - Tool permission enforcement
 * - Current mode session updates
 * 
 * @param config - Configuration options for the mode middleware
 * @returns AgentMiddleware instance with mode lifecycle hooks
 * 
 * @example
 * ```typescript
 * const modeMiddleware = createACPModeMiddleware({
 *   modes: {
 *     agentic: {
 *       systemPrompt: "You have full autonomy.",
 *       description: "Full autonomy mode",
 *     },
 *     readonly: {
 *       systemPrompt: "You can only read files.",
 *       description: "Read-only mode",
 *       allowedTools: ["read_file"],
 *     },
 *   },
 *   defaultMode: "agentic",
 *   transport: connection,
 * });
 * ```
 */
export function createACPModeMiddleware(
  config: ACPModeMiddlewareConfig
) {
  // Validate configuration
  if (!config.modes || Object.keys(config.modes).length === 0) {
    throw new Error("Mode middleware requires at least one mode configuration");
  }
  
  if (!config.defaultMode || !(config.defaultMode in config.modes)) {
    throw new Error(`Default mode "${config.defaultMode}" is not defined in modes configuration`);
  }
  
  const { modes, defaultMode, transport, sessionIdExtractor } = config;
  const modeIds = Object.keys(modes);
  
  // Per-thread state for tracking mode context
  const threadState = new Map<string, ThreadModeState>();
  
  /**
   * Get or create state for a specific thread.
   */
  function getThreadState(threadId: string): ThreadModeState {
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
   * Get current mode from runtime configuration.
   */
  function getCurrentMode(runtimeConfig: Record<string, unknown>): string {
    // Check for acp_mode in configurable
    const configurable = runtimeConfig.configurable as Record<string, unknown> | undefined;
    if (configurable?.acp_mode) {
      return configurable.acp_mode as string;
    }
    
    // Check for mode in root config
    if (runtimeConfig.mode && typeof runtimeConfig.mode === "string") {
      return runtimeConfig.mode;
    }
    
    // Check for modeId
    if (runtimeConfig.modeId && typeof runtimeConfig.modeId === "string") {
      return runtimeConfig.modeId;
    }
    
    return defaultMode;
  }
  
  /**
   * Get session ID from runtime configuration.
   */
  function getSessionId(
    runtimeConfig: Record<string, unknown>,
    threadStateInstance: ThreadModeState
  ): SessionId | undefined {
    // First check thread state
    if (threadStateInstance.sessionId) {
      return threadStateInstance.sessionId;
    }
    
    // Check configurable
    const configurable = runtimeConfig.configurable as Record<string, unknown> | undefined;
    if (configurable?.session_id) {
      return configurable.session_id as SessionId;
    }
    if (configurable?.sessionId) {
      return configurable.sessionId as SessionId;
    }
    
    // Use custom extractor if provided
    if (sessionIdExtractor) {
      return sessionIdExtractor(runtimeConfig);
    }
    
    return undefined;
  }
  
  /**
   * Emit current mode update to the client.
   */
  async function emitModeUpdate(
    sessionId: SessionId | undefined,
    currentModeId: string
  ): Promise<void> {
    if (!transport || !sessionId) {
      return;
    }
    
    try {
      await transport.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "current_mode_update",
          _meta: null,
          currentModeId,
        },
      });
    } catch {
      // Fail-safe: don't let emit errors break agent execution
    }
  }
  
  return createMiddleware({
    name: "acp-mode-control",
    
    contextSchema: z.object({
      thread_id: z.string().optional(),
      threadId: z.string().optional(),
      session_id: z.string().optional(),
      sessionId: z.string().optional(),
      acp_mode: z.string().optional(),
    }) as any,
    
    beforeAgent: async (state, runtime) => {
      const runtimeAny = runtime as any;
      const agentConfig = runtimeAny.config ?? {};
      const threadId = runtimeAny.context?.threadId ?? 
                       runtimeAny.context?.thread_id ?? 
                       (agentConfig?.configurable?.thread_id as string) ?? 
                       "default";
      
      const threadStateInstance = getThreadState(threadId);
      
      // Extract session ID
      threadStateInstance.sessionId = getSessionId(agentConfig, threadStateInstance);
      const sessionId = threadStateInstance.sessionId;
      
      // Get current mode
      const currentModeId = getCurrentMode(agentConfig);
      const modeConfig = modes[currentModeId];
      
      // Validate mode exists
      if (!modeConfig) {
        throw new Error(`Mode "${currentModeId}" is not configured`);
      }
      
      // Update runtime configuration with mode settings
      // These will be used by other middleware and the agent
      const updatedConfigurable = {
        ...(agentConfig.configurable as Record<string, unknown>),
        acp_mode: currentModeId,
        acp_allowedTools: modeConfig.allowedTools,
        acp_requirePermission: modeConfig.requirePermission,
      };
      
      // Assign updated configuration back to agent config
      agentConfig.configurable = updatedConfigurable;
      
      // Emit current mode update
      await emitModeUpdate(sessionId, currentModeId);
      
      // Return state updates to be applied
      return {
        acp_mode: currentModeId,
        acp_modeConfig: modeConfig,
        acp_sessionId: sessionId,
      } as ACPMiddlewareStateReturn;
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
