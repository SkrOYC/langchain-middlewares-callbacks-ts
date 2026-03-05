import { describe, expect, test } from "bun:test";

import {
  buildBaseStoreKey,
  buildBaseStorePrefix,
  splitBaseStoreKey,
} from "@/infrastructure/virtual-store";

describe("virtual store key mapping", () => {
  test("builds deterministic collision-free keys for namespace tuple + key", () => {
    const keyA = buildBaseStoreKey(["a", "bc"], "d");
    const keyB = buildBaseStoreKey(["ab", "c"], "d");

    expect(keyA).not.toBe(keyB);
    expect(buildBaseStoreKey(["workspaces", "agent-1"], "docs/api.ts")).toBe(
      buildBaseStoreKey(["workspaces", "agent-1"], "docs/api.ts")
    );
  });

  test("creates prefix keys for directory-like listing", () => {
    const prefix = buildBaseStorePrefix(["workspaces", "agent-1"], "docs");
    const inside = buildBaseStoreKey(["workspaces", "agent-1"], "docs/api.ts");
    const outsideNamespace = buildBaseStoreKey(
      ["workspaces", "agent-2"],
      "docs/api.ts"
    );
    const outsidePath = buildBaseStoreKey(
      ["workspaces", "agent-1"],
      "src/main.ts"
    );

    expect(inside.startsWith(prefix)).toBe(true);
    expect(outsideNamespace.startsWith(prefix)).toBe(false);
    expect(outsidePath.startsWith(prefix)).toBe(false);
  });

  test("extracts the normalized key from mapped BaseStore keys", () => {
    const mappedKey = buildBaseStoreKey(
      ["workspaces", "agent-1"],
      "project/docs/guide.md"
    );

    expect(splitBaseStoreKey(["workspaces", "agent-1"], mappedKey)).toBe(
      "project/docs/guide.md"
    );
  });
});
