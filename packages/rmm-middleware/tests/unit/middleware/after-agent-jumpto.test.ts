import { describe, expect, test } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import type { Runtime } from "langchain";
import { afterAgent } from "@/middleware/hooks/after-agent";
import type { RmmRuntimeContext } from "@/schemas";
import { createMockBaseStore } from "@/tests/fixtures/mock-base-store";

const runtime = { context: {} } satisfies Runtime<RmmRuntimeContext>;

describe("afterAgent Hook JumpTo Edge Cases", () => {
  test("returns empty state when no messages", async () => {
    const result = await afterAgent(
      {
        messages: [],
        _turnCountInSession: 0,
      },
      runtime,
      {
        userId: "test-user",
        store: createMockBaseStore(),
      }
    );

    expect(result).toEqual({});
  });

  test("returns empty state when store or userId is missing", async () => {
    const result = await afterAgent(
      {
        messages: [new HumanMessage("Hello")],
        _turnCountInSession: 1,
      },
      runtime,
      {}
    );

    expect(result).toEqual({});
  });

  test("persists messages when store and userId are present", async () => {
    const store = createMockBaseStore();

    const result = await afterAgent(
      {
        messages: [new HumanMessage("Hello")],
        _turnCountInSession: 1,
      },
      runtime,
      {
        userId: "test-user",
        store,
      }
    );

    expect(result).toEqual({});

    const stored = await store.get(
      ["rmm", "test-user", "buffer"],
      "message-buffer"
    );
    const persistedMessages = stored?.value.messages;
    expect(Array.isArray(persistedMessages)).toBe(true);
    expect(persistedMessages).toHaveLength(1);
  });

  test("ignores _turnCountInSession value and stays append-only", async () => {
    const store = createMockBaseStore();

    await afterAgent(
      {
        messages: [new HumanMessage("First")],
        _turnCountInSession: 0,
      },
      runtime,
      {
        userId: "test-user",
        store,
      }
    );

    await afterAgent(
      {
        messages: [new HumanMessage("Second")],
        _turnCountInSession: undefined,
      },
      runtime,
      {
        userId: "test-user",
        store,
      }
    );

    const stored = await store.get(
      ["rmm", "test-user", "buffer"],
      "message-buffer"
    );
    const persistedMessages = stored?.value.messages;
    expect(Array.isArray(persistedMessages)).toBe(true);
    expect(persistedMessages).toHaveLength(2);
  });
});
