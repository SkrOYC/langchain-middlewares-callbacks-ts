import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PathTraversalError } from "@/domain/errors";
import { PhysicalStoreAdapter } from "@/infrastructure/physical-store";

let workspaceRoot = "";
let outsideDir = "";
let adapter: PhysicalStoreAdapter;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "ws-middleware-symlink-root-"));
  outsideDir = await mkdtemp(join(tmpdir(), "ws-middleware-symlink-outside-"));
  adapter = new PhysicalStoreAdapter(workspaceRoot);
});

afterEach(async () => {
  if (workspaceRoot !== "") {
    await rm(workspaceRoot, { recursive: true, force: true });
  }

  if (outsideDir !== "") {
    await rm(outsideDir, { recursive: true, force: true });
  }
});

describe("PhysicalStoreAdapter symlink defense", () => {
  test("rejects read attempts through symlinks that escape workspace", async () => {
    const outsideFile = join(outsideDir, "secret.txt");
    const symlinkPath = join(workspaceRoot, "linked.txt");

    await writeFile(outsideFile, "secret", "utf8");
    await symlink(outsideFile, symlinkPath);

    await expect(adapter.read("linked.txt")).rejects.toBeInstanceOf(
      PathTraversalError
    );
  });

  test("rejects write attempts through pre-existing symlink paths", async () => {
    const outsideFile = join(outsideDir, "target.txt");
    const symlinkPath = join(workspaceRoot, "linked-write.txt");

    await writeFile(outsideFile, "original", "utf8");
    await symlink(outsideFile, symlinkPath);

    await expect(
      adapter.write("linked-write.txt", "overwrite")
    ).rejects.toBeInstanceOf(PathTraversalError);
  });

  test("rejects reads through intermediate symlink directories", async () => {
    const outsideFile = join(outsideDir, "secret-nested.txt");
    const linkedDir = join(workspaceRoot, "linked-dir");

    await mkdir(join(outsideDir, "nested"), { recursive: true });
    await writeFile(outsideFile, "nested-secret", "utf8");
    await symlink(outsideDir, linkedDir);

    await expect(
      adapter.read("linked-dir/secret-nested.txt")
    ).rejects.toBeInstanceOf(PathTraversalError);
  });

  test("does not create external directories before rejecting symlinked parent writes", async () => {
    const linkedDir = join(workspaceRoot, "linked-parent");
    const outsideCreatedDir = join(outsideDir, "created-by-write");

    await symlink(outsideDir, linkedDir);

    await expect(
      adapter.write("linked-parent/created-by-write/file.txt", "data")
    ).rejects.toBeInstanceOf(PathTraversalError);

    await expect(lstat(outsideCreatedDir)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
