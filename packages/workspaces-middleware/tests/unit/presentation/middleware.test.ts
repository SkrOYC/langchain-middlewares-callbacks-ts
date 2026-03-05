import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";
import type {
  RegisteredTool,
  WorkspacesMiddlewareOptions,
} from "@/presentation/index";
import { createWorkspacesMiddleware } from "@/presentation/middleware";

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
    expect((result as ToolMessage).content).toBe("Error: boom");
    expect((result as ToolMessage).status).toBe("error");
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
});
