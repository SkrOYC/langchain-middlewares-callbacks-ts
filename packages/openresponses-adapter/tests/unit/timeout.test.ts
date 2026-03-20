import { describe, expect, test } from "bun:test";
import { internalError } from "@/core/errors.js";
import { createRequestAbortController, withTimeout } from "@/server/timeout.js";

describe("withTimeout", () => {
  test("cleans up correctly when the operation throws synchronously", async () => {
    await expect(
      withTimeout({
        operation: () => {
          throw new Error("sync explode");
        },
        signal: undefined,
        timeoutMs: 10,
        onTimeout: () => internalError("timed out"),
      })
    ).rejects.toThrow("sync explode");

    await new Promise((resolve) => setTimeout(resolve, 25));
  });
});

describe("createRequestAbortController", () => {
  test("returns an explicit cleanup function for the parent abort listener", () => {
    const parentController = new AbortController();
    const requestAbort = createRequestAbortController(parentController.signal);

    expect(requestAbort.controller.signal.aborted).toBe(false);

    requestAbort.cleanup();
    parentController.abort(new Error("parent aborted"));

    expect(requestAbort.controller.signal.aborted).toBe(false);
  });
});
