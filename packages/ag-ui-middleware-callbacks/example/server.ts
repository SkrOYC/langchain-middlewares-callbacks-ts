import {
  type AGUIBackend,
  createAGUIBackend,
} from "@skroyc/ag-ui-middleware-callbacks/backend";
import index from "./index.html";
import { createExampleAdapterConfig } from "./runtime";

export function createExampleBackend(): AGUIBackend {
  return createAGUIBackend(createExampleAdapterConfig());
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
