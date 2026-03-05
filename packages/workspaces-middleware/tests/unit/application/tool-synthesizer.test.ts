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

  test("enforces resolution and authorization before store access", async () => {
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
});
