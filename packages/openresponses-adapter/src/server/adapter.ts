/**
 * Open Responses Adapter
 *
 * Programmatic adapter without HTTP transport.
 */

import { createOpenResponsesCallbackBridge } from "../callbacks/openresponses-callback-bridge.js";
import {
  agentExecutionFailed,
  internalError,
  invalidRequest,
} from "../core/errors.js";
import type {
  InternalEventEmitter,
  InternalSemanticEvent,
} from "../core/events.js";
import type {
  OpenResponsesExecutionOptions,
  OpenResponsesHandlerOptions,
  OpenResponsesRequest,
  OpenResponsesResponse,
  PreviousResponseStore,
} from "../core/index.js";
import type { OpenResponsesEvent } from "../core/schemas.js";
import {
  getEffectiveToolChoiceMode,
  OPENRESPONSES_TOOL_POLICY_CONFIG_KEY,
  serializeNormalizedToolPolicy,
} from "../core/tool-policy.js";
import { OPENRESPONSES_REQUEST_CONTEXT_CONFIG_KEY } from "../core/types.js";
import { createAsyncEventQueue } from "../state/async-event-queue.js";
import { createCanonicalItemAccumulator } from "../state/item-accumulator.js";
import { createResponseLifecycle } from "../state/response-lifecycle.js";
import { createEventSerializer } from "./event-serializer.js";
import {
  buildStoredRequestInputItems,
  createStoredResponseRecord,
  isInternalError,
  materializeInvokeResponse,
  normalizeRequest,
  validateRequiredToolCallResult,
} from "./previous-response.js";
import {
  agentExecutionTimedOut,
  normalizeExecutionOptions,
  previousResponseLoadTimedOut,
  previousResponseSaveTimedOut,
  resolveTimeoutBudgets,
  withTimeout,
} from "./timeout.js";

export interface OpenResponsesAdapter {
  invoke(
    request: OpenResponsesRequest,
    signalOrOptions?: AbortSignal | OpenResponsesExecutionOptions
  ): Promise<OpenResponsesResponse>;

  stream(
    request: OpenResponsesRequest,
    signalOrOptions?: AbortSignal | OpenResponsesExecutionOptions
  ): Promise<AsyncIterable<OpenResponsesEvent | "[DONE]">>;
}

const toAgentExecutionFailed = (error: unknown): never => {
  if (isInternalError(error)) {
    throw error;
  }

  throw agentExecutionFailed(
    error instanceof Error ? error.message : "Agent execution failed",
    error
  );
};

const toInternalServerError = (message: string, error: unknown): never => {
  if (isInternalError(error)) {
    throw error;
  }

  throw internalError(message, error);
};

const materializeResponseOrThrow = (params: {
  request: OpenResponsesRequest;
  responseId: string;
  result: unknown;
  inputMessageCount: number;
  createdAt: number;
  completedAt: number;
  generateId: () => string;
}): OpenResponsesResponse => {
  try {
    return materializeInvokeResponse(params);
  } catch (error) {
    return toInternalServerError("Failed to materialize response", error);
  }
};

const requiresExecutionTimeEnforcement = (
  policy: Awaited<ReturnType<typeof normalizeRequest>>["toolPolicy"]
): boolean => {
  const effectiveMode = getEffectiveToolChoiceMode(policy.toolChoice);
  if (!policy.parallelToolCalls) {
    return true;
  }

  if (
    typeof policy.toolChoice === "object" &&
    policy.toolChoice.type === "function"
  ) {
    return true;
  }

  if (
    typeof policy.toolChoice === "object" &&
    policy.toolChoice.type === "allowed_tools"
  ) {
    return true;
  }

  return effectiveMode === "none";
};

const assertToolPolicySupport = (params: {
  toolPolicy: Awaited<ReturnType<typeof normalizeRequest>>["toolPolicy"];
  supportMode: OpenResponsesHandlerOptions["toolPolicySupport"];
}): void => {
  if (params.supportMode === "middleware") {
    return;
  }

  if (!requiresExecutionTimeEnforcement(params.toolPolicy)) {
    return;
  }

  throw invalidRequest(
    "This tool policy requires createOpenResponsesToolPolicyMiddleware() and toolPolicySupport: 'middleware'"
  );
};

