import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolMessage } from "@langchain/core/messages";
import { z } from "zod";

import type {
  RegisteredTool,
  WorkspacesMiddlewareOptions,
} from "@/presentation/index";
import { createWorkspacesMiddleware } from "@/presentation/middleware";

let workspaceRoot = "";

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "ws-middleware-e2e-phys-"));
  await mkdir(join(workspaceRoot, "docs"), { recursive: true });
  await mkdir(join(workspaceRoot, "data"), { recursive: true });
  await writeFile(
    join(workspaceRoot, "docs", "readme.md"),
    "# Hello World",
    "utf8"
  );
  await writeFile(join(workspaceRoot, "docs", "api.md"), "# API Docs", "utf8");
  await writeFile(
    join(workspaceRoot, "data", "config.json"),
    '{"key": "value"}',
    "utf8"
  );
});

afterEach(async () => {
  if (workspaceRoot !== "") {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

function createReadTool(): RegisteredTool {
  return {
    name: "read_file",
    description: "Read a file from the workspace",
    parameters: z.object({ path: z.string() }),
    operations: ["read"],
    handler: async (params, services) => {
      const input = params as { path: string };
      const resolved = services.resolve(input.path);
      const content = await services.read(resolved.normalizedKey);
      return { content };
    },
  };
}

function createWriteTool(): RegisteredTool {
  return {
    name: "write_file",
    description: "Write content to a file",
    parameters: z.object({ path: z.string(), content: z.string() }),
    operations: ["write"],
    handler: async (params, services) => {
      const input = params as { path: string; content: string };
      const resolved = services.resolve(input.path);
      await services.write(resolved.normalizedKey, input.content);
      return { content: "File written successfully" };
    },
  };
}

function createListTool(): RegisteredTool {
  return {
    name: "list_files",
    description: "List files in a directory",
    parameters: z.object({ path: z.string() }),
    operations: ["list"],
    handler: async (params, services) => {
      const input = params as { path: string };
      const resolved = services.resolve(input.path);
      const files = await services.list(resolved.normalizedKey);
      return { content: files.join("\n") };
    },
  };
}

function createEditTool(): RegisteredTool {
  return {
    name: "edit_file",
    description: "Edit a file (read + write)",
    parameters: z.object({ path: z.string(), content: z.string() }),
    operations: ["edit"],
    handler: async (params, services) => {
      const input = params as { path: string; content: string };
      const resolved = services.resolve(input.path);
      await services.write(resolved.normalizedKey, input.content);
      return { content: "File edited successfully" };
    },
  };
}

describe("E2E: Full middleware flow with physical mounts", () => {
  test("executes read operation through middleware", async () => {
    const options: WorkspacesMiddlewareOptions = {
      mounts: [
        {
          prefix: "/project",
          scope: "READ_ONLY",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [createReadTool()],
    };

    const middleware = createWorkspacesMiddleware(options);
    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "e2e-read-1",
          name: "read_file",
          args: { path: "/project/docs/readme.md" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toBe("# Hello World");
  });

  test("executes write operation through middleware", async () => {
    const options: WorkspacesMiddlewareOptions = {
      mounts: [
        {
          prefix: "/project",
          scope: "READ_WRITE",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [createWriteTool()],
    };

    const middleware = createWorkspacesMiddleware(options);
    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "e2e-write-1",
          name: "write_file",
          args: { path: "/project/data/new.txt", content: "new content" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toBe("File written successfully");

    // Verify file was actually written
    const fileContent = await readFile(
      join(workspaceRoot, "data", "new.txt"),
      "utf8"
    );
    expect(fileContent).toBe("new content");
  });

  test("executes list operation through middleware", async () => {
    const options: WorkspacesMiddlewareOptions = {
      mounts: [
        {
          prefix: "/project",
          scope: "READ_ONLY",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [createListTool()],
    };

    const middleware = createWorkspacesMiddleware(options);
    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "e2e-list-1",
          name: "list_files",
          args: { path: "/project/docs" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toContain("readme.md");
    expect((result as ToolMessage).content).toContain("api.md");
  });

  test("unauthorized operations return graceful ToolMessage failures", async () => {
    // Configure READ_ONLY but try to write
    const options: WorkspacesMiddlewareOptions = {
      mounts: [
        {
          prefix: "/project",
          scope: "READ_ONLY",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [createWriteTool()],
    };

    const middleware = createWorkspacesMiddleware(options);
    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "e2e-unauthorized-1",
          name: "write_file",
          args: { path: "/project/docs/readme.md", content: "hacked" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toContain("not allowed");
    expect((result as ToolMessage).status).toBe("error");

    // Verify original file was NOT modified
    const fileContent = await readFile(
      join(workspaceRoot, "docs", "readme.md"),
      "utf8"
    );
    expect(fileContent).toBe("# Hello World");
  });

  test("maintains runtime stability - no unhandled exception crash", async () => {
    const options: WorkspacesMiddlewareOptions = {
      mounts: [
        {
          prefix: "/project",
          scope: "READ_ONLY",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [createReadTool()],
    };

    const middleware = createWorkspacesMiddleware(options);
    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    // Multiple operations should not crash
    for (let i = 0; i < 10; i++) {
      const result = await wrapToolCall(
        {
          toolCall: {
            id: `e2e-stable-${i}`,
            name: "read_file",
            args: { path: "/project/docs/readme.md" },
          },
          runtime: { context: { threadId: "thread-1", runId: "run-1" } },
          state: { messages: [] },
        } as never,
        () => {
          throw new Error("fallback should not run");
        }
      );

      expect(result).toBeInstanceOf(ToolMessage);
    }
  });

  test("executes edit operation through middleware", async () => {
    const options: WorkspacesMiddlewareOptions = {
      mounts: [
        {
          prefix: "/project",
          scope: "READ_WRITE",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [createEditTool()],
    };

    const middleware = createWorkspacesMiddleware(options);
    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "e2e-edit-1",
          name: "edit_file",
          args: {
            path: "/project/docs/readme.md",
            content: "# Updated Content",
          },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toBe("File edited successfully");

    // Verify file was actually edited
    const fileContent = await readFile(
      join(workspaceRoot, "docs", "readme.md"),
      "utf8"
    );
    expect(fileContent).toBe("# Updated Content");
  });
});
