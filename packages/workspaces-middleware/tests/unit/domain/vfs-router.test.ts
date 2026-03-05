import { describe, expect, test } from "bun:test";

import { AccessDeniedError } from "../../../src/domain/errors";
import type { Workspace } from "../../../src/domain/models";
import type { StorePort } from "../../../src/domain/store-port";
import { resolveWorkspace } from "../../../src/domain/vfs-router";

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
});
