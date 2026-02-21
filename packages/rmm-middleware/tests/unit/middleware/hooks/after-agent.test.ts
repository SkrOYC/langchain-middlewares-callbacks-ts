import { describe, expect, test } from "bun:test";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { Runtime } from "langchain";
import { afterAgent } from "@/middleware/hooks/after-agent";
import type { RmmRuntimeContext } from "@/schemas";
import { createMockBaseStore } from "@/tests/fixtures/mock-base-store";

function isPersistedBuffer(
  value: Record<string, unknown> | undefined
): value is {
  messages: unknown[];
  humanMessageCount: number;
} {
  return (
    value !== undefined &&
    Array.isArray(value.messages) &&
    typeof value.humanMessageCount === "number"
  );
}

async function getBuffer(store: BaseStore, userId: string) {
  const item = await store.get(["rmm", userId, "buffer"], "message-buffer");
  return item?.value;
}

const runtime = { context: {} } satisfies Runtime<RmmRuntimeContext>;

const sampleMessages = [
  new HumanMessage("Hello, I went hiking this weekend"),
  new AIMessage("That sounds great!"),
  new HumanMessage("It was amazing, I love being outdoors"),
  new AIMessage("What else do you enjoy?"),
];

describe("afterAgent Hook - Append Only", () => {
  test("exports afterAgent function", () => {
    expect(typeof afterAgent).toBe("function");
  });

  test("appends messages to empty buffer", async () => {
    const store = createMockBaseStore();

    const result = await afterAgent({ messages: sampleMessages }, runtime, {
      userId: "test-user",
      store,
    });

    expect(result).toEqual({});

    const value = await getBuffer(store, "test-user");
    expect(isPersistedBuffer(value)).toBe(true);
    if (!isPersistedBuffer(value)) {
      return;
    }
    expect(value.messages).toHaveLength(4);
    expect(value.humanMessageCount).toBe(2);
  });

  test("appends messages to existing buffer", async () => {
    const store = createMockBaseStore();

    await afterAgent(
      { messages: [new HumanMessage("Previous message")] },
      runtime,
      { userId: "test-user", store }
    );

    await afterAgent({ messages: sampleMessages }, runtime, {
      userId: "test-user",
      store,
    });

    const value = await getBuffer(store, "test-user");
    expect(isPersistedBuffer(value)).toBe(true);
    if (!isPersistedBuffer(value)) {
      return;
    }

    expect(value.messages).toHaveLength(5);
    expect(value.humanMessageCount).toBe(3);
  });

  test("skips when no messages in state", async () => {
    const result = await afterAgent({ messages: [] }, runtime, {
      userId: "test-user",
      store: createMockBaseStore(),
    });

    expect(result).toEqual({});
  });

  test("skips when no store or userId provided", async () => {
    const result = await afterAgent({ messages: sampleMessages }, runtime, {});

    expect(result).toEqual({});
  });
});
