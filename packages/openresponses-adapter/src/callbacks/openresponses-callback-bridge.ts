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

type TerminalRunStatus = "completed" | "failed";

const MAX_TERMINAL_RUNS = 256;

interface PendingFunctionCall {
  readonly itemId: string;
  readonly toolName: string;
  readonly argumentDeltas: string[];
  readonly observedArguments?: string;
  callId?: string;
  startedEmitted: boolean;
  toolRunId?: string;
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
    const stringified = JSON.stringify(value);
    return stringified ?? String(value);
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

const extractCallId = (action: unknown): string | undefined => {
  if (!isRecord(action)) {
    return undefined;
  }

  return (
    getString(action, "toolCallId") ??
    getString(action, "tool_call_id") ??
    getString(action, "callId") ??
    getString(action, "call_id") ??
    getString(action, "id")
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

const getSerializedName = (serialized: RecordValue): string | undefined => {
  const directName = getString(serialized, "name");
  if (directName) {
    return directName;
  }

  const id = serialized.id;
  if (!Array.isArray(id)) {
    return undefined;
  }

  for (let index = id.length - 1; index >= 0; index--) {
    const part = id[index];
    if (typeof part === "string" && part.length > 0) {
      return part;
    }
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

  return getSerializedName(serialized) ?? "tool";
};

export const createOpenResponsesCallbackBridge = (
  options: OpenResponsesCallbackBridgeOptions
): OpenResponsesCallbackHandler => {
  const activeMessageItems = new Map<string, string>();
  const pendingFunctionCallsByAgentRun = new Map<
    string,
    PendingFunctionCall[]
  >();
  const activeFunctionCallsByToolRun = new Map<string, PendingFunctionCall>();
  const pendingFunctionCallsByCallId = new Map<string, PendingFunctionCall>();
  const startedRuns = new Set<string>();
  const terminalRuns = new Map<string, TerminalRunStatus>();
  const terminalRunOrder: string[] = [];

  const emitRunStarted = (runId: string, parentRunId?: string): void => {
    if (terminalRuns.has(runId)) {
      terminalRuns.delete(runId);
      const terminalRunIndex = terminalRunOrder.indexOf(runId);
      if (terminalRunIndex >= 0) {
        terminalRunOrder.splice(terminalRunIndex, 1);
      }
      cleanupRunState(runId);
    }

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

  const getPendingFunctionCalls = (
    agentRunId: string
  ): PendingFunctionCall[] => {
    const existing = pendingFunctionCallsByAgentRun.get(agentRunId);
    if (existing) {
      return existing;
    }

    const next: PendingFunctionCall[] = [];
    pendingFunctionCallsByAgentRun.set(agentRunId, next);
    return next;
  };

  const registerPendingFunctionCall = (
    agentRunId: string,
    pendingFunctionCall: PendingFunctionCall
  ): void => {
    getPendingFunctionCalls(agentRunId).push(pendingFunctionCall);
    if (pendingFunctionCall.callId) {
      pendingFunctionCallsByCallId.set(
        pendingFunctionCall.callId,
        pendingFunctionCall
      );
    }
  };

  const emitFunctionCallStarted = (
    pendingFunctionCall: PendingFunctionCall,
    callId: string
  ): void => {
    if (pendingFunctionCall.startedEmitted) {
      return;
    }

    pendingFunctionCall.callId = callId;
    pendingFunctionCall.startedEmitted = true;
    pendingFunctionCallsByCallId.set(callId, pendingFunctionCall);

    const event: FunctionCallStartedEvent = {
      type: "function_call.started",
      itemId: pendingFunctionCall.itemId,
      name: pendingFunctionCall.toolName,
      callId,
    };

    if (
      pendingFunctionCall.argumentDeltas.length === 0 &&
      pendingFunctionCall.observedArguments !== undefined
    ) {
      event.arguments = pendingFunctionCall.observedArguments;
    }

    options.emitter.emit(event);

    for (const delta of pendingFunctionCall.argumentDeltas) {
      options.emitter.emit({
        type: "function_call_arguments.delta",
        itemId: pendingFunctionCall.itemId,
        delta,
      });
    }
  };

  const createPendingFunctionCall = (action: unknown): PendingFunctionCall => {
    const observedArguments = getObservedArguments(action);
    const callId = extractCallId(action);

    return {
      itemId: options.generateId(),
      toolName: normalizeToolName(action),
      argumentDeltas: getArgumentDeltas(action),
      ...(observedArguments !== undefined ? { observedArguments } : {}),
      ...(callId !== undefined ? { callId } : {}),
      startedEmitted: false,
    };
  };

  const getAvailablePendingFunctionCalls = (
    agentRunId: string
  ): PendingFunctionCall[] => {
    const pendingFunctionCalls = pendingFunctionCallsByAgentRun.get(agentRunId);
    if (!pendingFunctionCalls) {
      return [];
    }

    return pendingFunctionCalls.filter((pendingFunctionCall) => {
      return pendingFunctionCall.toolRunId === undefined;
    });
  };

  const findPendingFunctionCallByCallId = (
    pendingFunctionCalls: PendingFunctionCall[],
    toolCallId: string
  ): PendingFunctionCall | undefined => {
    const matchedByCallId = pendingFunctionCallsByCallId.get(toolCallId);
    if (matchedByCallId && pendingFunctionCalls.includes(matchedByCallId)) {
      return matchedByCallId;
    }

    return undefined;
  };

  const findPendingFunctionCallByToolName = (
    pendingFunctionCalls: PendingFunctionCall[],
    toolName: string,
    toolCallId?: string
  ): PendingFunctionCall | undefined => {
    for (const pendingFunctionCall of pendingFunctionCalls) {
      if (pendingFunctionCall.toolName !== toolName) {
        continue;
      }

      if (
        toolCallId !== undefined &&
        pendingFunctionCall.callId !== undefined
      ) {
        continue;
      }

      return pendingFunctionCall;
    }

    return undefined;
  };

  const resolvePendingFunctionCallForToolStart = (
    agentRunId: string,
    toolName: string,
    toolCallId?: string
  ): PendingFunctionCall | undefined => {
    const pendingFunctionCalls = getAvailablePendingFunctionCalls(agentRunId);
    if (pendingFunctionCalls.length === 0) {
      return undefined;
    }

    if (toolCallId) {
      const matchedByCallId = findPendingFunctionCallByCallId(
        pendingFunctionCalls,
        toolCallId
      );
      if (matchedByCallId) {
        return matchedByCallId;
      }
    }

    const matchedByToolName = findPendingFunctionCallByToolName(
      pendingFunctionCalls,
      toolName,
      toolCallId
    );
    if (matchedByToolName) {
      return matchedByToolName;
    }

    return pendingFunctionCalls[0];
  };

  const resolvePendingFunctionCallForToolEnd = (
    toolRunId: string,
    agentRunId?: string
  ): PendingFunctionCall | undefined => {
    const activeFunctionCall = activeFunctionCallsByToolRun.get(toolRunId);
    if (activeFunctionCall) {
      return activeFunctionCall;
    }

    if (!agentRunId) {
      return undefined;
    }

    const pendingFunctionCalls = pendingFunctionCallsByAgentRun.get(agentRunId);
    if (!pendingFunctionCalls || pendingFunctionCalls.length === 0) {
      return undefined;
    }

    for (const pendingFunctionCall of pendingFunctionCalls) {
      if (pendingFunctionCall.startedEmitted) {
        return pendingFunctionCall;
      }
    }

    return pendingFunctionCalls[0];
  };

  const completeFunctionCall = (
    pendingFunctionCall: PendingFunctionCall | undefined
  ): void => {
    if (!pendingFunctionCall) {
      return;
    }

    options.emitter.emit({
      type: "function_call.completed",
      itemId: pendingFunctionCall.itemId,
    });
  };

  const cleanupFunctionCallState = (
    pendingFunctionCall: PendingFunctionCall | undefined,
    agentRunId?: string,
    toolRunId?: string
  ): void => {
    if (toolRunId) {
      activeFunctionCallsByToolRun.delete(toolRunId);
    }

    if (!pendingFunctionCall) {
      return;
    }

    if (pendingFunctionCall.callId) {
      pendingFunctionCallsByCallId.delete(pendingFunctionCall.callId);
    }

    if (!agentRunId) {
      return;
    }

    const pendingFunctionCalls = pendingFunctionCallsByAgentRun.get(agentRunId);
    if (!pendingFunctionCalls) {
      return;
    }

    const remaining = pendingFunctionCalls.filter((candidate) => {
      return candidate !== pendingFunctionCall;
    });

    if (remaining.length === 0) {
      pendingFunctionCallsByAgentRun.delete(agentRunId);
      return;
    }

    pendingFunctionCallsByAgentRun.set(agentRunId, remaining);
  };

  const cleanupRunState = (runId: string): void => {
    activeMessageItems.delete(runId);

    const pendingFunctionCalls = pendingFunctionCallsByAgentRun.get(runId);
    if (pendingFunctionCalls) {
      for (const pendingFunctionCall of pendingFunctionCalls) {
        if (pendingFunctionCall.callId) {
          pendingFunctionCallsByCallId.delete(pendingFunctionCall.callId);
        }

        if (pendingFunctionCall.toolRunId) {
          activeFunctionCallsByToolRun.delete(pendingFunctionCall.toolRunId);
        }
      }

      pendingFunctionCallsByAgentRun.delete(runId);
    }

    startedRuns.delete(runId);
  };

  const rememberTerminalRun = (
    runId: string,
    status: TerminalRunStatus
  ): void => {
    if (terminalRuns.has(runId)) {
      terminalRuns.set(runId, status);
      return;
    }

    terminalRuns.set(runId, status);
    terminalRunOrder.push(runId);

    while (terminalRunOrder.length > MAX_TERMINAL_RUNS) {
      const oldestRunId = terminalRunOrder.shift();
      if (oldestRunId) {
        terminalRuns.delete(oldestRunId);
      }
    }
  };

  const emitRunFailed = (runId: string, error: unknown): void => {
    if (terminalRuns.has(runId)) {
      return;
    }

    rememberTerminalRun(runId, "failed");
    options.emitter.emit({ type: "run.failed", runId, error });
    cleanupRunState(runId);
  };

  const emitRunCompleted = (runId: string): void => {
    if (terminalRuns.has(runId)) {
      return;
    }

    rememberTerminalRun(runId, "completed");
    options.emitter.emit({ type: "run.completed", runId });
    cleanupRunState(runId);
  };

  return {
    handleChatModelStart(_llm, _messages, runId, parentRunId): void {
      emitRunStarted(runId, parentRunId);
    },

    handleLLMNewToken(token, _chunk, runId): void {
      const itemId = ensureMessageItem(runId);
      options.emitter.emit({ type: "text.delta", itemId, delta: token });
    },

    handleLLMEnd(_output, runId): void {
      const itemId = activeMessageItems.get(runId);
      if (itemId) {
        options.emitter.emit({ type: "text.completed", itemId });
      }

      emitRunCompleted(runId);
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
      runName,
      toolCallId
    ): void {
      const toolName = normalizeToolNameFromRun(serialized, runName);
      const pendingFunctionCall = parentRunId
        ? resolvePendingFunctionCallForToolStart(
            parentRunId,
            toolName,
            toolCallId
          )
        : undefined;

      if (pendingFunctionCall) {
        const resolvedCallId =
          toolCallId ??
          pendingFunctionCall.callId ??
          pendingFunctionCall.itemId;
        emitFunctionCallStarted(pendingFunctionCall, resolvedCallId);
        pendingFunctionCall.toolRunId = runId;
        activeFunctionCallsByToolRun.set(runId, pendingFunctionCall);
      }

      options.emitter.emit({
        type: "tool.started",
        runId,
        toolName,
        input: safeStringify(input),
      });
    },

    handleToolEnd(output, runId, parentRunId): void {
      options.emitter.emit({ type: "tool.completed", runId, output });

      const pendingFunctionCall = resolvePendingFunctionCallForToolEnd(
        runId,
        parentRunId
      );
      completeFunctionCall(pendingFunctionCall);
      cleanupFunctionCallState(pendingFunctionCall, parentRunId, runId);
    },

    handleToolError(error, runId, parentRunId): void {
      options.emitter.emit({ type: "tool.error", runId, error });
      const pendingFunctionCall = resolvePendingFunctionCallForToolEnd(
        runId,
        parentRunId
      );
      cleanupFunctionCallState(pendingFunctionCall, parentRunId, runId);
    },

    handleAgentAction(action, runId, parentRunId): void {
      emitRunStarted(runId, parentRunId);
      const pendingFunctionCall = createPendingFunctionCall(action);
      registerPendingFunctionCall(runId, pendingFunctionCall);

      if (pendingFunctionCall.callId) {
        emitFunctionCallStarted(
          pendingFunctionCall,
          pendingFunctionCall.callId
        );
      }
    },

    handleAgentEnd(_result, runId): void {
      emitRunCompleted(runId);
    },

    handleChainError(error, runId): void {
      emitRunFailed(runId, error);
    },
  };
};
