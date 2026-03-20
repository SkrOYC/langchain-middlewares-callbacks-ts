import { describe, expect, test } from "bun:test";
import { createOpenResponsesAdapter } from "@/server/index.js";
import {
  createFakeAgent,
  createInMemoryPreviousResponseStore,
} from "@/testing/index.js";
import { createImagePriorRecord } from "./helpers/records.ts";

const imageRequest = {
  model: "gpt-4.1-mini",
  input: [
    {
      type: "message" as const,
      role: "user" as const,
      content: [
        { type: "input_text" as const, text: "Describe this image." },
        {
          type: "input_image" as const,
          image_url: "https://example.com/cat.png",
          detail: "high" as const,
        },
      ],
    },
  ],
  metadata: {},
  tools: [],
  parallel_tool_calls: true,
  stream: false,
};

describe("image input minimum path", () => {
  test("passes input_image parts through to the runtime unchanged", async () => {
    const agent = createFakeAgent();
    const adapter = createOpenResponsesAdapter({ agent });

    await adapter.invoke(imageRequest);

    expect(agent.__getLastInvokeInput()?.messages).toEqual([
      {
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
      },
    ]);
  });

  test("replays prior image-bearing input before new input when continuing a response", async () => {
    const store = createInMemoryPreviousResponseStore();
    await store.save(createImagePriorRecord());

    const agent = createFakeAgent();
    const adapter = createOpenResponsesAdapter({
      agent,
      previousResponseStore: store,
    });

    await adapter.invoke({
      ...imageRequest,
      previous_response_id: "resp-prev",
      input: [
        {
          type: "message",
          role: "user",
          content: "Now summarize it in one sentence.",
        },
      ],
    });

    expect(agent.__getLastInvokeInput()?.messages).toEqual([
      {
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
        content: "Now summarize it in one sentence.",
      },
    ]);
  });
});
