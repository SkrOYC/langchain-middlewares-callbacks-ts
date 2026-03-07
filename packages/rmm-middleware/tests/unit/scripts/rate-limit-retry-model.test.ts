import { describe, expect, test } from "bun:test";
import { SharedRateLimitCoordinator } from "../../../scripts/utils/rate-limit-retry-model";

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
