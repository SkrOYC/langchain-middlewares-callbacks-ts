import { describe, expect, test } from "bun:test";
import type { ReflectionConfig } from "@/schemas/index";
import { checkReflectionTriggers } from "@/middleware/hooks/before-agent";

/**
 * Tests for the checkReflectionTriggers function
 *
 * These tests verify the trigger logic:
 * 1. Max thresholds always trigger (force reflection)
 * 2. Strict mode requires BOTH min thresholds
 * 3. Relaxed mode requires EITHER min threshold
 */

const ONE_MINUTE_MS = 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const ELEVEN_MINUTES_MS = 11 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

function createConfig(
  minTurns: number,
  maxTurns: number,
  minInactivityMs: number,
  maxInactivityMs: number,
  mode: "strict" | "relaxed",
  maxRetries = 3,
  retryDelayMs = 1000
): ReflectionConfig {
  return {
    minTurns,
    maxTurns,
    minInactivityMs,
    maxInactivityMs,
    mode,
    maxRetries,
    retryDelayMs,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("checkReflectionTriggers", () => {
  test("is exported", () => {
    expect(typeof checkReflectionTriggers).toBe("function");
  });

  describe("Max Thresholds - Force Trigger", () => {
    test("triggers when humanMessageCount exceeds maxTurns", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "strict");
      // 55 > 50, should trigger regardless of inactivity
      expect(checkReflectionTriggers(55, 1000, config)).toBe(true);
    });

    test("triggers when timeSinceLastUpdate exceeds maxInactivityMs", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "strict");
      // 31 min > 30 min, should trigger regardless of turns
      expect(checkReflectionTriggers(1, THIRTY_MINUTES_MS + ONE_MINUTE_MS, config)).toBe(true);
    });

    test("does not trigger when max thresholds are not exceeded", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "strict");
      // 5 < 50, 5 min < 30 min
      expect(checkReflectionTriggers(5, FIVE_MINUTES_MS, config)).toBe(false);
    });
  });

  describe("Strict Mode - AND Logic", () => {
    test("triggers when BOTH minTurns AND minInactivityMs are met", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "strict");
      // 2 >= 2 AND 11 min >= 10 min
      expect(checkReflectionTriggers(2, ELEVEN_MINUTES_MS, config)).toBe(true);
    });

    test("does NOT trigger when only minTurns is met", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "strict");
      // 2 >= 2 BUT 5 min < 10 min
      expect(checkReflectionTriggers(2, FIVE_MINUTES_MS, config)).toBe(false);
    });

    test("does NOT trigger when only minInactivityMs is met", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "strict");
      // 1 < 2 BUT 11 min >= 10 min
      expect(checkReflectionTriggers(1, ELEVEN_MINUTES_MS, config)).toBe(false);
    });

    test("does NOT trigger when neither threshold is met", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "strict");
      // 1 < 2 AND 5 min < 10 min
      expect(checkReflectionTriggers(1, FIVE_MINUTES_MS, config)).toBe(false);
    });
  });

  describe("Relaxed Mode - OR Logic", () => {
    test("triggers when minTurns is met (inactivity not needed)", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "relaxed");
      // 3 >= 2, should trigger even with no inactivity
      expect(checkReflectionTriggers(3, 0, config)).toBe(true);
    });

    test("triggers when minInactivityMs is met (turns not needed)", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "relaxed");
      // 1 < 2 BUT 11 min >= 10 min
      expect(checkReflectionTriggers(1, ELEVEN_MINUTES_MS, config)).toBe(true);
    });

    test("does NOT trigger when neither threshold is met", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "relaxed");
      // 1 < 2 AND 5 min < 10 min
      expect(checkReflectionTriggers(1, FIVE_MINUTES_MS, config)).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    test("triggers with exact minTurns threshold", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "strict");
      expect(checkReflectionTriggers(2, ELEVEN_MINUTES_MS, config)).toBe(true);
    });

    test("triggers with exact minInactivityMs threshold", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "strict");
      expect(checkReflectionTriggers(2, TEN_MINUTES_MS, config)).toBe(true);
    });

    test("handles zero timeSinceLastUpdate", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "relaxed");
      // 0 time means very recent, should not trigger by inactivity alone
      expect(checkReflectionTriggers(1, 0, config)).toBe(false);
    });

    test("triggers when maxInactivityMs exceeded even with zero turns", () => {
      const config = createConfig(2, 50, TEN_MINUTES_MS, THIRTY_MINUTES_MS, "strict");
      // Max threshold exceeded
      expect(checkReflectionTriggers(0, THIRTY_MINUTES_MS + ONE_MINUTE_MS, config)).toBe(true);
    });
  });
});
