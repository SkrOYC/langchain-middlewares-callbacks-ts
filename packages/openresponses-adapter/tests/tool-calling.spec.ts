import { describe, expect, test } from "bun:test";
import { createOpenResponsesAdapter } from "@/server/index.js";
import {
  createDeterministicClock,
  createFakeAgent,
  createSequentialIdGenerator,
} from "@/testing/index.js";
import {
  collectStream,
  createBaseRequest,
  createCallbackDrivenAgent,
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

describe("tool calling release blockers", () => {
  test("non-streaming responses materialize function_call output items", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createFakeAgent({
        responses: [
          {
            type: "ai",
            id: "ai-tool-1",
            content: [],
            tool_calls: [
              {
                id: "call-1",
                type: "tool_call",
                name: "get_weather",
                args: { city: "Boston" },
              },
            ],
          },
        ],
      }),
      toolPolicySupport: "middleware",
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator(["resp-1", "fc-1"]),
    });

    const response = await adapter.invoke({
      model: "gpt-4.1-mini",
      input: "Weather?",
      metadata: {},
      tools: [weatherTool],
      tool_choice: { type: "function", name: "get_weather" },
      parallel_tool_calls: true,
      stream: false,
    });

    expect(response.output).toEqual([
      {
        id: "call-1",
        type: "function_call",
        call_id: "call-1",
        name: "get_weather",
        arguments: '{"city":"Boston"}',
        status: "completed",
      },
    ]);
  });

  test("streaming responses emit truthful function-call lifecycle events", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createCallbackDrivenAgent({ onStream: simulateToolCallStream }),
      toolPolicySupport: "middleware",
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator(["resp-1", "fc-1", "extra-1"]),
    });

    const events = await collectStream(
      await adapter.stream({
        ...createBaseRequest(),
        tools: [weatherTool],
        tool_choice: { type: "function", name: "get_weather" },
      })
    );

    expect(
      events.map((event) => (typeof event === "string" ? event : event.type))
    ).toEqual([
      "response.in_progress",
      "response.output_item.added",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
      "[DONE]",
    ]);
  });
});
