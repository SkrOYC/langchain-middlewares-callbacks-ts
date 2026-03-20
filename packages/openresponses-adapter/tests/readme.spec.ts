import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const readmePath = resolve(packageRoot, "README.md");
const packageJsonPath = resolve(packageRoot, "package.json");

describe("README drift", () => {
  test("references example files that exist on disk", async () => {
    const readme = await readFile(readmePath, "utf8");

    const referencedExamplePaths = ["./examples/node.ts", "./examples/bun.ts"];

    for (const relativePath of referencedExamplePaths) {
      expect(readme).toContain(relativePath);
      await expect(
        readFile(resolve(packageRoot, relativePath.replace("./", "")), "utf8")
      ).resolves.toContain("buildOpenResponsesApp");
    }
  });

  test("lists package scripts that exist in package.json", async () => {
    const readme = await readFile(readmePath, "utf8");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      scripts: Record<string, string>;
    };

    const documentedScripts = [
      "build",
      "typecheck",
      "lint",
      "test",
      "test:golden-stream",
      "test:compliance",
      "smoke:node",
      "smoke:bun",
    ];

    for (const scriptName of documentedScripts) {
      expect(readme).toContain(`bun run ${scriptName}`);
      expect(packageJson.scripts[scriptName]).toEqual(expect.any(String));
    }
  });

  test("documents key release boundaries that the package implements", async () => {
    const readme = await readFile(readmePath, "utf8");

    expect(readme).toContain("previous_response_id");
    expect(readme).toContain("input_image");
    expect(readme).toContain("No synthetic text or function-call deltas");
    expect(readme).toContain("structured internal logs");
  });
});
