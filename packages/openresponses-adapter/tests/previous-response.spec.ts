import { describe, expect, test } from "bun:test";
import { buildOpenResponsesApp } from "@/server/index.js";
import {
  createFakeAgent,
  createInMemoryPreviousResponseStore,
} from "@/testing/index.js";
import { createPriorRecord } from "./helpers/records.ts";

describe("previous_response_id regression", () => {
  test("continues the conversation through the Hono route using prior input then prior output then new input", async () => {
    const store = createInMemoryPreviousResponseStore();
    await store.save(createPriorRecord());

    const agent = createFakeAgent({
      responses: [{ type: "ai", id: "ai-1", content: "Done" }],
    });
    const app = await buildOpenResponsesApp({
      agent,
      previousResponseStore: store,
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
            content: "Explain why it is funny.",
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
      status: "completed",
    });

    expect(agent.__getLastInvokeInput()?.messages).toEqual([
      {
        type: "system",
        role: "system",
        content: [{ type: "input_text", text: "Be terse." }],
      },
      {
        type: "human",
        role: "user",
        content: "Tell me a joke",
      },
      {
        type: "ai",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Why did the test cross the road?",
            annotations: [],
          },
        ],
      },
      {
        type: "human",
        role: "user",
        content: "Explain why it is funny.",
      },
    ]);
  });
});
