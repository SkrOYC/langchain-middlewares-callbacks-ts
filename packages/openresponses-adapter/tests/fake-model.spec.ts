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

  test("accepts reasoning and item_reference input items without crashing", async () => {
    const agent = createFakeAgent();
    const adapter = createOpenResponsesAdapter({ agent });

    const response = await adapter.invoke({
      model: "gpt-4.1-mini",
      input: [
        {
          type: "item_reference",
          id: "msg_123",
        },
        {
          type: "reasoning",
          id: "rs_123",
          summary: [
            { type: "summary_text", text: "Earlier reasoning summary" },
          ],
        },
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
    });

    expect(response.status).toBe("completed");
    expect(agent.__getLastInvokeInput()?.messages).toEqual([
      {
        type: "ai",
        role: "assistant",
        content: "Earlier reasoning summary",
      },
      {
        type: "human",
        role: "user",
        content: "Continue.",
      },
    ]);
  });
});
