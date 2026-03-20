import { describe, expect, test } from "bun:test";
import type { OpenResponsesEvent } from "@/core/schemas.js";
import { createOpenResponsesAdapter } from "@/server/index.js";
import {
  createDeterministicClock,
  createSequentialIdGenerator,
} from "@/testing/index.js";
import {
  collectStream,
  createBaseRequest,
  createCallbackDrivenAgent,
  simulateFailureStream,
  simulateTextStream,
} from "./helpers/streaming-fixtures.ts";

describe("event order regression", () => {
  test("emits the canonical text event order with strict sequence numbers", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createCallbackDrivenAgent({ onStream: simulateTextStream }),
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator([
        "resp-1",
        "msg-1",
        "extra-1",
        "extra-2",
      ]),
    });

    const events = await collectStream(
      await adapter.stream(createBaseRequest())
    );

    expect(
      events.map((event) => (typeof event === "string" ? event : event.type))
    ).toEqual([
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.completed",
      "[DONE]",
    ]);

    expect(
      events
        .filter(
          (event): event is OpenResponsesEvent => typeof event !== "string"
        )
        .map((event) => event.sequence_number)
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("never emits response.completed after a failed stream", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createCallbackDrivenAgent({ onStream: simulateFailureStream }),
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator(["resp-1", "msg-1", "extra-1"]),
    });

    const events = await collectStream(
      await adapter.stream(createBaseRequest())
    );
    const types = events.map((event) =>
      typeof event === "string" ? event : event.type
    );

    expect(types).toContain("response.failed");
    expect(types).not.toContain("response.completed");
    expect(types.at(-1)).toBe("[DONE]");
  });
});
