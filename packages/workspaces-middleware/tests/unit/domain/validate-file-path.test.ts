import { describe, expect, test } from "bun:test";

import { PathTraversalError } from "../../../src/domain/errors";
import { validateFilePath } from "../../../src/domain/vfs-router";

describe("validateFilePath", () => {
  test("rejects traversal sequences", () => {
    expect(() => validateFilePath("../secrets.txt", "/project")).toThrow(
      PathTraversalError
    );
  });

  test("rejects home-directory expansion marker", () => {
    expect(() => validateFilePath("~/config.json", "/project")).toThrow(
      PathTraversalError
    );
  });

  test("rejects absolute Windows paths", () => {
    expect(() =>
      validateFilePath("C:/Windows/System32/drivers/etc/hosts", "/project")
    ).toThrow(PathTraversalError);
  });

  test("normalizes backslashes and returns a relative key", () => {
    const normalizedKey = validateFilePath(
      "/project\\docs\\api.ts",
      "/project"
    );

    expect(normalizedKey).toBe("docs/api.ts");
  });

  test("enforces the root prefix boundary", () => {
    expect(() => validateFilePath("/outside/file.ts", "/project")).toThrow(
      PathTraversalError
    );
  });
});
