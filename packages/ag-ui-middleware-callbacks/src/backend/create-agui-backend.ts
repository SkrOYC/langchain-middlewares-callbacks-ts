import { type RunAgentInput, RunAgentInputSchema } from "@ag-ui/core";
import {
  AGUICallbackHandler,
  type AGUICallbackHandlerOptions,
} from "@/callbacks/agui-callback-handler";
import { createAGUIMiddleware } from "@/middleware/create-agui-middleware";
import type { AGUIMiddlewareOptions } from "@/middleware/types";
import { createAGUIRunPublisher } from "@/publication/create-agui-run-publisher";
import { createSSEResponse } from "@/transports/sse";

export interface AGUIBackend {
  handle(request: Request): Promise<Response>;
}

export interface AGUIBackendRunOptions extends Record<string, unknown> {
  callbacks?: unknown[];
  configurable?: Record<string, unknown>;
  context?: Record<string, unknown>;
  signal?: AbortSignal;
  streamMode?: unknown;
}

export interface AGUIBackendAgentLike {
  stream(
    input: Record<string, unknown>,
    options?: AGUIBackendRunOptions
  ): Promise<AsyncIterable<unknown>>;
}

export type AGUIAgentFactory = (args: {
  input: RunAgentInput;
  middleware: ReturnType<typeof createAGUIMiddleware>;
}) => AGUIBackendAgentLike | Promise<AGUIBackendAgentLike>;

export interface AGUIBackendConfig {
  agentFactory: AGUIAgentFactory;
  validateEvents?: boolean | "strict";
  emitStateSnapshots?: AGUIMiddlewareOptions["emitStateSnapshots"];
  emitActivities?: AGUIMiddlewareOptions["emitActivities"];
  errorDetailLevel?: AGUIMiddlewareOptions["errorDetailLevel"];
  callbackOptions?: Omit<AGUICallbackHandlerOptions, "publish">;
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function acceptsJson(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return contentType?.toLowerCase().includes("application/json") ?? false;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAgentInput(input: RunAgentInput): Record<string, unknown> {
  if (isRecord(input.state)) {
    return {
      ...input.state,
      messages: input.messages,
    };
  }

  return {
    messages: input.messages,
    state: input.state,
  };
}

async function readRunInput(request: Request): Promise<RunAgentInput> {
  const payload = await request.json();
  return RunAgentInputSchema.parse(payload);
}

async function consumeAgentStream(
  stream: AsyncIterable<unknown>
): Promise<unknown> {
  let lastChunk: unknown;

  for await (const chunk of stream) {
    lastChunk = chunk;
  }

  return lastChunk;
}

export function createAGUIBackend(config: AGUIBackendConfig): AGUIBackend {
  if (typeof config.agentFactory !== "function") {
    throw new TypeError(
      "agentFactory must be a function that accepts { input, middleware } and returns an agent with a stream() method"
    );
  }

  return {
    async handle(request) {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            Allow: "POST",
          },
        });
      }

      if (!acceptsJson(request)) {
        return jsonError(415, "Unsupported Media Type");
      }

      let input: RunAgentInput;
      try {
        input = await readRunInput(request);
      } catch (error) {
        return jsonError(
          400,
          error instanceof Error ? error.message : "Invalid request body"
        );
      }

      const publisher = createAGUIRunPublisher({
        validateEvents: config.validateEvents,
      });
      const middleware = createAGUIMiddleware({
        publish: publisher.publish,
        validateEvents: config.validateEvents ?? false,
        emitStateSnapshots: config.emitStateSnapshots ?? "initial",
        emitActivities: config.emitActivities ?? false,
        errorDetailLevel: config.errorDetailLevel ?? "message",
        runIdOverride: input.runId,
        threadIdOverride: input.threadId,
      });

      const response = createSSEResponse(publisher.toReadableStream());

      (async () => {
        const callbackHandler = new AGUICallbackHandler({
          publish: publisher.publish,
          ...config.callbackOptions,
        });

        try {
          const agent = await config.agentFactory({ input, middleware });
          const stream = await agent.stream(toAgentInput(input), {
            callbacks: [callbackHandler],
            signal: request.signal,
            streamMode: "values",
            configurable: {
              run_id: input.runId,
              thread_id: input.threadId,
            },
            context: {
              run_id: input.runId,
              thread_id: input.threadId,
              signal: request.signal,
            },
          });

          const result = await consumeAgentStream(stream);
          if (request.signal.aborted) {
            publisher.close();
          } else {
            publisher.complete(result);
          }
        } catch (error) {
          if (request.signal.aborted || isAbortError(error)) {
            publisher.close();
          } else {
            publisher.error(error);
          }
        } finally {
          callbackHandler.dispose();
        }
      })();

      return response;
    },
  };
}
