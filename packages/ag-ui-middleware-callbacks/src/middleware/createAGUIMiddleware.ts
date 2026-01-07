/**
 * AG-UI Middleware Factory
 *
 * Creates middleware that integrates LangChain agents with the AG-UI protocol.
 */

import { createMiddleware } from "langchain";
import { z } from "zod";
import { generateDeterministicId } from "../utils/idGenerator";
import { computeStateDelta } from "../utils/stateDiff";
import { mapLangChainMessageToAGUI } from "../utils/messageMapper";
import { cleanLangChainData } from "../utils/cleaner";
import {
  AGUIMiddlewareOptionsSchema,
  type AGUIMiddlewareOptions,
} from "./types";
import { createValidatingTransport } from "../utils/validation";

/**
 * Check if validateEvents mode is truthy (true or "strict").
 */
function isValidationEnabled(validateEvents: AGUIMiddlewareOptions['validateEvents']): boolean {
  return validateEvents === true || validateEvents === "strict";
}

/**
 * Interface for tracking agent execution activities.
 */
interface ActivityTracker {
  currentActivityId: string | undefined;
  currentActivityType: string;
  activityContent: Record<string, any>;
}

/**
 * Helper function to get a preview of the input for activity content.
 */
function getInputPreview(state: unknown): string {
  const stateAny = state as any;
  if (stateAny.messages && Array.isArray(stateAny.messages)) {
    const lastMessage = stateAny.messages[stateAny.messages.length - 1];
    if (lastMessage && typeof lastMessage.content === "string") {
      return lastMessage.content.substring(0, 100) + (lastMessage.content.length > 100 ? "..." : "");
    }
  }
  return "[no input preview]";
}

/**
 * Helper function to get the type of output from state.
 */
function getOutputType(state: unknown): string {
  const stateAny = state as any;
  if (stateAny.messages && Array.isArray(stateAny.messages)) {
    const lastMessage = stateAny.messages[stateAny.messages.length - 1];
    if (lastMessage?.toolCalls?.length) return "tool_calls";
    if (lastMessage?.content) return "text";
  }
  return "unknown";
}

/**
 * Helper function to check if state contains tool calls.
 */
function hasToolCalls(state: unknown): boolean {
  const stateAny = state as any;
  return !!(stateAny.messages && stateAny.messages.some((m: any) => m.toolCalls?.length > 0));
}

/**
 * Emit ACTIVITY_SNAPSHOT or ACTIVITY_DELTA based on current state.
 * ACTIVITY_SNAPSHOT = new activity or significant change
 * ACTIVITY_DELTA = incremental update
 */
