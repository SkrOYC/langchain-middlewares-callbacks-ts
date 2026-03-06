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

// Regex patterns for error matching - defined at top level for performance
const ACCESS_DENIED_PATTERN = /not allowed|does not map|AccessDenied/;
const SCOPE_VIOLATION_PATTERN = /not allowed|not permitted/;

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

describe("E2E: Concurrent virtual namespace isolation", () => {
  test("two agents with isolated virtual namespaces do not contaminate each other", async () => {
    // Shared store but different namespaces
    const sharedStore = createBaseStoreLike();

    // Agent A - has access to namespace ["workspaces", "agent-a"]
    const agentAMounts: WorkspacesMiddlewareOptions["mounts"] = [
      {
        prefix: "/agent-a",
        scope: "READ_WRITE",
        store: { type: "virtual", namespace: ["workspaces", "agent-a"] },
      },
    ];

    // Agent B - has access to namespace ["workspaces", "agent-b"]
    const agentBMounts: WorkspacesMiddlewareOptions["mounts"] = [
      {
        prefix: "/agent-b",
        scope: "READ_WRITE",
        store: { type: "virtual", namespace: ["workspaces", "agent-b"] },
      },
    ];

    // Create both middlewares with the same store but different mounts
    const agentAMiddleware = createWorkspacesMiddleware({
      mounts: agentAMounts,
      tools: [createVirtualReadTool(), createVirtualWriteTool()],
      virtualStore: sharedStore,
    });

    const agentBMiddleware = createWorkspacesMiddleware({
      mounts: agentBMounts,
      tools: [createVirtualReadTool(), createVirtualWriteTool()],
      virtualStore: sharedStore,
    });

    const agentAWrapToolCall = agentAMiddleware.wrapToolCall as NonNullable<
      typeof agentAMiddleware.wrapToolCall
    >;
    const agentBWrapToolCall = agentBMiddleware.wrapToolCall as NonNullable<
      typeof agentBMiddleware.wrapToolCall
    >;

    // Agent A writes to its namespace
    const agentAWriteResult = await agentAWrapToolCall(
      {
        toolCall: {
          id: "agent-a-write",
          name: "write_virtual_file",
          args: { path: "/agent-a/shared.txt", content: "Agent A content" },
        },
        runtime: { context: { threadId: "thread-a", runId: "run-a" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(agentAWriteResult).toBeInstanceOf(ToolMessage);

    // Agent B writes to its namespace (same filename, different namespace)
    const agentBWriteResult = await agentBWrapToolCall(
      {
        toolCall: {
          id: "agent-b-write",
          name: "write_virtual_file",
          args: { path: "/agent-b/shared.txt", content: "Agent B content" },
        },
        runtime: { context: { threadId: "thread-b", runId: "run-b" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(agentBWriteResult).toBeInstanceOf(ToolMessage);

    // Agent A reads back - should get Agent A content
    const agentAReadResult = await agentAWrapToolCall(
      {
        toolCall: {
          id: "agent-a-read",
          name: "read_virtual_file",
          args: { path: "/agent-a/shared.txt" },
        },
        runtime: { context: { threadId: "thread-a", runId: "run-a" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(agentAReadResult).toBeInstanceOf(ToolMessage);
    expect((agentAReadResult as ToolMessage).content).toBe("Agent A content");

    // Agent B reads back - should get Agent B content
    const agentBReadResult = await agentBWrapToolCall(
      {
        toolCall: {
          id: "agent-b-read",
          name: "read_virtual_file",
          args: { path: "/agent-b/shared.txt" },
        },
        runtime: { context: { threadId: "thread-b", runId: "run-b" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(agentBReadResult).toBeInstanceOf(ToolMessage);
    expect((agentBReadResult as ToolMessage).content).toBe("Agent B content");

    // Verify no cross-contamination: Agent A cannot read Agent B's file
    const agentACannotReadB = await agentAWrapToolCall(
      {
        toolCall: {
          id: "agent-a-cross-read",
          name: "read_virtual_file",
          args: { path: "/agent-b/shared.txt" },
        },
        runtime: { context: { threadId: "thread-a", runId: "run-a" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    // Should get an error because /agent-b doesn't exist in Agent A's mounts
    expect(agentACannotReadB).toBeInstanceOf(ToolMessage);
    // The middleware denies access because /agent-b is not in Agent A's workspace configuration
    expect((agentACannotReadB as ToolMessage).content).toMatch(
      ACCESS_DENIED_PATTERN
    );
  });

  test("parallel reads and writes maintain isolation", async () => {
    const sharedStore = createBaseStoreLike();

    // Multiple agents with different namespaces
    const agents = ["alice", "bob", "charlie"].map((name) => {
      const middleware = createWorkspacesMiddleware({
        mounts: [
          {
            prefix: `/${name}`,
            scope: "READ_WRITE",
            store: { type: "virtual", namespace: ["workspaces", name] },
          },
        ],
        tools: [createVirtualReadTool(), createVirtualWriteTool()],
        virtualStore: sharedStore,
      });

      return {
        name,
        wrapToolCall: middleware.wrapToolCall as NonNullable<
          typeof middleware.wrapToolCall
        >,
      };
    });

    // All agents write simultaneously
    await Promise.all(
      agents.map((agent) =>
        agent.wrapToolCall(
          {
            toolCall: {
              id: `parallel-write-${agent.name}`,
              name: "write_virtual_file",
              args: {
                path: `/${agent.name}/data.txt`,
                content: `${agent.name}'s data`,
              },
            },
            runtime: {
              context: {
                threadId: `thread-${agent.name}`,
                runId: `run-${agent.name}`,
              },
            },
            state: { messages: [] },
          } as never,
          () => {
            throw new Error("fallback should not run");
          }
        )
      )
    );

    // All agents read simultaneously and verify isolation
    const results = await Promise.all(
      agents.map((agent) =>
        agent.wrapToolCall(
          {
            toolCall: {
              id: `parallel-read-${agent.name}`,
              name: "read_virtual_file",
              args: { path: `/${agent.name}/data.txt` },
            },
            runtime: {
              context: {
                threadId: `thread-${agent.name}`,
                runId: `run-${agent.name}`,
              },
            },
            state: { messages: [] },
          } as never,
          () => {
            throw new Error("fallback should not run");
          }
        )
      )
    );

    // Each agent should read its own data
    for (let i = 0; i < agents.length; i++) {
      expect(results[i]).toBeInstanceOf(ToolMessage);
      expect((results[i] as ToolMessage).content).toBe(
        `${agents[i].name}'s data`
      );
    }
  });

  test("virtual namespace isolation with read-only and read-write mixed scopes", async () => {
    const sharedStore = createBaseStoreLike();
    const sharedNamespace = ["workspaces", "shared"];
    const privateNamespace = ["workspaces", "private"];

    // Pre-populate data using correct key format
    await sharedStore.mset([
      [buildBaseStoreKey(sharedNamespace, "public.txt"), "public content"],
      [buildBaseStoreKey(sharedNamespace, "private.txt"), "private content"],
    ]);

    // Agent with mixed scopes
    const mixedScopeMiddleware = createWorkspacesMiddleware({
      mounts: [
        {
          prefix: "/public",
          scope: "READ_ONLY",
          store: { type: "virtual", namespace: sharedNamespace },
        },
        {
          prefix: "/private",
          scope: "READ_WRITE",
          store: { type: "virtual", namespace: privateNamespace },
        },
      ],
      tools: [createVirtualReadTool(), createVirtualWriteTool()],
      virtualStore: sharedStore,
    });

    const wrapToolCall = mixedScopeMiddleware.wrapToolCall as NonNullable<
      typeof mixedScopeMiddleware.wrapToolCall
    >;

    // Read from public namespace should work
    const publicRead = await wrapToolCall(
      {
        toolCall: {
          id: "public-read",
          name: "read_virtual_file",
          args: { path: "/public/public.txt" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(publicRead).toBeInstanceOf(ToolMessage);
    expect((publicRead as ToolMessage).content).toBe("public content");

    // Write to public namespace should fail (READ_ONLY)
    const publicWrite = await wrapToolCall(
      {
        toolCall: {
          id: "public-write-attempt",
          name: "write_virtual_file",
          args: { path: "/public/hacked.txt", content: "hacked" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(publicWrite).toBeInstanceOf(ToolMessage);
    // Either tool not allowed or scope violation - both are acceptable
    expect((publicWrite as ToolMessage).content).toMatch(
      SCOPE_VIOLATION_PATTERN
    );

    // Write to private namespace should work
    const privateWrite = await wrapToolCall(
      {
        toolCall: {
          id: "private-write",
          name: "write_virtual_file",
          args: { path: "/private/secret.txt", content: "secret data" },
        },
        runtime: { context: { threadId: "thread-1", runId: "run-1" } },
        state: { messages: [] },
      } as never,
      () => {
        throw new Error("fallback should not run");
      }
    );

    expect(privateWrite).toBeInstanceOf(ToolMessage);
    expect((privateWrite as ToolMessage).content).toBe("Virtual file written");
  });
});
