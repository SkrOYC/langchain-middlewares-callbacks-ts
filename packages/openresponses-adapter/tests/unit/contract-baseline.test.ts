import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const baselineFiles = [
  "contracts/openresponses/openapi.json",
  "contracts/openresponses/SNAPSHOT.md",
  "contracts/openresponses/compliance-runner.md",
  "contracts/openresponses/official/bin/compliance-test.ts",
  "contracts/openresponses/official/src/lib/compliance-tests.ts",
  "contracts/openresponses/official/src/lib/sse-parser.ts",
  "contracts/openresponses/official/public/openapi/openapi.json",
  "contracts/openresponses/compliance-runner/compliance-test.ts",
  "contracts/openresponses/compliance-runner/compliance-tests.ts",
  "contracts/openresponses/compliance-runner/sse-parser.ts",
  "contracts/openresponses/compliance-runner/upstream-compliance-test.ts",
  "contracts/openresponses/compliance-runner/upstream-compliance-tests.ts",
  "contracts/openresponses/compliance-runner/upstream-sse-parser.ts",
  "src/contract/generated/kubb/zod/createResponseBodySchema.ts",
  "src/contract/generated/kubb/zod/responseResourceSchema.ts",
] as const;

describe("Epic A contract baseline", () => {
  test("vendors the pinned contract baseline assets into the repository", async () => {
    for (const filePath of baselineFiles) {
      await expect(readFile(filePath, "utf8")).resolves.toEqual(
        expect.any(String)
      );
    }
  });

  test("documents contract:update as a whole-baseline refresh", async () => {
    const snapshotDoc = await readFile(
      "contracts/openresponses/SNAPSHOT.md",
      "utf8"
    );
    expect(snapshotDoc).toContain("src/contract/generated/kubb/zod/**");
    expect(snapshotDoc).toContain(
      "contracts/openresponses/compliance-runner/**"
    );
    expect(snapshotDoc).toContain("contracts/openresponses/official/**");
  });
});
