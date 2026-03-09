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

      const responseId = generateId();
      const createdAt = clock();

      let agentResult: unknown;
      try {
        agentResult = await options.agent.invoke(
          { messages: normalizedRequest.messages },
          { signal, toolPolicy: normalizedRequest.toolPolicy }
        );
      } catch (error) {
        return toAgentExecutionFailed(error);
      }

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
