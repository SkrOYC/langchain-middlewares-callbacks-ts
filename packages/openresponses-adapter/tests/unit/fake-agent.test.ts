import { describe, expect, test } from "bun:test";
import { createFakeAgent } from "@/testing/index.js";

describe("createFakeAgent", () => {
  test("captures invoke config without crashing on AbortSignal", async () => {
    const agent = createFakeAgent();
    const controller = new AbortController();

    await agent.invoke(
      {
        messages: [{ type: "human", role: "user", content: "Hello" }],
      },
      {
        signal: controller.signal,
        configurable: {
          run_id: "run-1",
          nested: {
            value: "ok",
          },
        },
      }
    );

    expect(agent.__getLastInvokeConfig()).toEqual({
      signal: controller.signal,
      configurable: {
        run_id: "run-1",
        nested: {
          value: "ok",
        },
      },
    });
  });

  test("captures stream config without crashing on AbortSignal", async () => {
    const agent = createFakeAgent({
      streamChunks: [{ type: "chunk", content: "hi" }],
    });
    const controller = new AbortController();

    const chunks: unknown[] = [];
    for await (const chunk of agent.stream(
      {
        messages: [{ type: "human", role: "user", content: "Hello" }],
      },
      {
        signal: controller.signal,
        configurable: {
          run_id: "run-2",
        },
      }
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(agent.__getLastStreamConfig()).toEqual({
      signal: controller.signal,
      configurable: {
        run_id: "run-2",
      },
    });
  });
});
