/**
 * Open Responses Adapter
 *
 * Programmatic adapter without HTTP transport.
 */

import {
  agentExecutionFailed,
  type InternalError,
  internalError,
  invalidRequest,
} from "../core/errors.js";
import {
  getEffectiveToolChoiceMode,
  OPENRESPONSES_TOOL_POLICY_CONFIG_KEY,
  serializeNormalizedToolPolicy,
} from "../core/tool-policy.js";
import type {
  OpenResponsesHandlerOptions,
  OpenResponsesRequest,
  OpenResponsesResponse,
  PreviousResponseStore,
} from "../core/index.js";
import type { OpenResponsesEvent } from "../core/schemas.js";
import {
  buildStoredRequestInputItems,
  createStoredResponseRecord,
  isInternalError,
  materializeInvokeResponse,
  normalizeRequest,
  validateRequiredToolCallResult,
} from "./previous-response.js";

export interface OpenResponsesAdapter {
  invoke(
    request: OpenResponsesRequest,
    signal?: AbortSignal
  ): Promise<OpenResponsesResponse>;

  stream(
    request: OpenResponsesRequest,
    signal?: AbortSignal
  ): AsyncIterable<OpenResponsesEvent | "[DONE]">;
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

  if (typeof policy.toolChoice === "object" && policy.toolChoice.type === "function") {
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
  signal?: AbortSignal;
  runId: string;
  toolPolicy: Awaited<ReturnType<typeof normalizeRequest>>["toolPolicy"];
}): Record<string, unknown> => {
  const configurable: Record<string, unknown> = {
    run_id: params.runId,
    [OPENRESPONSES_TOOL_POLICY_CONFIG_KEY]: serializeNormalizedToolPolicy(
      params.toolPolicy
    ),
  };

  const config: Record<string, unknown> = {
    configurable,
  };

  if (params.signal !== undefined) {
    config.signal = params.signal;
  }

  return config;
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

  return {
    async invoke(
      request: OpenResponsesRequest,
      signal?: AbortSignal
    ): Promise<OpenResponsesResponse> {
      const normalizeDeps: {
        previousResponseStore?: PreviousResponseStore;
        signal?: AbortSignal;
      } = {};

      if (options.previousResponseStore) {
        normalizeDeps.previousResponseStore = options.previousResponseStore;
      }

      if (signal) {
        normalizeDeps.signal = signal;
      }

      const normalizedRequest = await normalizeRequest(request, normalizeDeps);
      assertToolPolicySupport({
        toolPolicy: normalizedRequest.toolPolicy,
        supportMode: toolPolicySupport,
      });

      const responseId = generateId();
      const createdAt = clock();

      let agentResult: unknown;
      try {
        agentResult = await options.agent.invoke(
          { messages: normalizedRequest.messages },
          buildAgentConfig(
            signal === undefined
              ? {
                  runId: responseId,
                  toolPolicy: normalizedRequest.toolPolicy,
                }
              : {
                  signal,
                  runId: responseId,
                  toolPolicy: normalizedRequest.toolPolicy,
                }
          )
        );
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
          await options.previousResponseStore.save(storedRecord, signal);
        } catch (error) {
          toInternalServerError("Failed to save previous response", error);
        }
      }

      return response;
    },
    stream(
      _request: OpenResponsesRequest,
      _signal?: AbortSignal
    ): AsyncIterable<OpenResponsesEvent | "[DONE]"> {
      const error: InternalError = invalidRequest(
        "Streaming responses are not implemented yet"
      );

      const iterator: AsyncIterator<OpenResponsesEvent | "[DONE]"> = {
        next(): Promise<IteratorResult<OpenResponsesEvent | "[DONE]">> {
          return Promise.reject(error);
        },
      };

      return {
        [Symbol.asyncIterator](): AsyncIterator<OpenResponsesEvent | "[DONE]"> {
          return iterator;
        },
      };
    },
  };
}
