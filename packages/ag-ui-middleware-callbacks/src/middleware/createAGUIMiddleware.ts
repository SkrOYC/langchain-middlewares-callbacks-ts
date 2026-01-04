/**
 * AG-UI Middleware Factory
 * 
 * Creates middleware that integrates LangChain agents with the AG-UI protocol.
 * 
 * Architecture (SPEC.md Section 2.5):
 * - Middleware handles lifecycle events (RUN_STARTED, RUN_FINISHED, etc.)
 * - Metadata propagation: Stores messageId in runtime.config.metadata for callbacks
 * - Session ID priority: configurable > context > options
 * - Fail-safe: All transport emissions wrapped in try/catch
 * - Agent state coordination: Shares activeMessageId with agent wrapper for cleanup
 * - State management: Emits STATE_SNAPSHOT and STATE_DELTA events
 */

import { createMiddleware } from "langchain";
import { generateId } from "../utils/idGenerator";
import { computeStateDelta } from "../utils/stateDiff";
import type { AGUIEvent } from "../events";
import type { AGUITransport } from "../transports/types";
import {
  AGUIMiddlewareOptionsSchema,
  type AGUIMiddlewareOptions,
  type AgentState,
} from "./types";

/**
 * Interface for tracking previous state for delta computation.
 */
interface StateTracker {
  previousState: unknown;
}

/**
 * Create AG-UI middleware for LangChain agents.
 * 
 * @param options - Middleware configuration options
 * @returns AgentMiddleware instance with lifecycle hooks
 */
