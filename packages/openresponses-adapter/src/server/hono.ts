/**
 * Hono Route Handler
 */

import type { Context, Env } from "hono";
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
import { isInternalError, toPublicErrorBody } from "./previous-response.js";

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

  return async (c: Context<E>): Promise<Response> => {
    try {
      const contentType = c.req.header("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw unsupportedMediaType("Content-Type must be application/json");
      }

      const body = await parseRequestBody(c.req.raw);
      const parsedRequest = OpenResponsesRequestSchema.safeParse(body);
      if (!parsedRequest.success) {
        throw invalidRequest(
          parsedRequest.error.issues.map((issue) => issue.message).join("; ")
        );
      }

      if (parsedRequest.data.stream) {
        throw invalidRequest("Streaming responses are not implemented yet");
      }

      const response = await adapter.invoke(
        parsedRequest.data,
        c.req.raw.signal
      );
      return c.json(response);
    } catch (error) {
      return toErrorResponse(error, options.onError);
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
