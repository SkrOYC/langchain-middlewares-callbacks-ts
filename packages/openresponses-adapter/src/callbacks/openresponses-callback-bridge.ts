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

const getToolCallDeltaKey = (toolCall: RecordValue): string | undefined => {
  const toolCallId = getString(toolCall, "id");
  if (toolCallId) {
    return toolCallId;
  }

  const functionRecord = getNestedRecord(toolCall, "function");
  if (!functionRecord) {
    return undefined;
  }

  return getString(functionRecord, "name");
};

const appendToolCallDeltas = (
  deltasByKey: Map<string, string[]>,
  toolCall: RecordValue
): void => {
  const deltaKey = getToolCallDeltaKey(toolCall);
  if (!deltaKey) {
    return;
  }

  const functionRecord = getNestedRecord(toolCall, "function");
  if (!functionRecord) {
    return;
  }

  const delta =
    getString(functionRecord, "arguments_delta") ??
    getString(functionRecord, "delta");
  if (!delta) {
    return;
  }

  const existingDeltas = deltasByKey.get(deltaKey);
  if (existingDeltas) {
    existingDeltas.push(delta);
    return;
  }

  deltasByKey.set(deltaKey, [delta]);
};

const getMessageLogArgumentDeltas = (
  action: RecordValue
): Map<string, string[]> => {
  const deltasByKey = new Map<string, string[]>();

  for (const entry of getMessageLogEntries(action)) {
    if (!isRecord(entry)) {
      continue;
    }

    const additionalKwargs = getNestedRecord(entry, "additional_kwargs");
    const toolCalls = additionalKwargs?.tool_calls;
    if (!Array.isArray(toolCalls)) {
      continue;
    }

    for (const toolCall of toolCalls) {
      if (!isRecord(toolCall)) {
        continue;
      }

      appendToolCallDeltas(deltasByKey, toolCall);
    }
  }

  return deltasByKey;
};

const getArgumentDeltas = (
  action: unknown,
  sharedDeltasByKey?: Map<string, string[]>
): string[] => {
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

  const availableDeltasByKey =
    sharedDeltasByKey ?? getMessageLogArgumentDeltas(action);
  const actionCallId = extractCallId(action);
  if (actionCallId) {
    return availableDeltasByKey.get(actionCallId) ?? [];
  }

  const actionToolName = normalizeToolName(action);
  return availableDeltasByKey.get(actionToolName) ?? [];
};

const getObservedArguments = (action: unknown): string | undefined => {
  const toolInput = getActionToolInput(action);
  if (toolInput !== undefined) {
    return safeStringify(toolInput);
  }

  if (!isRecord(action)) {
    return undefined;
  }

  return getString(action, "arguments") ?? getString(action, "args");
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

const extractObservedDelta = (
  previous: string,
  next: string
): { delta: string; observed: string } => {
  if (next.length === 0) {
    return { delta: "", observed: previous };
  }

  if (next.startsWith(previous)) {
    return { delta: next.slice(previous.length), observed: next };
  }

  return { delta: next, observed: `${previous}${next}` };
};

const getChunkLike = (...candidates: unknown[]): RecordValue | undefined => {
  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }

    const wrappedChunk = candidate.chunk;
    if (isRecord(wrappedChunk)) {
      return wrappedChunk;
    }

    if (
      "message" in candidate ||
      "content" in candidate ||
      "contentBlocks" in candidate
    ) {
      return candidate;
    }
  }

  return undefined;
};

const getMessageLike = (value: unknown): RecordValue | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const message = value.message;
  return isRecord(message) ? message : value;
};

const getContentBlocks = (value: unknown): RecordValue[] => {
  const message = getMessageLike(value);
  if (!message) {
    return [];
  }

  const blockCandidates = [message.contentBlocks, message.content];
  for (const candidate of blockCandidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    return candidate.filter(isRecord);
  }

  return [];
};

