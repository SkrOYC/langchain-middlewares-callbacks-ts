import { describe, expect, test } from "bun:test";

import { PathTraversalError } from "@/domain/errors";
import { validateFilePath } from "@/domain/vfs-router";
import { normalizeStoreKey } from "@/infrastructure/path-utils";

describe("normalizeStoreKey", () => {
  test("rejects null-byte in path", () => {
    expect(() => normalizeStoreKey("/project/secret\0.txt")).toThrow(
      PathTraversalError
    );
  });

  test("rejects tilde in path", () => {
    expect(() => normalizeStoreKey("~/config.json")).toThrow(
      PathTraversalError
    );
  });

  test("allows empty path when allowEmpty is true", () => {
    const result = normalizeStoreKey(".", true);
    expect(result).toBe("");
  });

  test("allows empty string when allowEmpty is true", () => {
    const result = normalizeStoreKey("", true);
    expect(result).toBe("");
  });
});

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

  test("rejects Windows drive-prefixed paths without separator", () => {
    expect(() => validateFilePath("C:users/file.txt", "/project")).toThrow(
      PathTraversalError
    );
  });

  test("rejects embedded Windows drive-prefixed segments", () => {
    expect(() =>
      validateFilePath("/project/C:/Windows/System32", "/project")
    ).toThrow(PathTraversalError);
  });

  test("rejects null-byte payloads", () => {
    expect(() => validateFilePath("/project/\0secret.txt", "/project")).toThrow(
      PathTraversalError
    );
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
