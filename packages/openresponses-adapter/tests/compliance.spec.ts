import { describe, expect, test } from "bun:test";
import {
  buildOpenResponsesApp,
  createOpenResponsesAdapter,
} from "@/server/index.js";
import {
  createFakeAgent,
  createInMemoryPreviousResponseStore,
} from "@/testing/index.js";
import { createPriorRecord } from "./helpers/records.ts";
import {
  collectStream,
  createBaseRequest,
  createCallbackDrivenAgent,
  simulateTextStream,
  simulateToolCallStream,
} from "./helpers/streaming-fixtures.ts";

const weatherTool = {
  type: "function" as const,
  name: "get_weather",
  description: "Get weather for a city",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string" },
    },
    required: ["city"],
  },
  strict: true,
};

describe("local compliance suite", () => {
  test("basic text response returns a response resource", async () => {
    const app = await buildOpenResponsesApp({
      agent: createFakeAgent(),
    });

    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: "Hello",
        metadata: {},
        tools: [],
        parallel_tool_calls: true,
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      object: "response",
      status: "completed",
    });
  });

  test("streaming response returns SSE events and literal [DONE]", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createCallbackDrivenAgent({ onStream: simulateTextStream }),
    });

    const events = await collectStream(
      await adapter.stream(createBaseRequest())
    );

    expect(events[0]).toMatchObject({
      type: "response.in_progress",
    });
    expect(events.at(-1)).toBe("[DONE]");
  });

  test("system prompt is preserved in the runtime input", async () => {
    const agent = createFakeAgent();
    const app = await buildOpenResponsesApp({ agent });

    await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            type: "message",
            role: "system",
            content: "Be terse.",
          },
          {
            type: "message",
            role: "user",
            content: "Hello",
          },
        ],
        metadata: {},
        tools: [],
        parallel_tool_calls: true,
        stream: false,
      }),
    });

    expect(agent.__getLastInvokeInput()?.messages[0]).toEqual({
      type: "system",
      role: "system",
      content: "Be terse.",
    });
  });

  test("tool calling produces function-call stream items", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createCallbackDrivenAgent({ onStream: simulateToolCallStream }),
      toolPolicySupport: "middleware",
    });

    const events = await collectStream(
      await adapter.stream({
        ...createBaseRequest(),
        tools: [weatherTool],
        tool_choice: { type: "function", name: "get_weather" },
      })
    );

    expect(
      events.some((event) => {
        return (
          typeof event !== "string" &&
          event.type === "response.function_call_arguments.done"
        );
      })
    ).toBe(true);
  });

  test("image input remains visible to the runtime", async () => {
    const agent = createFakeAgent();
    const app = await buildOpenResponsesApp({ agent });

    await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "Describe this image." },
              {
                type: "input_image",
                image_url: "https://example.com/cat.png",
                detail: "high",
              },
            ],
          },
        ],
        metadata: {},
        tools: [],
        parallel_tool_calls: true,
        stream: false,
      }),
    });

    expect(agent.__getLastInvokeInput()?.messages[0]).toEqual({
      type: "human",
      role: "user",
      content: [
        { type: "input_text", text: "Describe this image." },
        {
          type: "input_image",
          image_url: "https://example.com/cat.png",
          detail: "high",
        },
      ],
    });
  });

  test("multi-turn continuation uses previous_response_id", async () => {
    const previousResponseStore = createInMemoryPreviousResponseStore();
    await previousResponseStore.save(createPriorRecord());

    const agent = createFakeAgent();
    const app = await buildOpenResponsesApp({
      agent,
      previousResponseStore,
    });

    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        previous_response_id: "resp-prev",
        input: [
          {
            type: "message",
            role: "user",
            content: "Continue.",
          },
        ],
        metadata: {},
        tools: [],
        parallel_tool_calls: true,
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      previous_response_id: "resp-prev",
    });
  });
});