const getAdditionalKwargs = (value: unknown): RecordValue | undefined => {
  const message = getMessageLike(value);
  if (!message) {
    return undefined;
  }

  return getNestedRecord(message, "additional_kwargs");
};

const getReasoningTextFromBlock = (block: RecordValue): string | undefined => {
  if (getString(block, "type") === "reasoning") {
    return getString(block, "reasoning") ?? getString(block, "text");
  }

  if (getString(block, "type") === "reasoning_text") {
    return getString(block, "text");
  }

  return undefined;
};

const getSummaryTextFromBlock = (block: RecordValue): string | undefined => {
  if (getString(block, "type") === "summary_text") {
    return getString(block, "text");
  }

  return undefined;
};

const getRefusalTextFromBlock = (block: RecordValue): string | undefined => {
  if (getString(block, "type") !== "refusal") {
    return undefined;
  }

  return getString(block, "refusal") ?? getString(block, "text");
};

const extractReasoningSummaryTexts = (value: unknown): string[] => {
  const blocks = getContentBlocks(value);
  const summaryTexts = blocks
    .map(getSummaryTextFromBlock)
    .filter((text): text is string => Boolean(text));
  if (summaryTexts.length > 0) {
    return summaryTexts;
  }

  const additionalKwargs = getAdditionalKwargs(value);
  if (!additionalKwargs) {
    return [];
  }

  const reasoning = additionalKwargs.reasoning;
  if (!Array.isArray(reasoning)) {
    return [];
  }

  const extracted: string[] = [];
  for (const candidate of reasoning) {
    if (!isRecord(candidate)) {
      continue;
    }

    const summary = candidate.summary;
    if (!Array.isArray(summary)) {
      continue;
    }

    for (const part of summary) {
      if (!isRecord(part)) {
        continue;
      }

      const summaryText = getString(part, "text");
      if (summaryText) {
        extracted.push(summaryText);
      }
    }
  }

  return extracted;
};