export function createAGUIMiddleware(options: AGUIMiddlewareOptions) {
  // Validate options at creation time
  const validated = AGUIMiddlewareOptionsSchema.parse(options);
  
  // Store transport in closure for access in hooks
  const transport = validated.transport;
  
  // Agent state for cleanup coordination (may be undefined if not provided)
  const agentState = validated._agentState as AgentState | undefined;
  
  // State tracker for delta computation (only used when emitStateSnapshots === 'all')
  const stateTracker: StateTracker = {
    previousState: undefined,
  };

  return createMiddleware({
    name: "ag-ui-lifecycle",

    /**
     * beforeAgent hook - Runs at the start of agent execution.
     * Emits RUN_STARTED and optionally STATE_SNAPSHOT.
     */
    beforeAgent: async (state, runtime) => {
      // Session ID priority: configurable > context > options (SPEC.md Section 7.1)
      const configurable = (runtime as any).config?.configurable || runtime.configurable;
      const threadId =
        configurable?.thread_id ||
        validated.threadIdOverride ||
        runtime.context?.threadId;

      const runId =
        configurable?.run_id || runtime.context?.runId;

      // Emit RUN_STARTED event
      try {
        transport.emit({
          type: "RUN_STARTED",
          threadId,
          runId,
        });

        // Emit STATE_SNAPSHOT if configured (SPEC.md Section 4.4)
        if (
          validated.emitStateSnapshots === "initial" ||
          validated.emitStateSnapshots === "all"
        ) {
          transport.emit({
            type: "STATE_SNAPSHOT",
            snapshot: state,
          });
          
          // Track state for delta computation
          if (validated.emitStateSnapshots === "all") {
            stateTracker.previousState = state;
          }
        }
      } catch {
        // Fail-safe: Transport errors never crash agent execution
      }

      return {};
    },

    /**
     * beforeModel hook - Runs before each model invocation.
     * Emits TEXT_MESSAGE_START and STEP_STARTED.
     * Stores messageId in metadata for callback coordination.
     * Updates agentState for guaranteed cleanup.
     */
    beforeModel: async (state, runtime) => {
      // Generate unique messageId for this model invocation
      const messageId = generateId();

      // Update agentState for withListeners cleanup coordination (SPEC.md Section 8.2)
      if (agentState) {
        agentState.activeMessageId = messageId;
      }

      // Emit TEXT_MESSAGE_START event (SPEC.md Section 4.2)
      try {
        transport.emit({
          type: "TEXT_MESSAGE_START",
          messageId,
          role: "assistant",
        });

        // Emit STEP_STARTED event (SPEC.md Section 4.1)
        transport.emit({
          type: "STEP_STARTED",
        });
      } catch {
        // Fail-safe
      }

      // Store messageId in metadata for callbacks (SPEC.md Section 2.5.1)
      // This enables callback coordination without direct middleware-callback communication
      // Use Object.defineProperty to work around frozen runtime object
      try {
        const config = (runtime as any).config || {};
        if (!config.metadata) {
          Object.defineProperty(config, "metadata", {
            value: { agui_messageId: messageId },
            writable: true,
            enumerable: true,
            configurable: true,
          });
        } else {
          config.metadata = {
            ...config.metadata,
            agui_messageId: messageId,
          };
        }
      } catch {
        // Fail-safe: If metadata can't be set, continue without it
      }

      return {};
    },

    /**
     * afterModel hook - Runs after each model response.
     * Emits TEXT_MESSAGE_END and STEP_FINISHED.
     * Cleans up metadata.
     */
    afterModel: async (state, runtime) => {
      // Safely access metadata with fallback
      const config = (runtime as any).config || {};
      const metadata = config.metadata as Record<string, unknown> | undefined;
      const messageId = metadata?.agui_messageId;

      try {
        // Emit TEXT_MESSAGE_END event (SPEC.md Section 4.2)
        if (messageId) {
          transport.emit({
            type: "TEXT_MESSAGE_END",
            messageId,
          });
        }

        // Emit STEP_FINISHED event (SPEC.md Section 4.1)
        transport.emit({
          type: "STEP_FINISHED",
        });
      } catch {
        // Fail-safe
      }

      // Clean up metadata to prevent memory leaks
      try {
        const config = (runtime as any).config || {};
        const metadata = config.metadata as Record<string, unknown> | undefined;
        if (metadata?.agui_messageId) {
          const { agui_messageId, ...rest } = metadata;
          config.metadata = rest;
        }
      } catch {
        // Fail-safe: If cleanup fails, continue anyway
      }

      // Clear agentState (unless it was already updated by a new beforeModel)
      if (agentState && agentState.activeMessageId === messageId) {
        agentState.activeMessageId = undefined;
      }

      return {};
    },

    /**
     * afterAgent hook - Runs at the end of agent execution.
     * Emits RUN_FINISHED or RUN_ERROR and optionally STATE_SNAPSHOT/STATE_DELTA.
     */
    afterAgent: async (state, runtime) => {
      try {
        // Emit STATE_SNAPSHOT if configured (SPEC.md Section 4.4)
        if (
          validated.emitStateSnapshots === "final" ||
          validated.emitStateSnapshots === "all"
        ) {
          transport.emit({
            type: "STATE_SNAPSHOT",
            snapshot: state,
          });
          
          // Emit STATE_DELTA if configured (SPEC.md Section 4.4)
          if (validated.emitStateSnapshots === "all" && stateTracker.previousState !== undefined) {
            const delta = computeStateDelta(stateTracker.previousState, state);
            if (delta.length > 0) {
              transport.emit({
                type: "STATE_DELTA",
                delta,
              });
            }
          }
        }

        // Check for agent error and emit appropriate event
        if (state.error) {
          const error = state.error as Error;
          transport.emit({
            type: "RUN_ERROR",
            message:
              validated.errorDetailLevel === "full" ||
              validated.errorDetailLevel === "message"
                ? error.message
                : undefined,
            code:
              validated.errorDetailLevel === "full" ||
              validated.errorDetailLevel === "code"
                ? "AGENT_EXECUTION_ERROR"
                : undefined,
            stack:
              validated.errorDetailLevel === "full" ? error.stack : undefined,
          });
        } else {
          transport.emit({
            type: "RUN_FINISHED",
          });
        }
      } catch {
        // Fail-safe: Transport errors never crash agent execution
      }

      return {};
    },
  });
}
