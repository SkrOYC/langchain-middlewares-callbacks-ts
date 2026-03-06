import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";

import {
  type BaseStoreLike,
  buildBaseStoreKey,
  FilesystemUnresponsiveError,
} from "@/infrastructure/virtual-store";
import type {
  RegisteredTool,
  WorkspacesMiddlewareOptions,
} from "@/presentation/index";
import {
  createWorkspacesMiddleware,
  type WorkspacesMiddlewareContext,
} from "@/presentation/middleware";

type IsNever<T> = [T] extends [never] ? true : false;
type MiddlewareContextType = Parameters<
  NonNullable<ReturnType<typeof createWorkspacesMiddleware>["wrapToolCall"]>
>[0]["runtime"]["context"];
type ContextHasExpectedShape =
  MiddlewareContextType extends WorkspacesMiddlewareContext ? true : false;

const _contextTypingInvariant: [
  IsNever<MiddlewareContextType>,
  ContextHasExpectedShape,
] = [false, true];

let workspaceRoot = "";

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "ws-middleware-orchestration-"));
  await mkdir(join(workspaceRoot, "docs"), { recursive: true });
  await writeFile(join(workspaceRoot, "docs", "readme.md"), "hello", "utf8");
});

afterEach(async () => {
  if (workspaceRoot !== "") {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

function createReadTool(): RegisteredTool {
  return {
    name: "read_workspace_file",
    description: "Read file from workspace",
    parameters: z.object({ path: z.string() }),
    operations: ["read"],
    handler: async (params, services) => {
      const input = params as { path: string };
      const resolved = services.resolve(input.path);
      const content = await services.read(resolved.normalizedKey);

      return {
        content,
      };
    },
  };
}

describe("createWorkspacesMiddleware", () => {
  test("invokes registered tool handler with VFSServices and returns ToolMessage", async () => {
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

    let fallbackCalled = false;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "call-1",
          name: "read_workspace_file",
          args: { path: "/project/docs/readme.md" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        fallbackCalled = true;
        return new ToolMessage({
          tool_call_id: "call-1",
          content: "fallback",
        });
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).tool_call_id).toBe("call-1");
    expect((result as ToolMessage).content).toBe("hello");
    expect(fallbackCalled).toBe(false);
  });

  test("maps missing file errors to a safe File not found message", async () => {
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
          id: "call-missing",
          name: "read_workspace_file",
          args: { path: "/project/docs/missing.txt" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toBe("Error: File not found");
    expect((result as ToolMessage).content).not.toContain(workspaceRoot);
  });

  test("does not swallow errors from unregistered tools", async () => {
    const middleware = createWorkspacesMiddleware({
      mounts: [
        {
          prefix: "/project",
          scope: "READ_ONLY",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [createReadTool()],
    });

    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    await expect(
      wrapToolCall(
        {
          toolCall: {
            id: "call-unregistered",
            name: "other_tool",
            args: {},
          },
          runtime: { context: { threadId: "thread-1", runId: "run-1" } },
          state: { messages: [] },
        } as never,
        () => {
          throw new Error("downstream failure");
        }
      )
    ).rejects.toThrow("downstream failure");
  });

  test("converts thrown handler errors into graceful ToolMessage failures", async () => {
    const failingTool: RegisteredTool = {
      name: "failing_tool",
      description: "Always throws",
      parameters: z.object({}),
      operations: ["read"],
      handler: async () => {
        await Promise.resolve();
        throw new Error("boom");
      },
    };

    const middleware = createWorkspacesMiddleware({
      mounts: [
        {
          prefix: "/project",
          scope: "READ_ONLY",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [failingTool],
    });

    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "call-2",
          name: "failing_tool",
          args: {},
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("should not run fallback");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toBe(
      "Error: Filesystem operation failed"
    );
    expect((result as ToolMessage).status).toBe("error");
  });

  test("maps filesystem timeout errors to Filesystem unresponsive", async () => {
    const timeoutTool: RegisteredTool = {
      name: "timeout_tool",
      description: "Simulate virtual store timeout",
      parameters: z.object({}),
      operations: ["read"],
      handler: () => {
        throw new FilesystemUnresponsiveError();
      },
    };

    const middleware = createWorkspacesMiddleware({
      mounts: [
        {
          prefix: "/project",
          scope: "READ_ONLY",
          store: { type: "virtual", namespace: ["workspaces", "timeout"] },
        },
      ],
      tools: [timeoutTool],
    });

    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "call-timeout",
          name: "timeout_tool",
          args: {},
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toBe(
      "Error: Filesystem unresponsive"
    );
    expect((result as ToolMessage).status).toBe("error");
  });

  test("uses injected virtualStore for virtual mount operations", async () => {
    const data = new Map<string, string>();
    const injectedStore: BaseStoreLike = {
      mget: async (keys) => keys.map((key) => data.get(key)),
      mset: async (pairs) => {
        for (const [key, value] of pairs) {
          data.set(key, value);
        }
        await Promise.resolve();
      },
      mdelete: async (keys) => {
        for (const key of keys) {
          data.delete(key);
        }
        await Promise.resolve();
      },
      async *yieldKeys(prefix?: string) {
        await Promise.resolve();
        for (const key of data.keys()) {
          if (prefix === undefined || key.startsWith(prefix)) {
            yield key;
          }
        }
      },
    };

    const writeVirtualTool: RegisteredTool = {
      name: "write_virtual_file",
      description: "Write into virtual mount",
      parameters: z.object({ path: z.string(), content: z.string() }),
      operations: ["write"],
      handler: async (params, services) => {
        const input = params as { path: string; content: string };
        const resolved = services.resolve(input.path);
        await services.write(resolved.normalizedKey, input.content);

        return { content: "ok" };
      },
    };

    const middleware = createWorkspacesMiddleware({
      mounts: [
        {
          prefix: "/project",
          scope: "READ_WRITE",
          store: { type: "virtual", namespace: ["workspaces", "agent-a"] },
        },
      ],
      tools: [writeVirtualTool],
      virtualStore: injectedStore,
    });

    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "call-virtual",
          name: "write_virtual_file",
          args: { path: "/project/docs/new.txt", content: "persisted" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    const mappedKey = buildBaseStoreKey(
      ["workspaces", "agent-a"],
      "docs/new.txt"
    );
    expect(data.get(mappedKey)).toBe("persisted");
  });

  test("rejects undeclared operations used by a registered tool", async () => {
    const readOnlyDeclaredTool: RegisteredTool = {
      name: "read_declared_tool",
      description: "Declares read but writes",
      parameters: z.object({ path: z.string(), content: z.string() }),
      operations: ["read"],
      handler: async (params, services) => {
        const input = params as { path: string; content: string };
        const resolved = services.resolve(input.path);
        await services.write(resolved.normalizedKey, input.content);
        return { content: "unexpected" };
      },
    };

    const middleware = createWorkspacesMiddleware({
      mounts: [
        {
          prefix: "/project",
          scope: "READ_WRITE",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [readOnlyDeclaredTool],
    });

    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "call-undeclared-op",
          name: "read_declared_tool",
          args: { path: "/project/docs/new.txt", content: "blocked" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toContain(
      "Tool operation is not declared"
    );
  });

  test("blocks registered filesystem tools when mounts are empty", async () => {
    const middleware = createWorkspacesMiddleware({
      mounts: [],
      tools: [createReadTool()],
    });

    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    let fallbackCalled = false;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "call-3",
          name: "read_workspace_file",
          args: { path: "/project/docs/readme.md" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        fallbackCalled = true;
        return new ToolMessage({
          tool_call_id: "call-3",
          content: "fallback",
        });
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toContain("not allowed");
    expect(fallbackCalled).toBe(false);
  });

  test("refreshes filesystem map on each beforeModel turn", async () => {
    const options: WorkspacesMiddlewareOptions = {
      mounts: [
        {
          prefix: "/alpha",
          scope: "READ_ONLY",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [],
    };

    const middleware = createWorkspacesMiddleware(options);
    const beforeModelHook = middleware.beforeModel;

    if (beforeModelHook === undefined) {
      throw new Error("beforeModel hook is required");
    }

    const runtime = {
      context: { threadId: "thread-1", runId: "run-1" },
    } as never;

    const invokeBeforeModel = async (state: unknown) =>
      typeof beforeModelHook === "function"
        ? beforeModelHook(state as never, runtime)
        : beforeModelHook.hook(state as never, runtime);

    const initialState = {
      messages: [new HumanMessage("hi")],
    };

    const firstTurn = await invokeBeforeModel(initialState);

    options.mounts = [
      {
        prefix: "/beta",
        scope: "READ_WRITE",
        store: { type: "virtual", namespace: ["workspaces", "beta"] },
      },
    ];

    const secondTurn = await invokeBeforeModel({
      messages: (firstTurn as { messages?: unknown[] }).messages ?? [],
    });

    const firstMap = (
      (firstTurn as { messages?: unknown[] }).messages?.[0] as {
        content?: unknown;
      }
    ).content as string;
    const secondMap = (
      (secondTurn as { messages?: unknown[] }).messages?.[0] as {
        content?: unknown;
      }
    ).content as string;

    expect(firstMap).toContain("/alpha");
    expect(secondMap).toContain("/beta");
    expect(secondMap).not.toContain("/alpha");
  });

  test("passes through to handler when toolName is undefined", async () => {
    const middleware = createWorkspacesMiddleware({
      mounts: [
        {
          prefix: "/project",
          scope: "READ_ONLY",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [createReadTool()],
    });

    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    let fallbackCalled = false;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "call-no-name",
          name: undefined,
          args: {},
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        fallbackCalled = true;
        return new ToolMessage({
          tool_call_id: "call-no-name",
          content: "fallback result",
        });
      }
    );

    expect(fallbackCalled).toBe(true);
    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toBe("fallback result");
  });

  test("handles list operation with allowed list/search scope", async () => {
    const listTool: RegisteredTool = {
      name: "list_files",
      description: "List files in workspace",
      parameters: z.object({ path: z.string() }),
      operations: ["list"],
      handler: async (params, services) => {
        const input = params as { path: string };
        const resolved = services.resolve(input.path);
        const files = await services.list(resolved.normalizedKey);
        return { content: files.join(",") };
      },
    };

    const middleware = createWorkspacesMiddleware({
      mounts: [
        {
          prefix: "/project",
          scope: "READ_WRITE",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [listTool],
    });

    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "call-list",
          name: "list_files",
          args: { path: "/project" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toContain("docs");
  });

  test("handles stat operation with various allowed scopes", async () => {
    const statTool: RegisteredTool = {
      name: "stat_file",
      description: "Get file stats",
      parameters: z.object({ path: z.string() }),
      operations: ["read", "list", "edit", "search"],
      handler: async (params, services) => {
        const input = params as { path: string };
        const resolved = services.resolve(input.path);
        const stat = await services.stat(resolved.normalizedKey);
        return { content: JSON.stringify(stat) };
      },
    };

    const middleware = createWorkspacesMiddleware({
      mounts: [
        {
          prefix: "/project",
          scope: "READ_WRITE",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [statTool],
    });

    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "call-stat",
          name: "stat_file",
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
    expect((result as ToolMessage).content).toContain("exists");
  });

  test("maps error with message containing 'File not found' to safe message", async () => {
    const customErrorTool: RegisteredTool = {
      name: "custom_error_tool",
      description: "Throws custom error with File not found message",
      parameters: z.object({}),
      operations: ["read"],
      handler: () => {
        const error = new Error("Custom error: File not found in storage");
        throw error;
      },
    };

    const middleware = createWorkspacesMiddleware({
      mounts: [
        {
          prefix: "/project",
          scope: "READ_ONLY",
          store: { type: "physical", rootDir: workspaceRoot },
        },
      ],
      tools: [customErrorTool],
    });

    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "call-custom-error",
          name: "custom_error_tool",
          args: {},
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toBe("Error: File not found");
  });
});
