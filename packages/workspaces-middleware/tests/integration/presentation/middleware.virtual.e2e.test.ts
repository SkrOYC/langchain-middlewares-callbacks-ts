import { describe, expect, test } from "bun:test";
import { ToolMessage } from "@langchain/core/messages";
import { InMemoryStore } from "@langchain/core/stores";
import { z } from "zod";

import { buildBaseStoreKey } from "@/infrastructure/virtual-store";
import type {
  BaseStoreLike,
  RegisteredTool,
  WorkspacesMiddlewareOptions,
} from "@/presentation/index";
import { createWorkspacesMiddleware } from "@/presentation/middleware";

// Create a BaseStoreLike from LangChain's InMemoryStore
function createBaseStoreLike(): BaseStoreLike {
  const store = new InMemoryStore<string>();

  return {
    mget: async (keys) => store.mget(keys),
    mset: async (keyValuePairs) => store.mset(keyValuePairs),
    mdelete: async (keys) => store.mdelete(keys),
    yieldKeys(prefix?: string): AsyncGenerator<string> {
      return store.yieldKeys(prefix);
    },
  };
}

function createVirtualReadTool(): RegisteredTool {
  return {
    name: "read_virtual_file",
    description: "Read a file from virtual storage",
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

function createVirtualWriteTool(): RegisteredTool {
  return {
    name: "write_virtual_file",
    description: "Write content to virtual storage",
    parameters: z.object({ path: z.string(), content: z.string() }),
    operations: ["write"],
    handler: async (params, services) => {
      const input = params as { path: string; content: string };
      const resolved = services.resolve(input.path);
      await services.write(resolved.normalizedKey, input.content);
      return { content: "Virtual file written" };
    },
  };
}

function createVirtualListTool(): RegisteredTool {
  return {
    name: "list_virtual_files",
    description: "List files in virtual storage",
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

describe("E2E: Full middleware flow with virtual mounts", () => {
  test("executes read operation through middleware with virtual mount", async () => {
    const virtualStore = createBaseStoreLike();
    const namespace = ["workspaces", "test"];

    // Pre-populate some data using correct key format
    await virtualStore.mset([
      [buildBaseStoreKey(namespace, "docs/readme.md"), "# Virtual Hello"],
      [buildBaseStoreKey(namespace, "docs/api.md"), "# Virtual API"],
    ]);

    const options: WorkspacesMiddlewareOptions = {
      mounts: [
        {
          prefix: "/virtual",
          scope: "READ_ONLY",
          store: { type: "virtual", namespace },
        },
      ],
      tools: [createVirtualReadTool()],
      virtualStore,
    };

    const middleware = createWorkspacesMiddleware(options);
    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "e2e-virt-read-1",
          name: "read_virtual_file",
          args: { path: "/virtual/docs/readme.md" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toBe("# Virtual Hello");
  });

  test("executes write operation through middleware with virtual mount", async () => {
    const virtualStore = createBaseStoreLike();

    const options: WorkspacesMiddlewareOptions = {
      mounts: [
        {
          prefix: "/virtual",
          scope: "READ_WRITE",
          store: { type: "virtual", namespace: ["workspaces", "test"] },
        },
      ],
      // Include both read and write tools so the tool can be found
      tools: [createVirtualReadTool(), createVirtualWriteTool()],
      virtualStore,
    };

    const middleware = createWorkspacesMiddleware(options);
    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "e2e-virt-write-1",
          name: "write_virtual_file",
          args: { path: "/virtual/docs/new.md", content: "# New Virtual Doc" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toBe("Virtual file written");

    // Verify data was stored by reading it back
    const readResult = await wrapToolCall(
      {
        toolCall: {
          id: "e2e-virt-read-2",
          name: "read_virtual_file",
          args: { path: "/virtual/docs/new.md" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect((readResult as ToolMessage).content).toBe("# New Virtual Doc");
  });

  test("executes list operation through middleware with virtual mount", async () => {
    const virtualStore = createBaseStoreLike();
    const namespace = ["workspaces", "test"];

    // Pre-populate using correct key format
    await virtualStore.mset([
      [buildBaseStoreKey(namespace, "docs/a.txt"), "a"],
      [buildBaseStoreKey(namespace, "docs/b.txt"), "b"],
      [buildBaseStoreKey(namespace, "other.txt"), "other"],
    ]);

    const options: WorkspacesMiddlewareOptions = {
      mounts: [
        {
          prefix: "/virtual",
          scope: "READ_ONLY",
          store: { type: "virtual", namespace },
        },
      ],
      tools: [createVirtualListTool()],
      virtualStore,
    };

    const middleware = createWorkspacesMiddleware(options);
    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "e2e-virt-list-1",
          name: "list_virtual_files",
          args: { path: "/virtual/docs" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toContain("docs/a.txt");
    expect((result as ToolMessage).content).toContain("docs/b.txt");
    // Should not include files from other namespaces
    expect((result as ToolMessage).content).not.toContain("other.txt");
  });

  test("unauthorized virtual mount operations return graceful failures", async () => {
    const virtualStore = createBaseStoreLike();

    const options: WorkspacesMiddlewareOptions = {
      mounts: [
        {
          prefix: "/virtual",
          scope: "READ_ONLY",
          store: { type: "virtual", namespace: ["workspaces", "test"] },
        },
      ],
      tools: [createVirtualWriteTool()],
      virtualStore,
    };

    const middleware = createWorkspacesMiddleware(options);
    const wrapToolCall = middleware.wrapToolCall as NonNullable<
      typeof middleware.wrapToolCall
    >;

    const result = await wrapToolCall(
      {
        toolCall: {
          id: "e2e-virt-unauth-1",
          name: "write_virtual_file",
          args: { path: "/virtual/docs/readme.md", content: "hacked" },
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
  });
});
