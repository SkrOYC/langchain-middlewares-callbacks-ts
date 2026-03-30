import type { RunAgentInput } from "@ag-ui/core";
import { createAGUIAdapter } from "@skroyc/ag-ui-middleware-callbacks/adapter";
import { CUSTOM_HOST_HEADER, DEFAULT_CUSTOM_HOST_TOKEN } from "./config";
import {
  acceptsJson,
  createExampleAdapterConfig,
  createSSEEventStream,
  createSSEHeaders,
  jsonError,
  readRunInput,
} from "./runtime";

const adapter = createAGUIAdapter(createExampleAdapterConfig());

function getAuthToken(): string {
  return Bun.env.EXAMPLE_AUTH_TOKEN ?? DEFAULT_CUSTOM_HOST_TOKEN;
}

export async function handleCustomHostRequest(
  request: Request
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonError(405, "Method Not Allowed", { Allow: "POST" });
  }

  if (request.headers.get(CUSTOM_HOST_HEADER) !== getAuthToken()) {
    return jsonError(401, "Unauthorized");
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

  return new Response(createSSEEventStream(events), {
    headers: createSSEHeaders(),
  });
}

if (import.meta.main) {
  const port = Number(Bun.env.CUSTOM_HOST_PORT ?? 3001);
  const server = Bun.serve({
    port,
    routes: {
      "/health": new Response("ok"),
      "/chat": {
        POST: handleCustomHostRequest,
      },
    },
  });

  console.log(
    `AG-UI custom-host example running at ${server.url} using ${CUSTOM_HOST_HEADER}.`
  );
}
