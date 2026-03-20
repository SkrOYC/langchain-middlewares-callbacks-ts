import { describe, expect, test } from "bun:test";
import { internalError } from "@/core/errors.js";
import { withTimeout } from "@/server/timeout.js";

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
