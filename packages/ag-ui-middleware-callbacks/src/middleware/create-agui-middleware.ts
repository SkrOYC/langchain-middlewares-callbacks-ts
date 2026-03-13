/**
 * AG-UI Middleware Factory
 *
 * Creates middleware that integrates LangChain agents with the AG-UI protocol.
 */

import { type BaseEvent, EventType } from "@ag-ui/core";
import type { BaseMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import { z } from "zod";
import { cleanLangChainData } from "../utils/cleaner";
import { generateDeterministicId } from "../utils/id-generator";
import { mapLangChainMessageToAGUI } from "../utils/message-mapper";
import { computeStateDelta } from "../utils/state-diff";
import { isValidEvent, validateEvent } from "../utils/validation";
import { resolveLifecycleIds } from "./id-resolution";
import {
  type AGUIMiddlewareOptions,
  AGUIMiddlewareOptionsSchema,
} from "./types";

/**
 * Check if validateEvents mode is truthy (true or "strict").
 */
function isValidationEnabled(
  validateEvents: AGUIMiddlewareOptions["validateEvents"]
): boolean {
  return validateEvents === true || validateEvents === "strict";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonArrayRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

type StateMessageLike = BaseMessage & {
  content?: unknown;
  toolCalls?: unknown;
};

function isStateMessageLike(value: unknown): value is StateMessageLike {
  return isRecord(value) && "content" in value;
}

function getMessages(state: unknown): StateMessageLike[] {
  if (!(isRecord(state) && Array.isArray(state.messages))) {
    return [];
  }

  return state.messages.filter(isStateMessageLike);
}

function getStateError(state: unknown): unknown {
  if (!isRecord(state)) {
    return undefined;
  }

  return state.error;
}

function getRuntimeContext(runtime: unknown): unknown {
  if (!isRecord(runtime)) {
    return undefined;
  }

  return runtime.context;
}

function getRuntimeInput(runtime: unknown): unknown {
  if (!(isRecord(runtime) && isRecord(runtime.config))) {
    return undefined;
  }

  return runtime.config.input;
}

function getRuntimeModelType(runtime: unknown): string | undefined {
  if (
    !(
      isRecord(runtime) &&
      isRecord(runtime.config) &&
      isRecord(runtime.config.model)
    )
  ) {
    return undefined;
  }

  return typeof runtime.config.model._modelType === "string"
    ? runtime.config.model._modelType
    : undefined;
}

function getEventTypeLabel(event: unknown): string {
  if (isRecord(event) && typeof event.type === "string") {
    return event.type;
  }

  return "[unknown]";
}

/**
 * Interface for tracking agent execution activities.
 */
interface ActivityTracker {
  currentActivityId: string | undefined;
  currentActivityType: string;
  activityContent: unknown;
}

/**
 * Helper function to get a preview of the input for activity content.
 */
function getInputPreview(state: unknown): string {
  const lastMessage = getMessages(state).at(-1);
  if (lastMessage && typeof lastMessage.content === "string") {
    return (
      lastMessage.content.substring(0, 100) +
      (lastMessage.content.length > 100 ? "..." : "")
    );
  }

  return "[no input preview]";
}

/**
 * Helper function to get the type of output from state.
 */
function getOutputType(state: unknown): string {
  const lastMessage = getMessages(state).at(-1);
  if (
    Array.isArray(lastMessage?.toolCalls) &&
    lastMessage.toolCalls.length > 0
  ) {
    return "tool_calls";
  }

  if (lastMessage?.content) {
    return "text";
  }

  return "unknown";
}

/**
 * Helper function to check if state contains tool calls.
 */
function hasToolCalls(state: unknown): boolean {
  return getMessages(state).some(
    (message) =>
      Array.isArray(message.toolCalls) && message.toolCalls.length > 0
  );
}

/**
 * Emit ACTIVITY_SNAPSHOT or ACTIVITY_DELTA based on current state.
 * ACTIVITY_SNAPSHOT = new activity or significant change
 * ACTIVITY_DELTA = incremental update
 */
function emitActivityUpdate(
  emitCallback: (event: BaseEvent) => void,
  currentRunId: string | undefined,
  stepIndex: number,
  activityTracker: ActivityTracker,
  status: "started" | "processing" | "completed",
  activityMapper: AGUIMiddlewareOptions["activityMapper"],
  details?: Record<string, unknown>
): void {
  if (!currentRunId) {
    return;
  }

  const activityId = `activity-${currentRunId}-${stepIndex}`;
  const baseContent = {
    status,
    timestamp: Date.now(),
    ...details,
  };

  // Apply activityMapper if provided
  const finalContent = activityMapper
    ? activityMapper(baseContent)
    : baseContent;

  if (
    !activityTracker.currentActivityId ||
    activityTracker.currentActivityId !== activityId
  ) {
    // New activity - emit SNAPSHOT
    activityTracker.currentActivityId = activityId;
    activityTracker.currentActivityType = "AGENT_STEP";
    activityTracker.activityContent = finalContent;

    emitCallback({
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: activityId,
      activityType: "AGENT_STEP",
      content: finalContent,
      replace: true,
    } as BaseEvent);
  } else {
    // Existing activity - emit DELTA
    const patch = computeStateDelta(
      activityTracker.activityContent,
      finalContent
    );
    if (patch.length > 0) {
      activityTracker.activityContent = finalContent;

      emitCallback({
        type: EventType.ACTIVITY_DELTA,
        messageId: activityId,
        activityType: "AGENT_STEP",
        patch,
      } as BaseEvent);
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

  type SnapshotMode = NonNullable<AGUIMiddlewareOptions["emitStateSnapshots"]>;
  type SnapshotPhase = "initial" | "final";

  // Create emit function with optional validation
  // In "strict" mode, throw on invalid events; in true mode, log warnings
  const emitEvent = (event: BaseEvent) => {
    if (isValidationEnabled(validated.validateEvents)) {
      const isValid = isValidEvent(event);
      if (!isValid) {
        const error = validateEvent(event).error;
        if (validated.validateEvents === "strict") {
          throw new Error(`Invalid AG-UI event: ${error?.message}`);
        }
        console.warn(
          "[AG-UI Validation] Invalid event:",
          getEventTypeLabel(event),
          error
        );
      }
    }
    validated.publish(event);
  };

  const shouldEmitStateSnapshot = (
    mode: SnapshotMode,
    phase: SnapshotPhase
  ): boolean => {
    if (mode === "none") {
      return false;
    }

    if (mode === "all") {
      return true;
    }

    return mode === phase;
  };

  const mapStateSnapshot = (state: unknown): unknown => {
    const cleanedState = cleanLangChainData(state);
    const snapshot = validated.stateMapper
      ? validated.stateMapper(cleanedState)
      : cleanedState;

    // Remove messages from state snapshot by default to avoid redundancy
    if (!validated.stateMapper && isNonArrayRecord(snapshot)) {
      const { messages: _messages, ...snapshotWithoutMessages } = snapshot;
      return snapshotWithoutMessages;
    }

    return snapshot;
  };

  const emitStateSnapshotIfConfigured = (
    phase: SnapshotPhase,
    state: unknown
  ): void => {
    if (!shouldEmitStateSnapshot(validated.emitStateSnapshots, phase)) {
      return;
    }

    const snapshot = mapStateSnapshot(state);
    emitEvent({
      type: EventType.STATE_SNAPSHOT,
      snapshot,
      timestamp: Date.now(),
    } as BaseEvent);
  };

  interface MiddlewareRunState {
    threadId: string;
    runId: string;
    currentStepName?: string;
    modelTurnIndex: number;
    activityTracker: ActivityTracker;
  }

  const runStates = new Map<string, MiddlewareRunState>();
  const runtimeRunIds = new WeakMap<object, string>();

  const lifecycleContextSchema = z.object({
    run_id: z.string().optional(),
    runId: z.string().optional(),
    thread_id: z.string().optional(),
    threadId: z.string().optional(),
  });

  const getOrCreateRunState = (runtime: unknown): MiddlewareRunState => {
    const runtimeKey = isRecord(runtime) ? runtime : undefined;
    const fallbackRunId = runtimeKey
      ? runtimeRunIds.get(runtimeKey)
      : undefined;
    const resolvedIds = resolveLifecycleIds({
      context: getRuntimeContext(runtime),
      threadIdOverride: validated.threadIdOverride,
      runIdOverride: validated.runIdOverride,
      createFallbackRunId: () => fallbackRunId ?? crypto.randomUUID(),
    });

    if (runtimeKey && !runtimeRunIds.has(runtimeKey)) {
      runtimeRunIds.set(runtimeKey, resolvedIds.runId);
    }

    const existing = runStates.get(resolvedIds.runId);
    if (existing) {
      if (!existing.threadId && resolvedIds.threadId) {
        existing.threadId = resolvedIds.threadId;
      }
      return existing;
    }

    const created: MiddlewareRunState = {
      threadId: resolvedIds.threadId,
      runId: resolvedIds.runId,
      modelTurnIndex: 0,
      activityTracker: {
        currentActivityId: undefined,
        currentActivityType: "AGENT_STEP",
        activityContent: {},
      },
    };

    runStates.set(created.runId, created);
    return created;
  };

  return createMiddleware({
    name: "ag-ui-lifecycle",
    contextSchema: lifecycleContextSchema,

    beforeAgent: (state, runtime) => {
      const runState = getOrCreateRunState(runtime);
      runState.modelTurnIndex = 0;
      runState.currentStepName = undefined;
      runState.activityTracker.currentActivityId = undefined;
      runState.activityTracker.currentActivityType = "AGENT_STEP";
      runState.activityTracker.activityContent = {};

      try {
        emitEvent({
          type: EventType.RUN_STARTED,
          threadId: runState.threadId,
          runId: runState.runId,
          input: cleanLangChainData(getRuntimeInput(runtime)),
          timestamp: Date.now(),
        } as BaseEvent);

        emitStateSnapshotIfConfigured("initial", state);

        const messages = getMessages(state);
        if (messages.length > 0) {
          emitEvent({
            type: EventType.MESSAGES_SNAPSHOT,
            messages: messages.map(mapLangChainMessageToAGUI),
            timestamp: Date.now(),
          } as BaseEvent);
        }
      } catch {
        // Fail-safe
      }

      return {};
    },

    beforeModel: (state, runtime) => {
      const runState = getOrCreateRunState(runtime);
      const turnIndex = runState.modelTurnIndex++;
      const messageId = generateDeterministicId(runState.runId, turnIndex);
      const stepName = `model_call_${messageId}`;
      runState.currentStepName = stepName;

      try {
        emitEvent({
          type: EventType.STEP_STARTED,
          stepName,
          timestamp: Date.now(),
          // REMOVED: runId, threadId
        } as BaseEvent);

        // Emit ACTIVITY_SNAPSHOT for new activity if activities are enabled
        if (validated.emitActivities) {
          emitActivityUpdate(
            emitEvent,
            runState.runId,
            turnIndex,
            runState.activityTracker,
            "started",
            validated.activityMapper,
            {
              stepName,
              modelName: getRuntimeModelType(runtime) ?? "unknown",
              inputPreview: getInputPreview(state),
            }
          );
        }

        // TEXT_MESSAGE_START is handled by AGUICallbackHandler
        // using deterministic IDs derived from the resolved run ID.
      } catch {
        // Fail-safe
      }

      return {};
    },

    afterModel: (state, runtime) => {
      const runtimeState = getOrCreateRunState(runtime);
      try {
        // TEXT_MESSAGE_END is handled by AGUICallbackHandler
        // using the same deterministic message ID.

        emitEvent({
          type: EventType.STEP_FINISHED,
          stepName: runtimeState.currentStepName || "",
          timestamp: Date.now(),
          // REMOVED: runId, threadId
        } as BaseEvent);

        // Emit ACTIVITY_DELTA for completed activity if activities are enabled
        if (validated.emitActivities && runtimeState.currentStepName) {
          const turnIndex = runtimeState.modelTurnIndex - 1;
          emitActivityUpdate(
            emitEvent,
            runtimeState.runId,
            turnIndex,
            runtimeState.activityTracker,
            "completed",
            validated.activityMapper,
            {
              stepName: runtimeState.currentStepName,
              outputType: getOutputType(state),
              hasToolCalls: hasToolCalls(state),
            }
          );
        }
      } catch {
        // Fail-safe
      }
      runtimeState.currentStepName = undefined;
      return {};
    },

    afterAgent: (state, runtime) => {
      const runState = getOrCreateRunState(runtime);
      try {
        emitStateSnapshotIfConfigured("final", state);

        const error = getStateError(state);
        if (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          emitEvent({
            type: EventType.RUN_ERROR,
            message:
              validated.errorDetailLevel === "full" ||
              validated.errorDetailLevel === "message"
                ? errorMessage
                : "",
            code: "AGENT_EXECUTION_ERROR",
            timestamp: Date.now(),
            // REMOVED: threadId, runId, parentRunId
          } as BaseEvent);
        } else {
          emitEvent({
            type: EventType.RUN_FINISHED,
            threadId: runState.threadId,
            runId: runState.runId,
            timestamp: Date.now(),
          } as BaseEvent);
        }
      } catch {
        // Fail-safe
      }

      runStates.delete(runState.runId);
      if (isRecord(runtime)) {
        runtimeRunIds.delete(runtime);
      }

      return {};
    },
  });
}
