import { describe, expect, test } from "bun:test";

import type { MessageOutputItem } from "@/core/schemas.js";
import { createCanonicalItemAccumulator } from "@/state/item-accumulator.js";
import { createSequentialIdGenerator } from "@/testing/deterministic-id.js";

const DUPLICATE_ITEM_ID_PATTERN = /already exists/;
const DUPLICATE_TERMINAL_PATTERN = /already received a terminal event/;

describe("CanonicalItemAccumulator", () => {
  test("opens message items, appends text deltas, and snapshots canonical state", () => {
    const accumulator = createCanonicalItemAccumulator({
      generateId: createSequentialIdGenerator(["msg-1"]),
    });

    const item = accumulator.startMessageItem();
    accumulator.startOutputTextPart(item.id);
    accumulator.appendOutputTextDelta(item.id, 0, "Hello");
    accumulator.appendOutputTextDelta(item.id, 0, " world");

    expect(accumulator.snapshot()).toEqual([
      {
        id: "msg-1",
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [
          {
            type: "output_text",
            text: "Hello world",
            annotations: [],
            logprobs: [],
          },
        ],
      },
    ]);
  });

  test("finalizes message items and returns the completed text payload", () => {
    const accumulator = createCanonicalItemAccumulator({
      generateId: createSequentialIdGenerator(["msg-1"]),
    });

    const item = accumulator.startMessageItem();
    accumulator.startOutputTextPart(item.id);
    accumulator.appendOutputTextDelta(item.id, 0, "Hello");

    const part = accumulator.finalizeOutputTextPart(item.id, 0);
    const finalizedItem = accumulator.finalizeItem(item.id, "completed");
    const finalizedMessage = finalizedItem as MessageOutputItem;

    expect(part.text).toBe("Hello");
    expect(finalizedMessage.status).toBe("completed");
    expect(finalizedMessage.content[0]).toEqual({
      type: "output_text",
      text: "Hello",
      annotations: [],
      logprobs: [],
    });
  });

  test("rejects duplicate terminal events for the same text part and item", () => {
    const accumulator = createCanonicalItemAccumulator({
      generateId: createSequentialIdGenerator(["msg-1"]),
    });

    const item = accumulator.startMessageItem();
    accumulator.startOutputTextPart(item.id);
    accumulator.appendOutputTextDelta(item.id, 0, "Hello");
    accumulator.finalizeOutputTextPart(item.id, 0);

    expect(() => accumulator.finalizeOutputTextPart(item.id, 0)).toThrow(
      DUPLICATE_TERMINAL_PATTERN
    );

    accumulator.finalizeItem(item.id, "completed");
    expect(() => accumulator.finalizeItem(item.id, "completed")).toThrow(
      DUPLICATE_TERMINAL_PATTERN
    );
  });

  test("tracks function-call arguments and finalization", () => {
    const accumulator = createCanonicalItemAccumulator({
      generateId: createSequentialIdGenerator(["fc-1"]),
    });

    const item = accumulator.startFunctionCallItem({
      name: "get_weather",
      callId: "call-1",
      arguments: "{",
    });

    accumulator.appendFunctionCallArgumentsDelta(item.id, '"city":"Boston"');
    accumulator.appendFunctionCallArgumentsDelta(item.id, "}");

    expect(accumulator.finalizeItem(item.id, "completed")).toEqual({
      id: "fc-1",
      type: "function_call",
      status: "completed",
      name: "get_weather",
      call_id: "call-1",
      arguments: '{"city":"Boston"}',
    });
  });

  test("rejects duplicate caller-supplied item ids", () => {
    const accumulator = createCanonicalItemAccumulator({
      generateId: createSequentialIdGenerator(["generated-1"]),
    });

    accumulator.startMessageItem({ id: "duplicate-id" });

    expect(() =>
      accumulator.startFunctionCallItem({
        id: "duplicate-id",
        name: "get_weather",
        callId: "call-1",
      })
    ).toThrow(DUPLICATE_ITEM_ID_PATTERN);
  });
});
