import type {
  FunctionCallStartedEvent,
  InternalEventEmitter,
} from "@/core/events.js";
import type { OpenResponsesCallbackHandler } from "@/core/factory.js";

export interface OpenResponsesCallbackBridgeOptions {
  emitter: InternalEventEmitter;
  generateId: () => string;
}

type RecordValue = Record<string, unknown>;

interface ActiveFunctionCall {
  itemId: string;
  callId: string;
}

const isRecord = (value: unknown): value is RecordValue => {
  return typeof value === "object" && value !== null;
};

const getString = (value: RecordValue, key: string): string | undefined => {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
};

const getNestedRecord = (
  value: RecordValue,
  key: string
): RecordValue | undefined => {
  const candidate = value[key];
  return isRecord(candidate) ? candidate : undefined;
};

const safeStringify = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const normalizeToolName = (action: unknown): string => {
  if (!isRecord(action)) {
    return "function_call";
  }

  return (
    getString(action, "tool") ??
    getString(action, "toolName") ??
    getString(action, "name") ??
    "function_call"
  );
};

const normalizeCallId = (action: unknown, fallbackId: string): string => {
  if (!isRecord(action)) {
    return fallbackId;
  }

  return (
    getString(action, "toolCallId") ??
    getString(action, "tool_call_id") ??
    getString(action, "callId") ??
    getString(action, "call_id") ??
    getString(action, "id") ??
    fallbackId
  );
};

const getActionToolInput = (action: unknown): unknown => {
  if (!isRecord(action)) {
    return undefined;
  }

  if ("toolInput" in action) {
    return action.toolInput;
  }

  if ("tool_input" in action) {
    return action.tool_input;
  }

  if ("args" in action) {
    return action.args;
  }

  if ("arguments" in action) {
    return action.arguments;
  }

  return undefined;
};

const getDirectArgumentDelta = (action: RecordValue): string | undefined => {
  return (
    getString(action, "argumentsDelta") ??
    getString(action, "arguments_delta") ??
    getString(action, "toolInputDelta") ??
    getString(action, "tool_input_delta")
  );
};

const getDirectArgumentChunks = (action: RecordValue): string[] => {
  const directChunks = action.argumentDeltas ?? action.arguments_deltas;
  if (!Array.isArray(directChunks)) {
    return [];
  }

  return directChunks.filter(
    (value): value is string => typeof value === "string"
  );
};

const getMessageLogEntries = (action: RecordValue): unknown[] => {
  if (Array.isArray(action.messageLog)) {
    return action.messageLog;
  }

  if (Array.isArray(action.message_log)) {
    return action.message_log;
  }

  return [];
};

const getDeltasFromMessageLogEntry = (entry: unknown): string[] => {
  if (!isRecord(entry)) {
    return [];
  }

  const additionalKwargs = getNestedRecord(entry, "additional_kwargs");
  const toolCalls = additionalKwargs?.tool_calls;
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  const deltas: string[] = [];
  for (const toolCall of toolCalls) {
    if (!isRecord(toolCall)) {
      continue;
    }

    const functionRecord = getNestedRecord(toolCall, "function");
    if (!functionRecord) {
      continue;
    }

    const delta =
      getString(functionRecord, "arguments_delta") ??
      getString(functionRecord, "delta");
    if (delta) {
      deltas.push(delta);
    }
  }

  return deltas;
};

const getArgumentDeltas = (action: unknown): string[] => {
  if (!isRecord(action)) {
    return [];
  }

  const directDelta = getDirectArgumentDelta(action);
  if (directDelta) {
    return [directDelta];
  }

  const directChunks = getDirectArgumentChunks(action);
  if (directChunks.length > 0) {
    return directChunks;
  }

  return getMessageLogEntries(action).flatMap(getDeltasFromMessageLogEntry);
};

const getObservedArguments = (action: unknown): string | undefined => {
  const toolInput = getActionToolInput(action);
  if (toolInput !== undefined) {
    return safeStringify(toolInput);
  }

  if (!isRecord(action)) {
    return undefined;
  }

  const directArguments =
    getString(action, "arguments") ?? getString(action, "args");
  if (directArguments) {
    return directArguments;
  }

  return undefined;
};

const normalizeToolNameFromRun = (
  serialized: unknown,
  runName?: string
): string => {
  if (runName) {
    return runName;
  }

  if (!isRecord(serialized)) {
    return "tool";
  }

  return getString(serialized, "name") ?? getString(serialized, "id") ?? "tool";
};

