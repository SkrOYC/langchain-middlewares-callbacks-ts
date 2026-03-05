import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PathTraversalError } from "@/domain/errors";
import { PhysicalStoreAdapter } from "@/infrastructure/physical-store";

let workspaceRoot = "";
let adapter: PhysicalStoreAdapter;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "ws-middleware-physical-"));
  adapter = new PhysicalStoreAdapter(workspaceRoot);
});

afterEach(async () => {
  if (workspaceRoot !== "") {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

describe("PhysicalStoreAdapter", () => {
  test("reads and writes files within workspace root", async () => {
    await adapter.write("docs/readme.md", "hello");

    const content = await adapter.read("docs/readme.md");

    expect(content).toBe("hello");
  });

  test("edits file content and returns replacement count", async () => {
    await adapter.write("docs/file.txt", "one two one");

    const count = await adapter.edit("docs/file.txt", "one", "ONE");
    const updated = await adapter.read("docs/file.txt");

    expect(count).toBe(1);
    expect(updated).toBe("ONE two one");
  });

  test("lists directory entries as normalized relative keys", async () => {
    await adapter.write("docs/a.txt", "A");
    await adapter.write("docs/b.txt", "B");

    const entries = await adapter.list("docs");

    expect(entries).toEqual(["docs/a.txt", "docs/b.txt"]);
  });

  test("rejects traversal keys that escape the workspace root", async () => {
    await expect(adapter.write("../escape.txt", "nope")).rejects.toBeInstanceOf(
      PathTraversalError
    );
  });

  test("rejects Windows absolute paths", async () => {
    await expect(adapter.write("C:/escape.txt", "nope")).rejects.toBeInstanceOf(
      PathTraversalError
    );
  });

  test("writes real files under root directory", async () => {
    await adapter.write("nested/path.txt", "disk-check");

    const raw = await readFile(join(workspaceRoot, "nested/path.txt"), "utf8");

    expect(raw).toBe("disk-check");
  });

  test("returns truncated content with warning for files above threshold", async () => {
    const largeAdapter = new PhysicalStoreAdapter(workspaceRoot, {
      largeFileThresholdBytes: 32,
    });

    const largeContent = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    await largeAdapter.write("big.txt", largeContent);

    const readResult = await largeAdapter.read("big.txt");

    expect(readResult).toBe(
      "0123456789ABCDEFGHIJKLMNOPQRSTUV[...truncated. File size: 36 bytes. Use offset/limit to read remaining content.]"
    );
  });

  test("supports offset/limit pagination windows", async () => {
    await adapter.write("window.txt", "abcdefghijklmnopqrstuvwxyz");

    const paged = await adapter.read("window.txt", 5, 7);

    expect(paged).toBe("fghijkl");
  });

  test("uses character-window pagination for UTF-8 content", async () => {
    await adapter.write("utf8.txt", "éa");

    const paged = await adapter.read("utf8.txt", 1, 1);

    expect(paged).toBe("a");
  });

  test("handles UTF-8 truncation and continuation without broken symbols", async () => {
    const largeAdapter = new PhysicalStoreAdapter(workspaceRoot, {
      largeFileThresholdBytes: 5,
    });

    await largeAdapter.write("emoji.txt", "🙂🙂🙂");

    const firstChunk = await largeAdapter.read("emoji.txt");
    const continuation = await largeAdapter.read("emoji.txt", 1, 1);

    expect(firstChunk).toBe(
      "🙂[...truncated. File size: 12 bytes. Use offset/limit to read remaining content.]"
    );
    expect(continuation).toBe("🙂");
  });

  test("enforces byte threshold for multibyte UTF-8 content", async () => {
    const largeAdapter = new PhysicalStoreAdapter(workspaceRoot, {
      largeFileThresholdBytes: 4,
    });

    await largeAdapter.write("emoji-byte-threshold.txt", "🙂🙂");

    const firstChunk = await largeAdapter.read("emoji-byte-threshold.txt");

    expect(firstChunk).toBe(
      "🙂[...truncated. File size: 8 bytes. Use offset/limit to read remaining content.]"
    );
  });

  test("rejects normalized Windows absolute path bypass attempts", async () => {
    await expect(
      adapter.write("C:/../escape.txt", "nope")
    ).rejects.toBeInstanceOf(PathTraversalError);
  });

  test("rejects slash-prefixed Windows absolute path bypass attempts", async () => {
    await expect(
      adapter.write("/C:/escape.txt", "nope")
    ).rejects.toBeInstanceOf(PathTraversalError);
  });

  test("returns paginated windows for large files without truncation warning", async () => {
    const largeAdapter = new PhysicalStoreAdapter(workspaceRoot, {
      largeFileThresholdBytes: 16,
    });

    await largeAdapter.write("window-large.txt", "abcdefghijklmnopqrstuvwxyz");

    const paged = await largeAdapter.read("window-large.txt", 5, 7);

    expect(paged).toBe("fghijkl");
    expect(paged.includes("...truncated")).toBe(false);
  });

  test("caps offset-only reads and appends truncation warning", async () => {
    const largeAdapter = new PhysicalStoreAdapter(workspaceRoot, {
      largeFileThresholdBytes: 16,
    });

    await largeAdapter.write("window-offset.txt", "abcdefghijklmnopqrstuvwxyz");

    const paged = await largeAdapter.read("window-offset.txt", 5);

    expect(paged).toBe(
      "fghijklmnopqrstu[...truncated. File size: 26 bytes. Use offset/limit to read remaining content.]"
    );
  });

  test("does not append warning when offset-only read exactly matches remaining bytes", async () => {
    const largeAdapter = new PhysicalStoreAdapter(workspaceRoot, {
      largeFileThresholdBytes: 16,
    });

    await largeAdapter.write("window-exact.txt", "abcdefghijklmnopqrstuvwxyz");

    const paged = await largeAdapter.read("window-exact.txt", 10);

    expect(paged).toBe("klmnopqrstuvwxyz");
    expect(paged.includes("...truncated")).toBe(false);
  });

  test("rejects edit operations for files above threshold", async () => {
    const largeAdapter = new PhysicalStoreAdapter(workspaceRoot, {
      largeFileThresholdBytes: 16,
    });

    await largeAdapter.write("edit-large.txt", "abcdefghijklmnopqrstuvwxyz");

    await expect(
      largeAdapter.edit("edit-large.txt", "abc", "ABC")
    ).rejects.toThrow("File too large for edit operation");

    const current = await largeAdapter.read("edit-large.txt", 0, 26);
    expect(current).toBe("abcdefghijklmnopqrstuvwxyz");
  });

  test("reads full content when below threshold", async () => {
    const smallAdapter = new PhysicalStoreAdapter(workspaceRoot, {
      largeFileThresholdBytes: 1024,
    });

    await smallAdapter.write("small.txt", "short");

    const readResult = await smallAdapter.read("small.txt");

    expect(readResult).toBe("short");
  });
});
