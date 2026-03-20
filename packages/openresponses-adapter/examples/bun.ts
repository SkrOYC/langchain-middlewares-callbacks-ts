import { createAgent, tool } from "langchain";
import { z } from "zod";
import {
  buildOpenResponsesApp,
  createInMemoryPreviousResponseStore,
  createOpenResponsesToolPolicyMiddleware,
  type OpenResponsesCompatibleAgent,
} from "@/index.js";

const getWeather = tool(
  ({ city }) => {
    return JSON.stringify({
      city,
      forecast: "sunny",
    });
  },
  {
    name: "get_weather",
    description: "Return a simple forecast for a city",
    schema: z.object({
      city: z.string(),
    }),
  }
);

const agent = createAgent({
  model: process.env.OPENRESPONSES_MODEL ?? "gpt-4.1-mini",
  tools: [getWeather],
  middleware: [createOpenResponsesToolPolicyMiddleware()],
});

const openResponsesAgent: OpenResponsesCompatibleAgent = {
  invoke(input, config) {
    return agent.invoke(input, config);
  },
  async *stream(input, config) {
    const stream = await agent.stream(input, config);
    for await (const chunk of stream) {
      yield chunk;
    }
  },
};

const app = await buildOpenResponsesApp({
  agent: openResponsesAgent,
  previousResponseStore: createInMemoryPreviousResponseStore(),
  toolPolicySupport: "middleware",
});

const bunRuntime = globalThis.Bun;
if (!bunRuntime) {
  throw new Error("This example must run on Bun");
}

const server = bunRuntime.serve({
  port: Number(process.env.PORT ?? "3000"),
  fetch: app.fetch,
});

console.log(`Open Responses adapter listening on ${server.url}v1/responses`);
