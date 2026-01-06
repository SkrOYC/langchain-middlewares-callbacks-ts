/**
 * AG-UI Middleware Factory
 *
 * Creates middleware that integrates LangChain agents with the AG-UI protocol.
 */

import { createMiddleware } from "langchain";
import { z } from "zod";
import { generateId, generateDeterministicId } from "../utils/idGenerator";
import { computeStateDelta } from "../utils/stateDiff";
import { mapLangChainMessageToAGUI } from "../utils/messageMapper";
import { cleanLangChainData } from "../utils/cleaner";
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
  
  const transport = validated.transport;
  
  let threadId: string | undefined;
  let runId: string | undefined;
  let currentStepName: string | undefined = undefined;
  let modelTurnIndex = 0;

  const stateTracker: StateTracker = {
    previousState: undefined,
  };

  const activityStates = new Map<string, any>();

  return createMiddleware({
    name: "ag-ui-lifecycle",
    contextSchema: z.object({
      run_id: z.string().optional(),
      runId: z.string().optional(),
      thread_id: z.string().optional(),
      threadId: z.string().optional(),
    }) as any,

    beforeAgent: async (state, runtime) => {
      modelTurnIndex = 0;
      const runtimeAny = runtime as any;
      const configurable = runtimeAny.config?.configurable || runtimeAny.configurable;
      
      threadId =
        (configurable?.threadId as string | undefined) ||
        (configurable?.thread_id as string | undefined) ||
        (configurable?.checkpoint_id as string | undefined) ||
        validated.threadIdOverride ||
        (runtimeAny.context?.threadId as string | undefined) ||
        (runtimeAny.context?.thread_id as string | undefined) ||
        "";

      // Exhaustive search for Run ID - generate fallback if not found
      runId =
        validated.runIdOverride ||
        (configurable?.run_id as string | undefined) ||
        (runtimeAny.runId as string | undefined) ||
        (runtimeAny.id as string | undefined) ||
        (runtimeAny.context?.runId as string | undefined) ||
        (runtimeAny.context?.run_id as string | undefined) ||
        (runtimeAny.config?.runId as string | undefined) ||
        crypto.randomUUID(); // Generate fallback for streamEvents compatibility

      try {
        transport.emit({
          type: "RUN_STARTED",
          threadId,
          runId,
          input: cleanLangChainData(runtimeAny.config?.input),
        });

        if (
          validated.emitStateSnapshots === "initial" ||
          validated.emitStateSnapshots === "all"
        ) {
          const snapshot = validated.stateMapper 
            ? validated.stateMapper(state) 
            : cleanLangChainData(state);
          
          // Remove messages from state snapshot by default to avoid redundancy
          if (!validated.stateMapper && snapshot && typeof snapshot === "object") {
            delete (snapshot as any).messages;
          }

          transport.emit({
            type: "STATE_SNAPSHOT",
            snapshot,
          });
        }
        
        const stateAny = state as any;
        if (stateAny.messages && Array.isArray(stateAny.messages)) {
          transport.emit({
            type: "MESSAGES_SNAPSHOT",
            messages: stateAny.messages.map(mapLangChainMessageToAGUI),
          });
        }
      } catch {
        // Fail-safe
      }

      // Store runId in metadata for callback coordination
      // This allows callbacks to use the same runId as middleware
      const configAny = runtimeAny.config as any;
      if (configAny) {
        configAny.metadata = {
          ...(configAny.metadata || {}),
          agui_runId: runId,
        };
      }

      return {};
    },

    beforeModel: async (state, runtime) => {
      const turnIndex = modelTurnIndex++;
      const messageId = generateDeterministicId(runId!, turnIndex);
      const stepName = `model_call_${messageId}`;
      currentStepName = stepName;

      // Store messageId in metadata for callback coordination
      // This ensures callbacks use the same messageId as middleware
      const runtimeAny = runtime as any;
      const configAny = runtimeAny.config as any;
      if (configAny) {
        configAny.metadata = {
          ...(configAny.metadata || {}),
          agui_messageId: messageId,
        };
      }

      try {
        transport.emit({
          type: "STEP_STARTED",
          stepName,
          runId,
          threadId,
        });

        // TEXT_MESSAGE_START is handled by AGUICallbackHandler
        // It reads messageId from metadata in handleLLMStart
      } catch {
        // Fail-safe
      }

      return {};
    },

    afterModel: async (_state, _runtime) => {
      try {
        // TEXT_MESSAGE_END is handled by AGUICallbackHandler
        // It uses the same messageId from metadata coordination

        transport.emit({
          type: "STEP_FINISHED",
          stepName: currentStepName || "",
          runId,
          threadId,
        });
      } catch {
        // Fail-safe
      }

      currentStepName = undefined;
      return {};
    },

    afterAgent: async (state, _runtime) => {
      try {
        if (
          validated.emitStateSnapshots === "final" ||
          validated.emitStateSnapshots === "all"
        ) {
          const snapshot = validated.stateMapper 
            ? validated.stateMapper(state) 
            : cleanLangChainData(state);
          
          // Remove messages from state snapshot by default to avoid redundancy
          if (!validated.stateMapper && snapshot && typeof snapshot === "object") {
            delete (snapshot as any).messages;
          }

          transport.emit({
            type: "STATE_SNAPSHOT",
            snapshot,
          });
          
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

        const stateAny = state as any;
        if (stateAny.error) {
          const error = stateAny.error;
          const errorMessage = error instanceof Error ? error.message : String(error);
          transport.emit({
            type: "RUN_ERROR",
            threadId: threadId,
            runId: runId,
            message:
              validated.errorDetailLevel === "full" ||
              validated.errorDetailLevel === "message"
                ? errorMessage
                : "",
            code: "AGENT_EXECUTION_ERROR",
          });
        } else {
          transport.emit({
            type: "RUN_FINISHED",
            threadId: threadId!,
            runId: runId!,
            result: validated.resultMapper ? validated.resultMapper(state) : undefined,
          });
        }
      } catch {
        // Fail-safe
      }

      return {};
    },
  });
}
