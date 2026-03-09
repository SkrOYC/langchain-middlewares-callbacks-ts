import { describe, expect, test } from "bun:test";
import {
  isNonRetryableRateLimitLikeError,
  SharedRateLimitCoordinator,
  wrapModelWithRateLimitRetry,
} from "../../../scripts/utils/rate-limit-retry-model";

describe("SharedRateLimitCoordinator", () => {
  test("uses provider retry hint from error text before fallback schedule", async () => {
    const events: Array<{
      kind?: string;
      waitMs?: number;
      source?: string;
    }> = [];

    const coordinator = new SharedRateLimitCoordinator({
      onEvent: (event) => {
        events.push({
          kind: event.kind,
          waitMs: event.waitMs,
          source: event.source,
        });
      },
    });

    await coordinator.registerRateLimit({
      scope: "test",
      attempt: 1,
      error: new Error("Please retry in 54.712644834s."),
    });

    const scheduled = events.find(
      (event) => event.kind === "backoff_scheduled"
    );
    expect(scheduled).toBeDefined();
    expect(scheduled?.source).toBe("provider_hint");
    expect(scheduled?.waitMs).toBeGreaterThanOrEqual(54_000);
    expect(scheduled?.waitMs).toBeLessThanOrEqual(55_000);
  });

  test("falls back to configured schedule when no provider hint exists", async () => {
    const events: Array<{
      kind?: string;
      waitMs?: number;
      source?: string;
    }> = [];

    const coordinator = new SharedRateLimitCoordinator({
      onEvent: (event) => {
        events.push({
          kind: event.kind,
          waitMs: event.waitMs,
          source: event.source,
        });
      },
    });

    await coordinator.registerRateLimit({
      scope: "test",
      attempt: 1,
      error: new Error("429 Too Many Requests"),
    });

    const scheduled = events.find(
      (event) => event.kind === "backoff_scheduled"
    );
    expect(scheduled).toBeDefined();
    expect(scheduled?.source).toBe("fallback_schedule");
    expect(scheduled?.waitMs).toBe(300_000);
  });
});

describe("rate-limit retry classification", () => {
  test("treats context/payload overflows as non-retryable", () => {
    const error = new Error(
      "400 INVALID_ARGUMENT: Input token count 301245 exceeds the maximum number of tokens 262144"
    );

    expect(isNonRetryableRateLimitLikeError(error)).toBe(true);
  });

  test("does not mark ordinary 429 as non-retryable", () => {
    const error = new Error("429 Too Many Requests");
    expect(isNonRetryableRateLimitLikeError(error)).toBe(false);
  });
});

describe("wrapModelWithRateLimitRetry", () => {
  test("fails fast for non-retryable rate-limit-like errors", async () => {
    const calls: string[] = [];
    const coordinator = new SharedRateLimitCoordinator();
    const wrapped = wrapModelWithRateLimitRetry(
      {
        invoke: async () => {
          await Promise.resolve();
          calls.push("invoke");
          throw new Error(
            "RESOURCE_EXHAUSTED: Input token count 300001 exceeds model limit"
          );
        },
      } as never,
      { coordinator, scope: "test" }
    );

    await expect(wrapped.invoke("x")).rejects.toThrow(
      "Input token count 300001 exceeds model limit"
    );
    expect(calls).toEqual(["invoke"]);
  });
});