async function emitActivityUpdate(
  transport: any,
  currentRunId: string | undefined,
  stepIndex: number,
  activityTracker: ActivityTracker,
  status: "started" | "processing" | "completed",
  activityMapper: ((node: any) => any) | undefined,
  details?: Record<string, any>
): Promise<void> {
  if (!currentRunId) return;

  const activityId = `activity-${currentRunId}-${stepIndex}`;
  const baseContent = {
    status,
    timestamp: Date.now(),
    ...details,
  };

  // Apply activityMapper if provided
  const finalContent = activityMapper ? activityMapper(baseContent) : baseContent;

  if (!activityTracker.currentActivityId || activityTracker.currentActivityId !== activityId) {
    // New activity - emit SNAPSHOT
    activityTracker.currentActivityId = activityId;
    activityTracker.currentActivityType = "AGENT_STEP";
    activityTracker.activityContent = finalContent;

    transport.emit({
      type: "ACTIVITY_SNAPSHOT",
      messageId: activityId,
      activityType: "AGENT_STEP",
      content: finalContent,
      replace: true,
    });
  } else {
    // Existing activity - emit DELTA
    const patch = computeStateDelta(activityTracker.activityContent, finalContent);
    if (patch.length > 0) {
      activityTracker.activityContent = finalContent;

      transport.emit({
        type: "ACTIVITY_DELTA",
        messageId: activityId,
        activityType: "AGENT_STEP",
        patch,
      });
    }
  }
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
  
  // Wrap transport with validation if enabled
  // In "strict" mode, throw on invalid events; in true mode, log warnings
  let transport = validated.transport;
  if (isValidationEnabled(validated.validateEvents)) {
    transport = createValidatingTransport(validated.transport, {
      throwOnInvalid: validated.validateEvents === "strict",
    });
  }
  
  let threadId: string | undefined;
  let runId: string | undefined;
  let currentStepName: string | undefined = undefined;
  let modelTurnIndex = 0;

  const activityTracker: ActivityTracker = {
    currentActivityId: undefined,
    currentActivityType: "AGENT_STEP",
    activityContent: {},
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
          timestamp: Date.now(),
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
             timestamp: Date.now(),
           });
         }
         
         const stateAny = state as any;
         if (stateAny.messages && Array.isArray(stateAny.messages)) {
           transport.emit({
             type: "MESSAGES_SNAPSHOT",
             messages: stateAny.messages.map(mapLangChainMessageToAGUI),
             timestamp: Date.now(),
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
          timestamp: Date.now(),
          // REMOVED: runId, threadId
        });

        // Emit ACTIVITY_SNAPSHOT for new activity if activities are enabled
        if (validated.emitActivities) {
          await emitActivityUpdate(
            transport,
            runId,
            turnIndex,
            activityTracker,
            "started",
            validated.activityMapper,
            {
              stepName,
              modelName: (runtime as any).config?.model?._modelType || "unknown",
              inputPreview: getInputPreview(state),
            } as Record<string, any>
          );
        }

        // TEXT_MESSAGE_START is handled by AGUICallbackHandler
        // It reads messageId from metadata in handleLLMStart
      } catch {
        // Fail-safe
      }

      return {};
    },

    afterModel: async (state, _runtime) => {
      try {
        // TEXT_MESSAGE_END is handled by AGUICallbackHandler
        // It uses the same messageId from metadata coordination

        transport.emit({
          type: "STEP_FINISHED",
          stepName: currentStepName || "",
          timestamp: Date.now(),
          // REMOVED: runId, threadId
        });

        // Emit ACTIVITY_DELTA for completed activity if activities are enabled
        if (validated.emitActivities && currentStepName) {
          const turnIndex = modelTurnIndex - 1;
          await emitActivityUpdate(
            transport,
            runId,
            turnIndex,
            activityTracker,
            "completed",
            validated.activityMapper,
            {
              stepName: currentStepName,
              outputType: getOutputType(state),
              hasToolCalls: hasToolCalls(state),
            } as Record<string, any>
          );
        }

        // Emit STATE_SNAPSHOT after state-stabilizing events (not during streaming)
        // Per AG-UI spec and LangGraph implementation: emit only when streaming has completed
        // and state is stable. STATE_DELTA is NOT used in actual LangGraph implementations.
        if (validated.emitStateSnapshots !== "none") {
          // Only emit STATE_SNAPSHOT after streaming completes (state-stabilizing event)
          // This follows the LangGraph pattern: emit after tool/text streaming ends
          const filteredState = cleanLangChainData(state);
          const snapshot = validated.stateMapper 
            ? validated.stateMapper(filteredState) 
            : filteredState;
          
          // Remove messages from state snapshot (messages are in MESSAGES_SNAPSHOT)
          if (!validated.stateMapper && snapshot && typeof snapshot === "object") {
            delete (snapshot as any).messages;
          }
          
          // Only emit if we have meaningful state to share
          const stateKeys = snapshot ? Object.keys(snapshot).filter(k => snapshot[k] !== undefined && snapshot[k] !== null) : [];
           if (stateKeys.length > 0) {
             transport.emit({
               type: "STATE_SNAPSHOT",
               snapshot,
               timestamp: Date.now(),
             });
           }
         }
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
              timestamp: Date.now(),
            });
        }

        const stateAny = state as any;
        if (stateAny.error) {
          const error = stateAny.error;
          const errorMessage = error instanceof Error ? error.message : String(error);
          transport.emit({
            type: "RUN_ERROR",
            message:
              validated.errorDetailLevel === "full" ||
              validated.errorDetailLevel === "message"
                ? errorMessage
                : "",
            code: "AGENT_EXECUTION_ERROR",
            timestamp: Date.now(),
            // REMOVED: threadId, runId, parentRunId
          });
        } else {
          transport.emit({
            type: "RUN_FINISHED",
            threadId: threadId!,
            runId: runId!,
            result: validated.resultMapper ? validated.resultMapper(state) : undefined,
            timestamp: Date.now(),
          });
        }
      } catch {
        // Fail-safe
      }

      return {};
    },
  });
}
