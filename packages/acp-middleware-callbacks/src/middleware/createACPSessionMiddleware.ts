/**
 * ACP Session Middleware
 * 
 * Middleware for managing ACP session lifecycle events and state management.
 * Handles session ID extraction, checkpointer integration, and state snapshot emission.
 * 
 * @packageDocumentation
 */

import { createMiddleware } from "langchain";
import { z } from "zod";
import type { 
  SessionId, 
} from "../types/acp.js";
import type { ACPMiddlewareConfig } from "../types/middleware.js";

/**
 * Configuration for the ACP session middleware.
 */
export interface ACPSessionMiddlewareConfig {
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
  stateMapper?: (state: Record<string, unknown>) => Record<string, unknown>;
  
  /**
   * Callback invoked when a new session is created.
   * Receives the session ID and initial state.
   */
  onNewSession?: (sessionId: SessionId, state: Record<string, unknown>) => void;
  
  /**
   * Callback invoked when a prompt is received.
   * Receives the session ID and current state.
   */
  onPrompt?: (sessionId: SessionId, state: Record<string, unknown>) => void;
}

/**
 * Result type for session middleware operations.
 */
export interface ACPSessionMiddlewareResult {
  /**
   * Optional session ID for the current execution.
   */
  sessionId?: SessionId;
  
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
 * Configuration object for Runnable operations.
 * This is a simplified type to avoid direct LangChain dependencies in foundation phase.
 */
type RunnableConfig = Record<string, unknown>;

/**
 * Creates session middleware for ACP-compatible LangChain agents.
 * 
 * This middleware handles:
 * - Session ID extraction from agent configuration
 * - Checkpointer integration for state persistence
 * - Session lifecycle hooks (newSession, prompt, loadSession)
 * - State snapshot emission with configurable modes
 * 
 * @param config - Configuration options for the session middleware
 * @returns AgentMiddleware instance with session lifecycle hooks
 * 
 * @example
 * ```typescript
 * const sessionMiddleware = createACPSessionMiddleware({
 *   emitStateSnapshots: "all",
 *   stateMapper: (state) => filterSensitiveData(state),
 * });
 * ```
 */
export function createACPSessionMiddleware(
  config: ACPSessionMiddlewareConfig = {}
) {
  // Default configuration
  const emitStateSnapshots = config.emitStateSnapshots ?? "final";
  
  /**
   * Default session ID extractor - tries multiple locations for thread_id.
   */
  const sessionIdExtractor = config.sessionIdExtractor ?? ((config: RunnableConfig): string | undefined => {
    const configurable = config.configurable as Record<string, unknown> | undefined;
    return configurable?.thread_id as string | undefined;
  });

  // Per-thread state to support concurrent agent executions
  const threadState = new Map<string, { sessionId?: SessionId; turnCount: number }>();

  /**
   * Get or create state for a specific thread.
   * This ensures proper isolation between concurrent executions.
   */
  function getThreadState(threadId: string): { sessionId?: SessionId; turnCount: number } {
    let state = threadState.get(threadId);
    if (!state) {
      state = { turnCount: 0 };
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
    name: "acp-session-lifecycle",
    
    contextSchema: z.object({
      thread_id: z.string().optional(),
      threadId: z.string().optional(),
      session_id: z.string().optional(),
      sessionId: z.string().optional(),
    }) as any,

    beforeAgent: async (state, runtime) => {
      const runtimeAny = runtime as any;
      const agentConfig = runtimeAny.config ?? {};
      const threadId = sessionIdExtractor(agentConfig) ?? 
        runtimeAny.context?.threadId ?? 
        runtimeAny.context?.thread_id ?? 
        "default";
      
      const threadStateInstance = getThreadState(threadId);
      
      // Extract session ID
      threadStateInstance.sessionId = (sessionIdExtractor(agentConfig) ?? 
        runtimeAny.context?.sessionId ?? 
        runtimeAny.context?.session_id) as SessionId | undefined;

      // Invoke newSession callback if provided
      if (config.onNewSession && threadStateInstance.sessionId) {
        try {
          config.onNewSession(threadStateInstance.sessionId, state as Record<string, unknown>);
        } catch {
          // Fail-safe: don't let callback errors break agent execution
        }
      }

      // Emit initial state snapshot if configured
      if (emitStateSnapshots === "initial" || emitStateSnapshots === "all") {
        const mappedState = config.stateMapper 
          ? config.stateMapper(state as Record<string, unknown>)
          : state;
        
        return {
          acp_threadId: threadId,
          acp_sessionId: threadStateInstance.sessionId,
          acp_shouldEmitSnapshot: true,
        } as any;
      }

      return {
        acp_threadId: threadId,
        acp_sessionId: threadStateInstance.sessionId,
      } as any;
    },

    beforeModel: async (state, runtime) => {
      const runtimeAny = runtime as any;
      const agentConfig = runtimeAny.config ?? {};
      const threadId = ((state as any).acp_threadId as string) ?? 
        sessionIdExtractor(agentConfig) ?? 
        runtimeAny.context?.threadId ?? 
        runtimeAny.context?.thread_id ?? 
        "default";
      
      const threadStateInstance = getThreadState(threadId);
      
      // Get current session ID (from beforeAgent or fresh extraction)
      const sessionId = threadStateInstance.sessionId ?? (sessionIdExtractor(agentConfig) ?? 
        runtimeAny.context?.sessionId ?? 
        runtimeAny.context?.session_id) as SessionId | undefined;

      threadStateInstance.turnCount++;

      // Invoke prompt callback if provided
      if (config.onPrompt && sessionId) {
        try {
          config.onPrompt(sessionId, state as Record<string, unknown>);
        } catch {
          // Fail-safe: don't let callback errors break agent execution
        }
      }

      // Check if we should emit state based on configuration
      const shouldEmit = emitStateSnapshots === "all";
      
      return {
        acp_threadId: threadId,
        acp_sessionId: sessionId,
        acp_turnCount: threadStateInstance.turnCount,
        acp_shouldEmitSnapshot: shouldEmit,
      } as any;
    },

    afterModel: async (state, runtime) => {
      const runtimeAny = runtime as any;
      // Get threadId from state first, then fallback to config/context
      const threadId = ((state as any).acp_threadId as string) ?? 
        sessionIdExtractor(runtimeAny.config ?? {}) ?? 
        runtimeAny.context?.threadId ?? 
        runtimeAny.context?.thread_id ?? 
        "default";
      const threadStateInstance = getThreadState(threadId);
      
      // Get session ID from various sources
      const sessionId = threadStateInstance.sessionId ?? 
        (runtimeAny.config?.configurable?.thread_id as SessionId | undefined) ??
        ((state as any).acp_sessionId as SessionId | undefined);

      // Emit state snapshot after model if configured
      const shouldEmit = emitStateSnapshots === "all";
      
      if (shouldEmit && config.stateMapper) {
        const mappedState = config.stateMapper(state as Record<string, unknown>);
        return {
          acp_threadId: threadId,
          acp_sessionId: sessionId,
          acp_turnCount: threadStateInstance.turnCount,
          acp_snapshotEmitted: true,
        } as any;
      }

      return {
        acp_threadId: threadId,
        acp_sessionId: sessionId,
        acp_turnCount: threadStateInstance.turnCount,
        acp_shouldEmitSnapshot: shouldEmit,
      } as any;
    },

    afterAgent: async (state, runtime) => {
      const runtimeAny = runtime as any;
      // Get threadId from state first, then fallback to config/context
      const threadId = ((state as any).acp_threadId as string) ?? 
        sessionIdExtractor(runtimeAny.config ?? {}) ?? 
        runtimeAny.context?.threadId ?? 
        runtimeAny.context?.thread_id ?? 
        "default";
      const threadStateInstance = getThreadState(threadId);
      
      // Get session ID
      const sessionId = threadStateInstance.sessionId ?? 
        ((state as any).acp_sessionId as SessionId | undefined);

      // Emit final state snapshot if configured
      if (emitStateSnapshots === "final" || emitStateSnapshots === "all") {
        const mappedState = config.stateMapper 
          ? config.stateMapper(state as Record<string, unknown>)
          : state;
        
        // Clean up thread state after completion
        cleanupThreadState(threadId);
        
        return {
          acp_threadId: threadId,
          acp_sessionId: sessionId,
          acp_turnCount: threadStateInstance.turnCount,
          acp_finalState: mappedState,
          acp_shouldEmitSnapshot: true,
        } as any;
      }

      // Clean up thread state after completion
      cleanupThreadState(threadId);

      return {
        acp_threadId: threadId,
        acp_sessionId: sessionId,
        acp_turnCount: 0,
      } as any;
    },
  });
}