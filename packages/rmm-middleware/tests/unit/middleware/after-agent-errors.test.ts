import { describe, expect, test } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import type { Runtime } from "langchain";
import { afterAgent } from "@/middleware/hooks/after-agent";
import type { RmmRuntimeContext } from "@/schemas";
import {
  createFailingMockBaseStore,
  createMockBaseStore,
} from "@/tests/fixtures/mock-base-store";

describe("afterAgent error handling", () => {
  test("returns empty object when no messages", async () => {
    const result = await afterAgent({ messages: [] }, {
      context: {},
    } as Runtime<RmmRuntimeContext>);

    expect(result).toEqual({});
  });

  test("returns empty object when deps are missing", async () => {
    const result = await afterAgent({ messages: [new HumanMessage("hello")] }, {
      context: {},
    } as Runtime<RmmRuntimeContext>);

    expect(result).toEqual({});
  });

  test("handles store failures gracefully", async () => {
    const store = createFailingMockBaseStore("put");

    const result = await afterAgent(
      { messages: [new HumanMessage("hello")] },
      { context: {} } as Runtime<RmmRuntimeContext>,
      {
        userId: "u1",
        store,
      }
    );

    expect(result).toEqual({});
  });

  test("persists when userId and store are provided", async () => {
    const store = createMockBaseStore();

    await afterAgent(
      { messages: [new HumanMessage("hello")] },
      { context: {} } as Runtime<RmmRuntimeContext>,
      {
        userId: "u1",
        store,
      }
    );

    const buffer = await store.get(["rmm", "u1", "buffer"], "message-buffer");
    expect(buffer).not.toBeNull();
  });
});
