import { type BaseEvent, EventType } from "@ag-ui/core";
import { createAgent } from "langchain";
import {
  AGUICallbackHandler,
} from "@skroyc/ag-ui-middleware-callbacks/callbacks";
import {
  createAGUIMiddleware,
} from "@skroyc/ag-ui-middleware-callbacks/middleware";
import {
  createAGUIRunPublisher,
} from "@skroyc/ag-ui-middleware-callbacks/publication";
import {
  CUSTOM_HOST_HEADER,
  DEFAULT_CUSTOM_HOST_TOKEN,
} from "./config";
import {
  acceptsJson,
  consumeAgentStream,
  createCalculatorTool,
  createExampleModel,
  createSSEHeaders,
  isAbortError,
  jsonError,
  readRunInput,
  resolveAgentConfig,
  toAgentInput,
} from "./runtime";

const calculatorTool = createCalculatorTool();

function publishFromMiddleware(
  publisher: ReturnType<typeof createAGUIRunPublisher>
): (event: BaseEvent) => void {
  return (event) => {
    if (event.type === EventType.RUN_FINISHED) {
      return;
    }

    publisher.publish(event);
  };
}

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

  let input;
  try {
    input = await readRunInput(request);
  } catch (error) {
    return jsonError(
      400,
      error instanceof Error ? error.message : "Invalid request body"
    );
  }

  const publisher = createAGUIRunPublisher({
    validateEvents: true,
  });

  const middleware = createAGUIMiddleware({
    publish: publishFromMiddleware(publisher),
    validateEvents: true,
    emitActivities: true,
    emitStateSnapshots: "initial",
    errorDetailLevel: "message",
    runIdOverride: input.runId,
    threadIdOverride: input.threadId,
  });

  const callbackHandler = new AGUICallbackHandler({
    publish: publisher.publish,
    reasoningEventMode: "reasoning",
  });

  const response = new Response(publisher.toReadableStream(), {
    headers: createSSEHeaders(),
  });

  (async () => {
    try {
      const agent = createAgent({
        model: createExampleModel(resolveAgentConfig(input.forwardedProps)),
        tools: [calculatorTool],
        middleware: [middleware],
      });

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