const buildAgentConfig = (params: {
  signal: AbortSignal | undefined;
  runId: string;
  toolPolicy: Awaited<ReturnType<typeof normalizeRequest>>["toolPolicy"];
  requestContext: Record<string, unknown> | undefined;
  callbacks: OpenResponsesHandlerOptions["callbacks"] | undefined;
}): Record<string, unknown> => {
  const configurable: Record<string, unknown> = {
    run_id: params.runId,
    [OPENRESPONSES_TOOL_POLICY_CONFIG_KEY]: serializeNormalizedToolPolicy(
      params.toolPolicy
    ),
  };

  if (params.requestContext) {
    configurable[OPENRESPONSES_REQUEST_CONTEXT_CONFIG_KEY] =
      params.requestContext;
  }

  const config: Record<string, unknown> = {
    configurable,
  };

  if (params.signal !== undefined) {
    config.signal = params.signal;
  }

  if (params.callbacks && params.callbacks.length > 0) {
    config.callbacks = [...params.callbacks];
  }

  return config;
};

const buildNormalizeDeps = (
  options: OpenResponsesHandlerOptions,
  signal?: AbortSignal
): { previousResponseStore?: PreviousResponseStore; signal?: AbortSignal } => {
  const deps: {
    previousResponseStore?: PreviousResponseStore;
    signal?: AbortSignal;
  } = {};

  if (options.previousResponseStore) {
    deps.previousResponseStore = options.previousResponseStore;
  }

  if (signal) {
    deps.signal = signal;
  }

  return deps;
};

/**
 * Creates an Open Responses adapter without HTTP transport.
 *
 * @param options - Adapter configuration options
 * @returns Adapter with invoke and stream methods
 */
