import { describe, expect, test } from "bun:test";

import { createResponseLifecycle } from "@/state/response-lifecycle.js";

const CANNOT_COMPLETE_PATTERN = /Cannot complete/;
const CANNOT_FAIL_PATTERN = /Cannot fail/;
const CANNOT_START_PATTERN = /Cannot start/;

const createError = () => ({
  code: "agent_execution_failed",
  message: "runtime exploded",
  type: "model_error" as const,
});

describe("ResponseLifecycle", () => {
  test("accepts queued -> in_progress -> completed and writes completion metadata once", () => {
    const lifecycle = createResponseLifecycle({
      responseId: "resp-1",
      createdAt: 10,
      clock: () => 20,
    });

    lifecycle.start();
    lifecycle.complete();

    expect(lifecycle.getStatus()).toBe("completed");
    expect(lifecycle.getCompletedAt()).toBe(20);
    expect(lifecycle.getError()).toBeNull();
    expect(() => lifecycle.complete()).toThrow(CANNOT_COMPLETE_PATTERN);
  });

  test("retains terminal failure payload exactly once", () => {
    const lifecycle = createResponseLifecycle({
      responseId: "resp-2",
      createdAt: 11,
      clock: () => 30,
    });
    const error = createError();

    lifecycle.start();
    lifecycle.fail(error);

    expect(lifecycle.getStatus()).toBe("failed");
    expect(lifecycle.getCompletedAt()).toBe(30);
    expect(lifecycle.getError()).toEqual(error);
    expect(() => lifecycle.fail(createError())).toThrow(CANNOT_FAIL_PATTERN);
    expect(lifecycle.getError()).toEqual(error);
  });

  test("supports incomplete as a valid terminal transition", () => {
    const lifecycle = createResponseLifecycle({
      responseId: "resp-3",
      createdAt: 12,
      clock: () => 40,
    });

    lifecycle.start();
    lifecycle.incomplete();

    expect(lifecycle.getStatus()).toBe("incomplete");
    expect(lifecycle.getCompletedAt()).toBe(40);
  });

  test("rejects invalid transitions", () => {
    const lifecycle = createResponseLifecycle({
      responseId: "resp-4",
      createdAt: 13,
      clock: () => 50,
    });

    expect(() => lifecycle.complete()).toThrow(CANNOT_COMPLETE_PATTERN);

    lifecycle.start();
    expect(() => lifecycle.start()).toThrow(CANNOT_START_PATTERN);
  });
});
