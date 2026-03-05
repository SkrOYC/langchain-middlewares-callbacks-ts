import { describe, expect, test } from "bun:test";

import { AccessDeniedError, PathTraversalError } from "@/domain/errors";
import type { Workspace } from "@/domain/models";
import type { StorePort } from "@/domain/store-port";
import { resolveWorkspace } from "@/domain/vfs-router";

const noopStore: StorePort = {
  read: async () => "",
  write: async () => undefined,
  edit: async () => 0,
  list: async () => [],
};

function createWorkspace(prefix: string, scope: Workspace["scope"]): Workspace {
  return {
    prefix,
    scope,
    store: noopStore,
  };
}

describe("resolveWorkspace", () => {
  test("selects the longest matching workspace prefix", () => {
    const workspaces: Workspace[] = [
      createWorkspace("/home", "READ_ONLY"),
      createWorkspace("/home/src", "READ_WRITE"),
    ];

    const resolution = resolveWorkspace("/home/src/file.ts", workspaces);

    expect(resolution.workspace.prefix).toBe("/home/src");
    expect(resolution.scope).toBe("READ_WRITE");
    expect(resolution.normalizedLogicalPath).toBe("/home/src/file.ts");
    expect(resolution.normalizedKey).toBe("file.ts");
  });

  test("uses boundary-safe matching for overlapping prefixes", () => {
    const workspaces: Workspace[] = [
      createWorkspace("/home/src", "READ_WRITE"),
      createWorkspace("/home", "READ_ONLY"),
    ];

    const resolution = resolveWorkspace("/home/src2/file.ts", workspaces);

    expect(resolution.workspace.prefix).toBe("/home");
    expect(resolution.normalizedKey).toBe("src2/file.ts");
  });

  test("fails fast with explicit denial for unmapped paths", () => {
    const workspaces: Workspace[] = [createWorkspace("/project", "READ_WRITE")];

    expect(() => resolveWorkspace("/unmapped/file.ts", workspaces)).toThrow(
      AccessDeniedError
    );
  });

  test("coerces non-absolute request paths to absolute logical paths", () => {
    const workspaces: Workspace[] = [
      createWorkspace("/home", "READ_ONLY"),
      createWorkspace("/home/src", "READ_WRITE"),
    ];

    const resolution = resolveWorkspace("home/src/file.ts", workspaces);

    expect(resolution.normalizedLogicalPath).toBe("/home/src/file.ts");
    expect(resolution.workspace.prefix).toBe("/home/src");
  });

  test("rejects traversal markers before normalization side effects", () => {
    const workspaces: Workspace[] = [createWorkspace("/project", "READ_WRITE")];

    expect(() =>
      resolveWorkspace("/project/docs/../secrets.txt", workspaces)
    ).toThrow(PathTraversalError);
  });

  test("rejects raw Windows absolute paths in resolveWorkspace", () => {
    const workspaces: Workspace[] = [createWorkspace("/", "READ_WRITE")];

    expect(() =>
      resolveWorkspace("C:/Windows/System32/drivers/etc/hosts", workspaces)
    ).toThrow(PathTraversalError);
  });
  test("rejects Windows drive-prefixed paths without separator", () => {
    const workspaces: Workspace[] = [createWorkspace("/", "READ_WRITE")];

    expect(() => resolveWorkspace("C:users/file.txt", workspaces)).toThrow(
      PathTraversalError
    );
  });

  test("rejects null-byte payloads in resolveWorkspace", () => {
    const workspaces: Workspace[] = [createWorkspace("/project", "READ_WRITE")];

    expect(() =>
      resolveWorkspace("/project/files/\0secrets.txt", workspaces)
    ).toThrow(PathTraversalError);
  });
});
