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
 * - State management: Emits STATE_SNAPSHOT and STATE_DELTA events
 * - Guaranteed cleanup: Uses withListeners for error cleanup (via createAGUIAgent)
 */

import { createMiddleware } from "langchain";
import { generateId } from "../utils/idGenerator";
import { computeStateDelta } from "../utils/stateDiff";
import type { AGUIEvent } from "../events";
import type { AGUITransport } from "../transports/types";
import {
  AGUIMiddlewareOptionsSchema,
  type AGUIMiddlewareOptions,
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
  
  // Store session IDs in closure for access in afterAgent
  let threadId: string | undefined;
  let runId: string | undefined;

  // Store current messageId in closure for coordination between beforeModel and afterModel
  // This is more reliable than metadata propagation which may not persist across hooks
  let currentMessageId: string | undefined = undefined;

  // Store current stepName in closure for coordination between beforeModel and afterModel
  let currentStepName: string | undefined = undefined;

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
      const runtimeAny = runtime as any;
      const configurable = runtimeAny.config?.configurable || runtimeAny.configurable;
      threadId =
        configurable?.thread_id ||
        validated.threadIdOverride ||
        runtimeAny.context?.threadId;

      runId =
        configurable?.run_id || runtimeAny.context?.runId;

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
         
         // Emit MESSAGES_SNAPSHOT for message history (SPEC.md Section 4.4)
         const stateAny = state as any;
         if (stateAny.messages) {
           transport.emit({
             type: "MESSAGES_SNAPSHOT",
             messages: stateAny.messages,
           });
         }
       } catch {
        // Fail-safe: Transport errors never crash agent execution
      }

      return {};
    },

    /**
     * wrapModelCall hook - Wraps model invocations for guaranteed cleanup.
     * Uses try-finally to ensure TEXT_MESSAGE_END is emitted even on error.
     */
    wrapModelCall: async (request, handler) => {
      try {
        return await handler(request);
      } finally {
        // Note: TEXT_MESSAGE_END is emitted in afterModel hook
        // Guaranteed cleanup on error is handled by withListeners in createAGUIAgent
      }
    },

    /**
     * beforeModel hook - Runs before each model invocation.
     * Emits TEXT_MESSAGE_START and STEP_STARTED.
     * Stores messageId in closure for afterModel coordination.
     */
    beforeModel: async (state, runtime) => {
      // Generate unique messageId for this model invocation
      const messageId = generateId();

      // Store in closure for afterModel coordination
      currentMessageId = messageId;

      // Generate stepName for step correlation
      const stepName = `model_call_${generateId()}`;

      // Store stepName in closure for afterModel coordination
      currentStepName = stepName;

      // Emit TEXT_MESSAGE_START event (SPEC.md Section 4.2)
      try {
        transport.emit({
          type: "TEXT_MESSAGE_START",
          messageId,
          role: "assistant",
        });

        // Emit STEP_STARTED event (SPEC.md Section 4.1)
        // All events should be tied to run/message context for correlation
        transport.emit({
          type: "STEP_STARTED",
          stepName,
          runId,
          threadId,
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
      // Use messageId from closure (more reliable than metadata propagation)
      const messageId = currentMessageId;

      try {
        // Emit TEXT_MESSAGE_END event (SPEC.md Section 4.2)
        if (messageId) {
          transport.emit({
            type: "TEXT_MESSAGE_END",
            messageId,
          });
        }

        // Emit STEP_FINISHED event (SPEC.md Section 4.1)
        // All events should be tied to run/message context for correlation
        transport.emit({
          type: "STEP_FINISHED",
          stepName: currentStepName,
          runId,
          threadId,
        });
      } catch {
        // Fail-safe
      }

      // Clean up metadata to prevent memory leaks (for callbacks)
      try {
        const runtimeAny = runtime as any;
        const config = runtimeAny.config || {};
        const metadata = config.metadata as Record<string, unknown> | undefined;
        if (metadata?.agui_messageId) {
          const { agui_messageId, ...rest } = metadata;
          config.metadata = rest;
        }
       } catch {
        // Fail-safe: If cleanup fails, continue anyway
      }

      // Clear the closure variables
      currentMessageId = undefined;
      currentStepName = undefined;

      return {};
    },

    /**
     * afterAgent hook - Runs at the end of agent execution.
     * Emits RUN_FINISHED or RUN_ERROR and optionally STATE_SNAPSHOT/STATE_DELTA.
     * Note: This only runs on successful completion. For guaranteed cleanup on error,
     * withListeners in createAGUIAgent handles TEXT_MESSAGE_END emission.
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
        const stateAny = state as any;
        if (stateAny.error) {
          const error = stateAny.error as Error;
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
          });
        } else {
          transport.emit({
            type: "RUN_FINISHED",
            threadId,
            runId,
          });
        }
      } catch {
        // Fail-safe: Transport errors never crash agent execution
      }

      return {};
    },
  });
}
