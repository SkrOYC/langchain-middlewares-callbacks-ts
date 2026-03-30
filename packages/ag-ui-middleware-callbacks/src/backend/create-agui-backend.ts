import type { RunAgentInput } from "@ag-ui/core";
import { RunAgentInputSchema } from "@ag-ui/core";
import {
  type AGUIAdapterConfig,
  type AGUIAgentLike,
  type AGUIAgentRunOptions,
  createAGUIAdapter,
} from "@/adapter/create-agui-adapter";
import { createSSEResponse, createSSEStream } from "@/transports/sse";

export type { AGUIAgentFactory } from "@/adapter/create-agui-adapter";

export interface AGUIBackend {
  handle(request: Request): Promise<Response>;
}

export type AGUIBackendRunOptions = AGUIAgentRunOptions;
export type AGUIBackendAgentLike = AGUIAgentLike;
export type AGUIBackendConfig = AGUIAdapterConfig;

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

async function readRunInput(request: Request): Promise<RunAgentInput> {
  const payload = await request.json();
  return RunAgentInputSchema.parse(payload);
}

export function createAGUIBackend(config: AGUIBackendConfig): AGUIBackend {
  const adapter = createAGUIAdapter(config);

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

      const events = await adapter.stream(input, {
        signal: request.signal,
      });

      return createSSEResponse(createSSEStream(events));
    },
  };
}