export const createOpenResponsesCallbackBridge = (
  options: OpenResponsesCallbackBridgeOptions
): OpenResponsesCallbackHandler => {
  const activeMessageItems = new Map<string, string>();
  const activeFunctionCallsByAgentRun = new Map<string, ActiveFunctionCall>();
  const activeFunctionCallsByToolRun = new Map<string, ActiveFunctionCall>();
  const startedRuns = new Set<string>();
  const completedRuns = new Set<string>();
  const failedRuns = new Set<string>();

  const emitRunStarted = (runId: string, parentRunId?: string): void => {
    if (startedRuns.has(runId)) {
      return;
    }

    startedRuns.add(runId);
    options.emitter.emit(
      parentRunId === undefined
        ? { type: "run.started", runId }
        : { type: "run.started", runId, parentRunId }
    );
  };

  const ensureMessageItem = (runId: string): string => {
    const existing = activeMessageItems.get(runId);
    if (existing) {
      return existing;
    }

    const itemId = options.generateId();
    activeMessageItems.set(runId, itemId);
    options.emitter.emit({ type: "message.started", itemId, runId });
    return itemId;
  };

  const emitFunctionCallStarted = (
    runId: string,
    action: unknown
  ): ActiveFunctionCall => {
    const itemId = options.generateId();
    const callId = normalizeCallId(action, itemId);
    const event: FunctionCallStartedEvent = {
      type: "function_call.started",
      itemId,
      name: normalizeToolName(action),
      callId,
    };

    const deltas = getArgumentDeltas(action);
    if (deltas.length === 0) {
      const observedArguments = getObservedArguments(action);
      if (observedArguments !== undefined) {
        event.arguments = observedArguments;
      }
    }

    const active = { itemId, callId };
    activeFunctionCallsByAgentRun.set(runId, active);
    options.emitter.emit(event);

    for (const delta of deltas) {
      options.emitter.emit({
        type: "function_call_arguments.delta",
        itemId,
        delta,
      });
    }

    return active;
  };

  const completeFunctionCall = (
    active: ActiveFunctionCall | undefined
  ): void => {
    if (!active) {
      return;
    }

    options.emitter.emit({
      type: "function_call.completed",
      itemId: active.itemId,
    });
  };

  const emitRunFailed = (runId: string, error: unknown): void => {
    if (failedRuns.has(runId)) {
      return;
    }

    failedRuns.add(runId);
    options.emitter.emit({ type: "run.failed", runId, error });
  };

  const emitRunCompleted = (runId: string): void => {
    if (completedRuns.has(runId) || failedRuns.has(runId)) {
      return;
    }

    completedRuns.add(runId);
    options.emitter.emit({ type: "run.completed", runId });
  };

  return {
    handleChatModelStart(_llm, _messages, runId, parentRunId): void {
      emitRunStarted(runId, parentRunId);
      ensureMessageItem(runId);
    },

    handleLLMNewToken(token, _chunk, runId): void {
      const itemId = ensureMessageItem(runId);
      options.emitter.emit({ type: "text.delta", itemId, delta: token });
    },

    handleLLMEnd(_output, runId): void {
      const itemId = activeMessageItems.get(runId);
      if (!itemId) {
        return;
      }

      options.emitter.emit({ type: "text.completed", itemId });
    },

    handleLLMError(error, runId): void {
      emitRunFailed(runId, error);
    },

    handleToolStart(
      serialized,
      input,
      runId,
      parentRunId,
      _tags,
      _metadata,
      runName
    ): void {
      const toolName = normalizeToolNameFromRun(serialized, runName);
      options.emitter.emit({
        type: "tool.started",
        runId,
        toolName,
        input: safeStringify(input),
      });

      if (parentRunId) {
        const activeFunctionCall =
          activeFunctionCallsByAgentRun.get(parentRunId);
        if (activeFunctionCall) {
          activeFunctionCallsByToolRun.set(runId, activeFunctionCall);
        }
      }
    },

    handleToolEnd(output, runId, parentRunId): void {
      options.emitter.emit({ type: "tool.completed", runId, output });

      const active = activeFunctionCallsByToolRun.get(runId);
      if (active) {
        completeFunctionCall(active);
      } else if (parentRunId) {
        completeFunctionCall(activeFunctionCallsByAgentRun.get(parentRunId));
      }

      activeFunctionCallsByToolRun.delete(runId);
      if (parentRunId) {
        activeFunctionCallsByAgentRun.delete(parentRunId);
      }
    },

    handleToolError(error, runId, parentRunId): void {
      options.emitter.emit({ type: "tool.error", runId, error });
      activeFunctionCallsByToolRun.delete(runId);
      if (parentRunId) {
        activeFunctionCallsByAgentRun.delete(parentRunId);
      }
      emitRunFailed(parentRunId ?? runId, error);
    },

    handleAgentAction(action, runId): void {
      emitRunStarted(runId);
      emitFunctionCallStarted(runId, action);
    },

    handleAgentEnd(_result, runId): void {
      emitRunCompleted(runId);
    },

    handleChainError(error, runId): void {
      emitRunFailed(runId, error);
    },
  };
};
