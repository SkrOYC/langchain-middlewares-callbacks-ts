import { describe, expect, test } from "bun:test";

/**
 * Tests for DEFAULT_REFLECTION_CONFIG single source of truth
 *
 * These tests verify that the factory uses DEFAULT_REFLECTION_CONFIG
 * from @/schemas (the canonical source) rather than a local duplicate.
 *
 * The canonical config has:
 * - minTurns: 2
 * - minInactivityMs: 600_000 (10 minutes)
 *
 * A duplicate in src/index.ts had incorrect values:
 * - minTurns: 3
 * - minInactivityMs: 300_000 (5 minutes)
 */

describe("DEFAULT_REFLECTION_CONFIG - Single Source of Truth", () => {
  test("canonical config from schemas has expected values", async () => {
    const { DEFAULT_REFLECTION_CONFIG } = await import("@/schemas");

    // Canonical values from the paper's Appendix
    expect(DEFAULT_REFLECTION_CONFIG.minTurns).toBe(2);
    expect(DEFAULT_REFLECTION_CONFIG.minInactivityMs).toBe(600_000); // 10 minutes
    expect(DEFAULT_REFLECTION_CONFIG.maxTurns).toBe(50);
    expect(DEFAULT_REFLECTION_CONFIG.maxInactivityMs).toBe(1_800_000); // 30 minutes
    expect(DEFAULT_REFLECTION_CONFIG.mode).toBe("strict");
    expect(DEFAULT_REFLECTION_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_REFLECTION_CONFIG.retryDelayMs).toBe(1000);
  });

  test("factory should NOT have its own duplicate DEFAULT_REFLECTION_CONFIG", async () => {
    // This test verifies that src/index.ts imports DEFAULT_REFLECTION_CONFIG
    // from schemas rather than defining its own duplicate
    // We check by looking for the import statement
    const fs = await import("fs");
    const indexContent = fs.readFileSync(
      "/home/oscar/GitHub/langchain-middlewares-callbacks-ts/packages/rmm-middleware/src/index.ts",
      "utf-8"
    );

    // The factory should import from schemas, not define locally
    // This regex checks that there's no local definition of DEFAULT_REFLECTION_CONFIG
    const hasLocalDefinition = /const\s+DEFAULT_REFLECTION_CONFIG\s*=\s*\{/.test(indexContent);
    const hasImportFromSchemas = /import\s*\{[^}]*DEFAULT_REFLECTION_CONFIG[^}]*\}\s*from\s*["']@\/schemas/.test(indexContent);

    // The test FAILS if factory has local definition
    expect(hasLocalDefinition).toBe(false);
    // The test PASSES if factory imports from schemas
    expect(hasImportFromSchemas).toBe(true);
  });
});
