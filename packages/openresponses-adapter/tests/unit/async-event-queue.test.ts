import { describe, expect, test } from "bun:test";

import { createAsyncEventQueue } from "@/state/async-event-queue.js";

const ALREADY_FINALIZED_PATTERN = /already finalized/;

describe("AsyncEventQueue", () => {
  test("delivers events to a single consumer in queue order", async () => {
    const queue = createAsyncEventQueue<string>();

    queue.push("first");
    await Promise.resolve();
    queue.push("second");
    queue.complete();

    const received: string[] = [];
    for await (const event of queue) {
      received.push(event);
    }

    expect(received).toEqual(["first", "second"]);
    expect(queue.isFinalized()).toBe(true);
  });

  test("finalizes exactly once on completion", () => {
    const queue = createAsyncEventQueue<string>();

    queue.complete();

    expect(() => queue.complete()).toThrow(ALREADY_FINALIZED_PATTERN);
    expect(() => queue.fail(new Error("boom"))).toThrow(
      ALREADY_FINALIZED_PATTERN
    );
  });

  test("surfaces final failure to the consumer", async () => {
    const queue = createAsyncEventQueue<string>();
    const failure = new Error("queue failed");

    queue.push("first");
    queue.fail(failure);

    const iterator = queue[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: "first",
    });
    await expect(iterator.next()).rejects.toThrow("queue failed");
  });

  test("returns done immediately on repeated reads after completion", async () => {
    const queue = createAsyncEventQueue<string>();
    const iterator = queue[Symbol.asyncIterator]();

    queue.complete();

    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});
