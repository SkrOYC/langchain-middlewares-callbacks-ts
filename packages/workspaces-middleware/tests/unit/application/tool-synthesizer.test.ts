import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import {
  buildVFSServices,
  synthesizeSafeTools,
} from "@/application/tool-synthesizer";
import { AccessDeniedError } from "@/domain/errors";
import type { MountConfig, RegisteredTool } from "@/presentation/index";

let workspaceRoot = "";

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "ws-middleware-services-"));
});

afterEach(async () => {
  if (workspaceRoot !== "") {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

const readTool: RegisteredTool = {
  name: "read_docs",
  description: "Read docs",
  parameters: z.object({ path: z.string() }),
  operations: ["read"],
  handler: async () => ({
    content: "ok",
  }),
};

const writeTool: RegisteredTool = {
  name: "write_docs",
  description: "Write docs",
  parameters: z.object({ path: z.string(), content: z.string() }),
  operations: ["write"],
  handler: async () => ({
    content: "ok",
  }),
};

describe("tool-synthesizer", () => {
  test("filters disallowed tools based on aggregate access scope", () => {
    const mounts: MountConfig[] = [
      {
        prefix: "/project",
        scope: "READ_ONLY",
        store: { type: "physical", rootDir: "/tmp/project" },
      },
    ];

    const safe = synthesizeSafeTools(mounts, [readTool, writeTool]);

    expect(safe.map((tool) => tool.name)).toEqual(["read_docs"]);
  });

  test("exposes no filesystem tools when no mounts are configured", () => {
    const safe = synthesizeSafeTools([], [readTool, writeTool]);

    expect(safe).toHaveLength(0);
  });

  test("enforces write operation with READ_WRITE scope", async () => {
    await mkdir(join(workspaceRoot, "docs"), { recursive: true });

    const mounts: MountConfig[] = [
      {
        prefix: "/project",
        scope: "READ_WRITE",
        store: { type: "physical", rootDir: workspaceRoot },
      },
    ];

    const services = buildVFSServices(mounts);

    const resolved = services.resolve("/project/docs/new.txt");
    await services.write(resolved.normalizedKey, "new content");

    const content = await readFile(
      join(workspaceRoot, "docs", "new.txt"),
      "utf8"
    );
    expect(content).toBe("new content");
  });

  test("enforces list operation with READ_ONLY scope", async () => {
    await mkdir(join(workspaceRoot, "docs"), { recursive: true });
    await writeFile(join(workspaceRoot, "docs", "readme.md"), "hello", "utf8");
    await writeFile(join(workspaceRoot, "docs", "guide.md"), "guide", "utf8");

    const mounts: MountConfig[] = [
      {
        prefix: "/project",
        scope: "READ_ONLY",
        store: { type: "physical", rootDir: workspaceRoot },
      },
    ];

    const services = buildVFSServices(mounts);

    const resolved = services.resolve("/project/docs");
    const files = await services.list(resolved.normalizedKey);

    expect(files).toContain("docs/readme.md");
    expect(files).toContain("docs/guide.md");
  });

  test("enforces stat operation with READ_ONLY scope", async () => {
    await mkdir(join(workspaceRoot, "docs"), { recursive: true });
    await writeFile(join(workspaceRoot, "docs", "readme.md"), "hello", "utf8");

    const mounts: MountConfig[] = [
      {
        prefix: "/project",
        scope: "READ_ONLY",
        store: { type: "physical", rootDir: workspaceRoot },
      },
    ];

    const services = buildVFSServices(mounts);

    const resolved = services.resolve("/project/docs/readme.md");
    const stat = await services.stat(resolved.normalizedKey);

    expect(stat.exists).toBe(true);
  });

  test("uses in-memory base store for virtual mounts", async () => {
    const mounts: MountConfig[] = [
      {
        prefix: "/virtual",
        scope: "READ_WRITE",
        store: { type: "virtual", namespace: ["test", "namespace"] },
      },
    ];

    const services = buildVFSServices(mounts);

    await services.write("/virtual/test.txt", "virtual content");
    const content = await services.read("/virtual/test.txt");

    expect(content).toBe("virtual content");
  });

  test("rejects ambiguous normalized keys across workspaces", async () => {
    await mkdir(join(workspaceRoot, "docs"), { recursive: true });
    await writeFile(join(workspaceRoot, "docs", "readme.md"), "hello", "utf8");

    const mounts: MountConfig[] = [
      {
        prefix: "/project",
        scope: "READ_ONLY",
        store: { type: "physical", rootDir: workspaceRoot },
      },
    ];

    const services = buildVFSServices(mounts);

    const resolved = services.resolve("/project/docs/readme.md");
    const content = await services.read(resolved.normalizedKey);

    expect(content).toBe("hello");

    await expect(
      services.write(resolved.normalizedKey, "updated")
    ).rejects.toBeInstanceOf(AccessDeniedError);

    const current = await readFile(
      join(workspaceRoot, "docs", "readme.md"),
      "utf8"
    );
    expect(current).toBe("hello");

    await expect(services.read("/outside/readme.md")).rejects.toBeInstanceOf(
      AccessDeniedError
    );
  });

  test("rejects ambiguous normalized keys across workspaces", async () => {
    const workspaceRootA = join(workspaceRoot, "workspace-a");
    const workspaceRootB = join(workspaceRoot, "workspace-b");

    await mkdir(join(workspaceRootA, "docs"), { recursive: true });
    await mkdir(join(workspaceRootB, "docs"), { recursive: true });
    await writeFile(
      join(workspaceRootA, "docs", "readme.md"),
      "from-a",
      "utf8"
    );
    await writeFile(
      join(workspaceRootB, "docs", "readme.md"),
      "from-b",
      "utf8"
    );

    const mounts: MountConfig[] = [
      {
        prefix: "/workspace-a",
        scope: "READ_WRITE",
        store: { type: "physical", rootDir: workspaceRootA },
      },
      {
        prefix: "/workspace-b",
        scope: "READ_WRITE",
        store: { type: "physical", rootDir: workspaceRootB },
      },
    ];

    const services = buildVFSServices(mounts);

    const resolvedA = services.resolve("/workspace-a/docs/readme.md");
    expect(await services.read(resolvedA.normalizedKey)).toBe("from-a");

    const resolvedB = services.resolve("/workspace-b/docs/readme.md");
    await expect(services.read(resolvedA.normalizedKey)).rejects.toBeInstanceOf(
      AccessDeniedError
    );
    await expect(services.read(resolvedB.normalizedKey)).rejects.toBeInstanceOf(
      AccessDeniedError
    );

    expect(await services.read("/workspace-a/docs/readme.md")).toBe("from-a");
    expect(await services.read("/workspace-b/docs/readme.md")).toBe("from-b");
  });
});
