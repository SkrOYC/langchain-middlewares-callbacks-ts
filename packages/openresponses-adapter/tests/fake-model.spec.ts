import { describe, expect, test } from "bun:test";
import { createOpenResponsesAdapter } from "@/server/index.js";
import {
  createDeterministicClock,
  createFakeAgent,
  createSequentialIdGenerator,
} from "@/testing/index.js";

describe("fake model regression", () => {
  test("materializes a deterministic non-streaming response", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createFakeAgent({
        responses: [
          { type: "ai", id: "ai-1", content: "Hello from fake agent!" },
        ],
      }),
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator(["resp-1", "msg-1"]),
    });

    const response = await adapter.invoke({
      model: "gpt-4.1-mini",
      input: "Hello",
      metadata: {},
      tools: [],
      parallel_tool_calls: true,
      stream: false,
    });

    expect(response).toMatchObject({
      id: "resp-1",
      status: "completed",
      output: [
        {
          id: "ai-1",
          type: "message",
          role: "assistant",
          status: "completed",
        },
      ],
    });
  });

  test("preserves system and developer messages for the runtime", async () => {
    const agent = createFakeAgent();
    const adapter = createOpenResponsesAdapter({ agent });

    await adapter.invoke({
      model: "gpt-4.1-mini",
      input: [
        {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: "Be terse." }],
        },
        {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "Prefer tools." }],
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
    });

    expect(agent.__getLastInvokeInput()?.messages).toEqual([
      {
        type: "system",
        role: "system",
        content: [{ type: "input_text", text: "Be terse." }],
      },
      {
        type: "developer",
        role: "developer",
        content: [{ type: "input_text", text: "Prefer tools." }],
      },
      {
        type: "human",
        role: "user",
        content: "Hello",
      },
    ]);
  });
});