export const createOpenResponsesCallbackBridge = (
  options: OpenResponsesCallbackBridgeOptions
): OpenResponsesCallbackHandler => {
  const activeMessageItems = new Map<string, string>();
  const activeRefusalItems = new Map<string, string>();
  const activeReasoningItems = new Map<string, string>();
  const observedRefusalByRun = new Map<string, string>();
  const observedReasoningByRun = new Map<string, string>();
  const emittedAnnotationCounts = new Map<string, number>();
  const pendingFunctionCallsByAgentRun = new Map<
    string,
    PendingFunctionCall[]
  >();
  const activeFunctionCallsByToolRun = new Map<string, PendingFunctionCall>();
  const pendingFunctionCallsByCallId = new Map<string, PendingFunctionCall>();
  const sharedArgumentDeltasByRun = new Map<string, Map<string, string[]>>();
  const startedRuns = new Set<string>();
  const terminalRuns = new Map<string, TerminalRunStatus>();
  const terminalRunOrder: string[] = [];

  const cleanupRunState = (runId: string): void => {
    activeMessageItems.delete(runId);
    activeRefusalItems.delete(runId);
    activeReasoningItems.delete(runId);
    observedRefusalByRun.delete(runId);
    observedReasoningByRun.delete(runId);
    sharedArgumentDeltasByRun.delete(runId);

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
    terminalRuns.set(runId, status);
    terminalRunOrder.push(runId);

    while (terminalRunOrder.length > MAX_TERMINAL_RUNS) {
      const oldestRunId = terminalRunOrder.shift();
      if (oldestRunId) {
        terminalRuns.delete(oldestRunId);
      }
    }
  };

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

  const ensureRefusalItem = (runId: string): string => {
    const existing = activeRefusalItems.get(runId);
    if (existing) {
      return existing;
    }

    const itemId = options.generateId();
    activeRefusalItems.set(runId, itemId);
    options.emitter.emit({ type: "refusal.started", itemId, runId });
    return itemId;
  };

  const ensureReasoningItem = (runId: string): string => {
    const existing = activeReasoningItems.get(runId);
    if (existing) {
      return existing;
    }

    const itemId = options.generateId();
    activeReasoningItems.set(runId, itemId);
    options.emitter.emit({ type: "reasoning.started", itemId, runId });
    return itemId;
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

  const createPendingFunctionCall = (
    action: unknown,
    sharedDeltasByKey?: Map<string, string[]>
  ): PendingFunctionCall => {
    const observedArguments = getObservedArguments(action);
    const callId = extractCallId(action);

    return {
      itemId: options.generateId(),
      toolName: normalizeToolName(action),
      argumentDeltas: getArgumentDeltas(action, sharedDeltasByKey),
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
      const matchedByCallId = pendingFunctionCallsByCallId.get(toolCallId);
      if (matchedByCallId && pendingFunctionCalls.includes(matchedByCallId)) {
        return matchedByCallId;
      }
    }

    return pendingFunctionCalls.find((pendingFunctionCall) => {
      return pendingFunctionCall.toolName === toolName;
    });
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

    return pendingFunctionCalls.find((candidate) => candidate.startedEmitted);
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

  const emitObservedRefusal = (runId: string, refusal: string): void => {
    const itemId = ensureRefusalItem(runId);
    const previous = observedRefusalByRun.get(runId) ?? "";
    const { delta, observed } = extractObservedDelta(previous, refusal);
    observedRefusalByRun.set(runId, observed);
    if (delta.length > 0) {
      options.emitter.emit({ type: "refusal.delta", itemId, delta });
    }
  };

  const emitObservedReasoning = (runId: string, reasoning: string): void => {
    const itemId = ensureReasoningItem(runId);
    const previous = observedReasoningByRun.get(runId) ?? "";
    const { delta, observed } = extractObservedDelta(previous, reasoning);
    observedReasoningByRun.set(runId, observed);
    if (delta.length > 0) {
      options.emitter.emit({ type: "reasoning.delta", itemId, delta });
    }
  };

  const emitObservedAnnotations = (
    runId: string,
    blocks: RecordValue[]
  ): void => {
    const messageItemId = activeMessageItems.get(runId);
    if (!messageItemId) {
      return;
    }

    const outputTextBlock = blocks.find((block) => {
      return getString(block, "type") === "output_text";
    });
    if (!outputTextBlock) {
      return;
    }

    const annotations = outputTextBlock.annotations;
    if (!Array.isArray(annotations)) {
      return;
    }

    const emittedCount = emittedAnnotationCounts.get(messageItemId) ?? 0;
    for (const annotation of annotations.slice(emittedCount)) {
      if (!isRecord(annotation)) {
        continue;
      }

      options.emitter.emit({
        type: "output_text.annotation.added",
        itemId: messageItemId,
        annotation,
      });
    }

    emittedAnnotationCounts.set(messageItemId, annotations.length);
  };

  const observeChunk = (runId: string, ...candidates: unknown[]): void => {
    const chunk = getChunkLike(...candidates);
    if (!chunk) {
      return;
    }

    const contentBlocks = getContentBlocks(chunk);
    emitObservedAnnotations(runId, contentBlocks);

    for (const block of contentBlocks) {
      const refusal = getRefusalTextFromBlock(block);
      if (refusal) {
        emitObservedRefusal(runId, refusal);
      }

      const reasoning = getReasoningTextFromBlock(block);
      if (reasoning) {
        emitObservedReasoning(runId, reasoning);
      }
    }

    const additionalKwargs = getAdditionalKwargs(chunk);
    if (additionalKwargs) {
      const refusal = additionalKwargs.refusal;
      if (typeof refusal === "string") {
        emitObservedRefusal(runId, refusal);
      }
    }
  };

  const finalizeObservedFamilies = (runId: string, output?: unknown): void => {
    observeChunk(runId, output);

    const refusalItemId = activeRefusalItems.get(runId);
    if (refusalItemId) {
      options.emitter.emit({
        type: "refusal.completed",
        itemId: refusalItemId,
      });
      activeRefusalItems.delete(runId);
    }

    const reasoningItemId = activeReasoningItems.get(runId);
    if (reasoningItemId) {
      options.emitter.emit({
        type: "reasoning.completed",
        itemId: reasoningItemId,
        summaryTexts: extractReasoningSummaryTexts(output),
      });
      activeReasoningItems.delete(runId);
    }
  };

  return {
    handleChatModelStart(_llm, _messages, runId, parentRunId): void {
      emitRunStarted(runId, parentRunId);
    },

    handleLLMNewToken(
      token,
      idxOrChunk,
      runId,
      parentRunId,
      tags,
      fields
    ): void {
      emitRunStarted(runId, parentRunId);

      if (token.length > 0) {
        const itemId = ensureMessageItem(runId);
        options.emitter.emit({ type: "text.delta", itemId, delta: token });
      }

      observeChunk(runId, idxOrChunk, fields, tags);
    },

    handleLLMEnd(output, runId): void {
      const itemId = activeMessageItems.get(runId);
      if (itemId) {
        options.emitter.emit({ type: "text.completed", itemId });
        activeMessageItems.delete(runId);
      }

      finalizeObservedFamilies(runId, output);
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
      const pendingFunctionCall = resolvePendingFunctionCallForToolEnd(
        runId,
        parentRunId
      );
      options.emitter.emit(
        pendingFunctionCall?.callId
          ? {
              type: "tool.completed",
              runId,
              output,
              callId: pendingFunctionCall.callId,
            }
          : { type: "tool.completed", runId, output }
      );

      if (pendingFunctionCall) {
        options.emitter.emit({
          type: "function_call.completed",
          itemId: pendingFunctionCall.itemId,
        });

        if (pendingFunctionCall.callId) {
          options.emitter.emit({
            type: "function_call_output.completed",
            itemId: options.generateId(),
            callId: pendingFunctionCall.callId,
            output: typeof output === "string" ? output : safeStringify(output),
          });
        }
      }

      cleanupFunctionCallState(pendingFunctionCall, parentRunId, runId);
    },

    handleToolError(error, runId, parentRunId): void {
      options.emitter.emit({ type: "tool.error", runId, error });
      const pendingFunctionCall = resolvePendingFunctionCallForToolEnd(
        runId,
        parentRunId
      );
      if (pendingFunctionCall) {
        options.emitter.emit({
          type: "function_call.completed",
          itemId: pendingFunctionCall.itemId,
        });
      }
      cleanupFunctionCallState(pendingFunctionCall, parentRunId, runId);
    },

    handleAgentAction(action, runId, parentRunId): void {
      emitRunStarted(runId, parentRunId);

      const sharedDeltasByKey = isRecord(action)
        ? getMessageLogArgumentDeltas(action)
        : new Map<string, string[]>();
      if (sharedDeltasByKey.size > 0) {
        sharedArgumentDeltasByRun.set(runId, sharedDeltasByKey);
      }

      const pendingFunctionCall = createPendingFunctionCall(
        action,
        sharedArgumentDeltasByRun.get(runId)
      );
      registerPendingFunctionCall(runId, pendingFunctionCall);

      if (pendingFunctionCall.callId) {
        emitFunctionCallStarted(
          pendingFunctionCall,
          pendingFunctionCall.callId
        );
      }
    },

    handleAgentEnd(result, runId): void {
      const itemId = activeMessageItems.get(runId);
      if (itemId) {
        options.emitter.emit({ type: "text.completed", itemId });
        activeMessageItems.delete(runId);
      }

      finalizeObservedFamilies(runId, result);
      emitRunCompleted(runId);
    },

    handleChainError(error, runId): void {
      emitRunFailed(runId, error);
    },
  };
};