export function createOpenResponsesAdapter(
  options: OpenResponsesHandlerOptions
): OpenResponsesAdapter {
  const clock = options.clock ?? (() => Date.now());
  const generateId = options.generateId ?? (() => crypto.randomUUID());
  const toolPolicySupport = options.toolPolicySupport ?? "metadata-only";
  const timeoutBudgets = resolveTimeoutBudgets(options.timeoutBudgets);
  const previousResponseSaveMode = options.previousResponseSaveMode ?? "strict";

  return {
    async invoke(
      request: OpenResponsesRequest,
      signalOrOptions?: AbortSignal | OpenResponsesExecutionOptions
    ): Promise<OpenResponsesResponse> {
      const executionOptions = normalizeExecutionOptions(signalOrOptions);
      const normalizedRequest = await withTimeout<
        Awaited<ReturnType<typeof normalizeRequest>>
      >({
        operation: (phaseSignal) =>
          normalizeRequest(request, buildNormalizeDeps(options, phaseSignal)),
        signal: executionOptions.signal,
        timeoutMs: timeoutBudgets.previousResponseLoadMs,
        onTimeout: () =>
          previousResponseLoadTimedOut(timeoutBudgets.previousResponseLoadMs),
      });
      assertToolPolicySupport({
        toolPolicy: normalizedRequest.toolPolicy,
        supportMode: toolPolicySupport,
      });

      const responseId = generateId();
      const createdAt = clock();

      let agentResult: unknown;
      try {
        agentResult = await withTimeout({
          operation: (phaseSignal) =>
            options.agent.invoke(
              { messages: normalizedRequest.messages },
              buildAgentConfig({
                signal: phaseSignal,
                runId: responseId,
                toolPolicy: normalizedRequest.toolPolicy,
                requestContext: executionOptions.requestContext,
                callbacks: options.callbacks,
              })
            ),
          signal: executionOptions.signal,
          timeoutMs: timeoutBudgets.agentExecutionMs,
          onTimeout: () =>
            agentExecutionTimedOut(timeoutBudgets.agentExecutionMs),
        });
      } catch (error) {
        return toAgentExecutionFailed(error);
      }

      validateRequiredToolCallResult({
        result: agentResult,
        inputMessageCount: normalizedRequest.messages.length,
        toolPolicy: normalizedRequest.toolPolicy,
      });

      const completedAt = clock();

      const response = materializeResponseOrThrow({
        request: normalizedRequest.original,
        responseId,
        result: agentResult,
        inputMessageCount: normalizedRequest.messages.length,
        createdAt,
        completedAt,
        generateId,
      });

      if (options.previousResponseStore) {
        const previousResponseStore = options.previousResponseStore;
        try {
          const storedRecord = createStoredResponseRecord({
            request: normalizedRequest.original,
            normalizedInputItems: buildStoredRequestInputItems({
              normalizedInputItems: normalizedRequest.inputItems,
              result: agentResult,
              inputMessageCount: normalizedRequest.messages.length,
            }),
            response,
          });
          await withTimeout({
            operation: (phaseSignal) =>
              previousResponseStore.save(storedRecord, phaseSignal),
            signal: executionOptions.signal,
            timeoutMs: timeoutBudgets.previousResponseSaveMs,
            onTimeout: () =>
              previousResponseSaveTimedOut(
                timeoutBudgets.previousResponseSaveMs
              ),
          });
        } catch (error) {
          if (previousResponseSaveMode === "best_effort") {
            return response;
          }
          toInternalServerError("Failed to save previous response", error);
        }
      }

      return response;
    },

    async stream(
      request: OpenResponsesRequest,
      signalOrOptions?: AbortSignal | OpenResponsesExecutionOptions
    ): Promise<AsyncIterable<OpenResponsesEvent | "[DONE]">> {
      const executionOptions = normalizeExecutionOptions(signalOrOptions);

      // Pre-stream validation — throws before SSE headers are sent
      const normalizedRequest = await withTimeout<
        Awaited<ReturnType<typeof normalizeRequest>>
      >({
        operation: (phaseSignal) =>
          normalizeRequest(request, buildNormalizeDeps(options, phaseSignal)),
        signal: executionOptions.signal,
        timeoutMs: timeoutBudgets.previousResponseLoadMs,
        onTimeout: () =>
          previousResponseLoadTimedOut(timeoutBudgets.previousResponseLoadMs),
      });
      assertToolPolicySupport({
        toolPolicy: normalizedRequest.toolPolicy,
        supportMode: toolPolicySupport,
      });

      const responseId = generateId();
      const createdAt = clock();

      // Wire up streaming infrastructure
      const queue = createAsyncEventQueue<InternalSemanticEvent>();
      const accumulator = createCanonicalItemAccumulator({ generateId });
      const lifecycle = createResponseLifecycle({
        responseId,
        createdAt,
        clock,
      });

      const emitter: InternalEventEmitter = {
        emit(event: InternalSemanticEvent): void {
          if (!queue.isFinalized()) {
            queue.push(event);
          }
        },
      };

      const bridge = createOpenResponsesCallbackBridge({ emitter, generateId });

      const config = buildAgentConfig({
        signal: executionOptions.signal,
        runId: responseId,
        toolPolicy: normalizedRequest.toolPolicy,
        requestContext: executionOptions.requestContext,
        callbacks: options.callbacks,
      });
      const configCallbacks = (config.callbacks ?? []) as Record<
        string,
        unknown
      >[];
      config.callbacks = [bridge, ...configCallbacks];

      // Start agent.stream() drain in background — callbacks push to queue
      (async () => {
        try {
          await withTimeout({
            operation: async (phaseSignal) => {
              const streamConfig = {
                ...config,
                signal: phaseSignal,
              };
              for await (const _chunk of options.agent.stream(
                { messages: normalizedRequest.messages },
                streamConfig
              )) {
                // Chunks consumed to drive callbacks; raw chunks are not used.
              }
            },
            signal: executionOptions.signal,
            timeoutMs: timeoutBudgets.agentExecutionMs,
            onTimeout: () =>
              agentExecutionTimedOut(timeoutBudgets.agentExecutionMs),
          });
          if (!queue.isFinalized()) {
            queue.complete();
          }
        } catch (error) {
          if (!queue.isFinalized()) {
            emitter.emit({
              type: "run.failed",
              runId: responseId,
              error,
            });
            queue.complete();
          }
        }
      })();

      // Return the serializer generator — drains queue in foreground
      return createEventSerializer({
        queue,
        accumulator,
        lifecycle,
        responseId,
      });
    },
  };
}
