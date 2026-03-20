/**
 * Hono Route Handler
 */

import type { Context, Env } from "hono";
import { streamSSE } from "hono/streaming";
import {
  internalError,
  internalErrorToPublicError,
  internalErrorToStatusCode,
  invalidRequest,
  unsupportedMediaType,
} from "../core/errors.js";
import {
  type OpenResponsesHandlerOptions,
  OpenResponsesRequestSchema,
} from "../core/index.js";
import { createOpenResponsesAdapter } from "./adapter.js";
import { formatSSEFrame } from "./event-serializer.js";
import { isInternalError, toPublicErrorBody } from "./previous-response.js";
import {
  createRequestAbortController,
  requestValidationTimedOut,
  resolveTimeoutBudgets,
  withTimeout,
} from "./timeout.js";

const parseRequestBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch (error) {
    throw invalidRequest(
      error instanceof Error ? error.message : "Request body must be valid JSON"
    );
  }
};

const toErrorResponse = (
  error: unknown,
  onError?: OpenResponsesHandlerOptions["onError"]
): Response => {
  const internal = isInternalError(error)
    ? error
    : internalError(
        error instanceof Error ? error.message : "Unexpected internal error",
        error
      );
  const status = internalErrorToStatusCode[internal.code];

  let publicError = internalErrorToPublicError(internal);
  if (onError) {
    try {
      publicError = onError(internal);
    } catch {
      publicError = internalErrorToPublicError(internal);
    }
  }

  return new Response(JSON.stringify(toPublicErrorBody(publicError)), {
    status,
    headers: { "Content-Type": "application/json" },
  });
};

/**
 * Creates an Open Responses handler for Hono.
 *
 * @param options - Handler configuration options
 * @returns Hono handler function
 */
export function createOpenResponsesHandler<E extends Env = Env>(
  options: OpenResponsesHandlerOptions
): (c: Context<E>) => Promise<Response> {
  const adapter = createOpenResponsesAdapter(options);
  const timeoutBudgets = resolveTimeoutBudgets(options.timeoutBudgets);
  const noopCleanup = (): void => {
    // Intentionally empty until a request abort hook is installed.
  };

  return async (c: Context<E>): Promise<Response> => {
    let cleanupRequestAbort = noopCleanup;
    try {
      const requestAbort = createRequestAbortController(c.req.raw.signal);
      const requestAbortController = requestAbort.controller;
      cleanupRequestAbort = requestAbort.cleanup;
      const contentType = c.req.header("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw unsupportedMediaType("Content-Type must be application/json");
      }

      const parsedRequest = await withTimeout({
        operation: async () => {
          const body = await parseRequestBody(c.req.raw);
          const parsed = OpenResponsesRequestSchema.safeParse(body);
          if (!parsed.success) {
            throw invalidRequest(
              parsed.error.issues.map((issue) => issue.message).join("; ")
            );
          }

          return parsed.data;
        },
        signal: requestAbortController.signal,
        timeoutMs: timeoutBudgets.requestValidationMs,
        onTimeout: () =>
          requestValidationTimedOut(timeoutBudgets.requestValidationMs),
      });
      const requestContext = options.getRequestContext?.(c);
      const executionOptions = requestContext
        ? {
            signal: requestAbortController.signal,
            requestContext,
          }
        : {
            signal: requestAbortController.signal,
          };

      if (parsedRequest.stream) {
        const eventStream = await adapter.stream(
          parsedRequest,
          executionOptions
        );
        const cleanupStreamAbort = cleanupRequestAbort;
        cleanupRequestAbort = noopCleanup;

        return streamSSE(c, async (stream) => {
          let sawDone = false;
          try {
            for await (const chunk of eventStream) {
              if (chunk === "[DONE]") {
                sawDone = true;
                continue;
              }

              await stream.writeSSE(formatSSEFrame(chunk));
            }

            if (sawDone) {
              await stream.write("data: [DONE]\n\n");
            }
          } finally {
            cleanupStreamAbort();
          }
        });
      }

      const response = await adapter.invoke(parsedRequest, executionOptions);
      return c.json(response);
    } catch (error) {
      return toErrorResponse(error, options.onError);
    } finally {
      cleanupRequestAbort();
    }
  };
}

/**
 * Builds a complete Hono app with Open Responses route.
 *
 * @param options - Handler configuration options
 * @returns Configured Hono app
 */
export async function buildOpenResponsesApp<_E extends Env = Env>(
  options: OpenResponsesHandlerOptions
) {
  const { Hono } = await import("hono");
  const app = new Hono();
  app.post("/v1/responses", createOpenResponsesHandler(options));
  return app;
}
