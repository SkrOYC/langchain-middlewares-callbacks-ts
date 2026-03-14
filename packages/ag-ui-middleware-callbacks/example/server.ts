import { createAgent } from "langchain";
import index from "./index.html";
import {
  createAGUIBackend,
  type AGUIBackend,
} from "@skroyc/ag-ui-middleware-callbacks/backend";
import {
  createCalculatorTool,
  createExampleModel,
  resolveAgentConfig,
} from "./runtime";

const calculatorTool = createCalculatorTool();

export function createExampleBackend(): AGUIBackend {
  return createAGUIBackend({
    validateEvents: true,
    emitActivities: true,
    emitStateSnapshots: "initial",
    callbackOptions: {
      reasoningEventMode: "reasoning",
    },
    agentFactory: ({ input, middleware }) =>
      createAgent({
        model: createExampleModel(resolveAgentConfig(input.forwardedProps)),
        tools: [calculatorTool],
        middleware: [middleware],
      }),
  });
}

const backend = createExampleBackend();

export function handleChatRequest(request: Request): Promise<Response> {
  return backend.handle(request);
}

if (import.meta.main) {
  const port = Number(Bun.env.PORT ?? 3000);
  const server = Bun.serve({
    port,
    routes: {
      "/": index,
      "/chat": {
        POST: handleChatRequest,
      },
    },
    development: {
      hmr: true,
      console: true,
    },
  });

  console.log(`AG-UI default backend example running at ${server.url}`);
}
