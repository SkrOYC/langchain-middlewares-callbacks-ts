import { LLMock } from "@copilotkit/llmock";
import type { ExampleAgentConfig } from "./config";

export const LLMOCK_MODEL = "big-pickle";

export interface ExampleLLMockServer {
  config: ExampleAgentConfig;
  getRequests(): ReturnType<LLMock["getRequests"]>;
  stop(): Promise<void>;
}

export async function startExampleLLMock(): Promise<ExampleLLMockServer> {
  const server = new LLMock({
    host: "127.0.0.1",
    port: 0,
  });

  server.prependFixture({
    match: {
      predicate: (request) => request.messages.at(-1)?.role === "tool",
    },
    response: {
      content: "The calculator returned 4.",
    },
  });

  server.onMessage(/calculate 2 \+ 2/i, {
    toolCalls: [
      {
        id: "call_calculator",
        name: "calculator",
        arguments: JSON.stringify({
          a: 2,
          b: 2,
          operation: "add",
        }),
      },
    ],
  });

  server.onMessage(/say hello/i, {
    content: "Hello from llmock.",
  });

  server.addFixture({
    match: {
      predicate: () => true,
    },
    response: {
      content: "LLMock fallback response.",
    },
  });

  const url = await server.start();

  return {
    config: {
      provider: "openai-compatible",
      baseUrl: `${url}/v1`,
      apiKey: "",
      model: LLMOCK_MODEL,
      useResponsesApi: false,
      outputVersion: "v0",
    },
    getRequests: () => server.getRequests(),
    stop: () => server.stop(),
  };
}
