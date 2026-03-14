import { describe, expect, test } from "bun:test";
import {
  OPENRESPONSES_TOOL_POLICY_CONFIG_KEY,
  type SerializedNormalizedToolPolicy,
} from "@/core/tool-policy.js";
import {
  createOpenResponsesAdapter,
  createOpenResponsesToolPolicyMiddleware,
} from "@/index.js";
import { normalizeRequest } from "@/server/previous-response.js";
import { createFakeAgent } from "@/testing/index.js";

const createBaseRequest = () => ({
  model: "gpt-4.1-mini",
  input: "Hello",
  metadata: {},
  tools: [],
  parallel_tool_calls: true,
  stream: false,
});

const lookupFactTool = {
  type: "function" as const,
  name: "lookup_fact",
  description: "Lookup a fact",
  parameters: { type: "object" },
  strict: true,
};

const getWeatherTool = {
  type: "function" as const,
  name: "get_weather",
  description: "Get weather",
  parameters: { type: "object" },
  strict: true,
};

describe("tool policy normalization", () => {
  test("normalizes role-aware messages and preserves image-bearing user input", async () => {
    const normalized = await normalizeRequest(
      {
        model: "gpt-4.1-mini",
        input: [
          {
            type: "message",
            role: "system",
            content: "Be terse.",
          },
          {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "Prefer tools." }],
          },
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "Describe this image." },
              {
                type: "input_image",
                image_url: "https://example.com/cat.png",
                detail: "high",
              },
            ],
          },
        ],
        metadata: {},
        tools: [],
        parallel_tool_calls: true,
        stream: false,
      },
      {}
    );

    expect(normalized.messages).toEqual([
      {
        type: "system",
        role: "system",
        content: "Be terse.",
      },
      {
        type: "developer",
        role: "developer",
        content: [{ type: "input_text", text: "Prefer tools." }],
      },
      {
        type: "human",
        role: "user",
        content: [
          { type: "input_text", text: "Describe this image." },
          {
            type: "input_image",
            image_url: "https://example.com/cat.png",
            detail: "high",
          },
        ],
      },
    ]);
  });

  test("rejects duplicate declared tool names", async () => {
    await expect(
      normalizeRequest(
        {
          ...createBaseRequest(),
          tools: [
            lookupFactTool,
            {
              type: "function",
              name: "lookup_fact",
              description: "Duplicate",
              parameters: { type: "object" },
              strict: true,
            },
          ],
        },
        {}
      )
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "Duplicate tool name 'lookup_fact' is not allowed",
    });
  });

  test("rejects unknown tool names in allowed_tools", async () => {
    await expect(
      normalizeRequest(
        {
          ...createBaseRequest(),
          tools: [
            lookupFactTool,
          ],
          tool_choice: {
            type: "allowed_tools",
            tools: [{ type: "function", name: "missing_tool" }],
          },
        },
        {}
      )
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "tool_choice references unknown tool 'missing_tool'",
    });
  });
});

describe("tool policy middleware", () => {
  test("rejects tool execution when tool_choice is none", async () => {
    const middleware = createOpenResponsesToolPolicyMiddleware();
    const wrapToolCall = middleware.wrapToolCall;
    if (!wrapToolCall) {
      throw new Error("Expected wrapToolCall to be defined");
    }

    const request = {
      toolCall: { id: "call-1", name: "lookup_fact", args: {} },
      tool: { name: "lookup_fact" },
      state: { messages: [] },
      runtime: {
        config: {
          configurable: {
            [OPENRESPONSES_TOOL_POLICY_CONFIG_KEY]: {
              tools: [],
              allowedToolNames: ["lookup_fact"],
              toolChoice: "none",
              parallelToolCalls: true,
            } satisfies SerializedNormalizedToolPolicy,
          },
        },
      },
    };

    await expect(
      wrapToolCall(
        request as Parameters<typeof wrapToolCall>[0],
        (async () => ({}) as never) as Parameters<typeof wrapToolCall>[1]
      )
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "tool_choice forbids tool execution",
    });
  });

  test("serializes tool handlers when parallel_tool_calls is false", async () => {
    const middleware = createOpenResponsesToolPolicyMiddleware();
    const wrapToolCall = middleware.wrapToolCall;
    if (!wrapToolCall) {
      throw new Error("Expected wrapToolCall to be defined");
    }

    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const order: string[] = [];
    const createRequest = (toolCallId: string) =>
      ({
        toolCall: { id: toolCallId, name: "lookup_fact", args: {} },
        tool: { name: "lookup_fact" },
        state: { messages: [] },
        runtime: {
          config: {
            configurable: {
              thread_id: "thread-1",
              [OPENRESPONSES_TOOL_POLICY_CONFIG_KEY]: {
                tools: [],
                allowedToolNames: ["lookup_fact"],
                toolChoice: "auto",
                parallelToolCalls: false,
              } satisfies SerializedNormalizedToolPolicy,
            },
          },
        },
      }) as Parameters<typeof wrapToolCall>[0];

    const first = wrapToolCall(
      createRequest("call-1"),
      (async () => {
        order.push("first:start");
        await firstDone;
        order.push("first:end");
        return {} as never;
      }) as Parameters<typeof wrapToolCall>[1]
    );

    const second = wrapToolCall(
      createRequest("call-2"),
      (async () => {
        order.push("second:start");
        order.push("second:end");
        return {} as never;
      }) as Parameters<typeof wrapToolCall>[1]
    );

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);

    releaseFirst();
    await first;
    await second;

    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  test("does not serialize tool handlers across different runs", async () => {
    const middleware = createOpenResponsesToolPolicyMiddleware();
    const wrapToolCall = middleware.wrapToolCall;
    if (!wrapToolCall) {
      throw new Error("Expected wrapToolCall to be defined");
    }

    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const order: string[] = [];
    const createRequest = (threadId: string, toolCallId: string) =>
      ({
        toolCall: { id: toolCallId, name: "lookup_fact", args: {} },
        tool: { name: "lookup_fact" },
        state: { messages: [] },
        runtime: {
          config: {
            configurable: {
              thread_id: threadId,
              [OPENRESPONSES_TOOL_POLICY_CONFIG_KEY]: {
                tools: [],
                allowedToolNames: ["lookup_fact"],
                toolChoice: "auto",
                parallelToolCalls: false,
              } satisfies SerializedNormalizedToolPolicy,
            },
          },
        },
      }) as Parameters<typeof wrapToolCall>[0];

    const first = wrapToolCall(
      createRequest("thread-a", "call-1"),
      (async () => {
        order.push("first:start");
        await firstDone;
        order.push("first:end");
        return {} as never;
      }) as Parameters<typeof wrapToolCall>[1]
    );

    const second = wrapToolCall(
      createRequest("thread-b", "call-2"),
      (async () => {
        order.push("second:start");
        order.push("second:end");
        return {} as never;
      }) as Parameters<typeof wrapToolCall>[1]
    );

    await Promise.resolve();
    expect(order).toEqual(["first:start", "second:start", "second:end"]);

    releaseFirst();
    await first;
    await second;
  });

  test("cleans queue state after afterAgent so a later run is not blocked", async () => {
    const middleware = createOpenResponsesToolPolicyMiddleware();
    const wrapToolCall = middleware.wrapToolCall;
    const afterAgent = middleware.afterAgent;
    if (!wrapToolCall || !afterAgent) {
      throw new Error("Expected middleware hooks to be defined");
    }

    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];

    const request = {
      toolCall: { id: "call-1", name: "lookup_fact", args: {} },
      tool: { name: "lookup_fact" },
      state: { messages: [] },
      runtime: {
        config: {
          configurable: {
            thread_id: "thread-cleanup",
            [OPENRESPONSES_TOOL_POLICY_CONFIG_KEY]: {
              tools: [],
              allowedToolNames: ["lookup_fact"],
              toolChoice: "auto",
              parallelToolCalls: false,
            } satisfies SerializedNormalizedToolPolicy,
          },
        },
      },
    } as Parameters<typeof wrapToolCall>[0];

    const first = wrapToolCall(
      request,
      (async () => {
        order.push("first:start");
        await firstDone;
        order.push("first:end");
        return {} as never;
      }) as Parameters<typeof wrapToolCall>[1]
    );

    releaseFirst();
    await first;
    if (typeof afterAgent === "function") {
      await afterAgent({ messages: [] }, request.runtime as never);
    } else {
      await afterAgent.hook({ messages: [] }, request.runtime as never);
    }

    await wrapToolCall(
      request,
      (async () => {
        order.push("second:start");
        order.push("second:end");
        return {} as never;
      }) as Parameters<typeof wrapToolCall>[1]
    );

    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });
});

describe("adapter tool policy enforcement", () => {
  test("fails closed for restrictive policies in metadata-only mode", async () => {
    const agent = createFakeAgent();
    const adapter = createOpenResponsesAdapter({ agent });

    await expect(
      adapter.invoke({
        ...createBaseRequest(),
        tools: [
          lookupFactTool,
        ],
        tool_choice: {
          type: "function",
          name: "lookup_fact",
        },
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      message:
        "This tool policy requires createOpenResponsesToolPolicyMiddleware() and toolPolicySupport: 'middleware'",
    });
  });

  test("passes serialized tool policy through configurable metadata", async () => {
    const agent = createFakeAgent();
    const adapter = createOpenResponsesAdapter({
      agent,
      toolPolicySupport: "middleware",
    });

    await adapter.invoke({
      ...createBaseRequest(),
      tools: [lookupFactTool],
      tool_choice: {
        type: "allowed_tools",
        tools: [{ type: "function", name: "lookup_fact" }],
      },
    });

    expect(agent.__getLastInvokeConfig()).toMatchObject({
      configurable: {
        [OPENRESPONSES_TOOL_POLICY_CONFIG_KEY]: {
          allowedToolNames: ["lookup_fact"],
          parallelToolCalls: true,
          toolChoice: {
            type: "allowed_tools",
            tools: [{ type: "function", name: "lookup_fact" }],
            mode: "auto",
          },
        },
      },
    });
  });

  test("fails closed when required tool execution does not occur", async () => {
    const agent = createFakeAgent({
      responses: [{ type: "ai", id: "ai-1", content: "No tool call happened." }],
    });
    const adapter = createOpenResponsesAdapter({ agent });

    await expect(
      adapter.invoke({
        ...createBaseRequest(),
        tools: [lookupFactTool],
        tool_choice: "required",
      })
    ).rejects.toMatchObject({
      code: "agent_execution_failed",
      message:
        "tool_choice requires a tool call, but the agent completed without calling a tool",
    });
  });

  test("accepts required tool execution when the result transcript includes a tool call", async () => {
    const agent = createFakeAgent({
      responses: [
        [
          {
            type: "ai",
            id: "ai-call",
            content: "",
            tool_calls: [
              {
                id: "tool-call-1",
                name: "lookup_fact",
                args: { topic: "road" },
              },
            ],
          },
          {
            type: "tool",
            id: "tool-result-1",
            content: '{"result":"because tests do that"}',
            tool_call_id: "tool-call-1",
          },
          {
            type: "ai",
            id: "ai-final",
            content: "Done.",
          },
        ],
      ],
    });
    const adapter = createOpenResponsesAdapter({ agent });

    const response = await adapter.invoke({
      ...createBaseRequest(),
      tools: [lookupFactTool],
      tool_choice: "required",
    });

    expect(response.status).toBe("completed");
  });

  test("fails closed for allowed_tools mode none in metadata-only mode", async () => {
    const agent = createFakeAgent();
    const adapter = createOpenResponsesAdapter({ agent });

    await expect(
      adapter.invoke({
        ...createBaseRequest(),
        tools: [lookupFactTool],
        tool_choice: {
          type: "allowed_tools",
          tools: [{ type: "function", name: "lookup_fact" }],
          mode: "none",
        },
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      message:
        "This tool policy requires createOpenResponsesToolPolicyMiddleware() and toolPolicySupport: 'middleware'",
    });
  });

  test("fails closed for parallel_tool_calls false in metadata-only mode", async () => {
    const agent = createFakeAgent();
    const adapter = createOpenResponsesAdapter({ agent });

    await expect(
      adapter.invoke({
        ...createBaseRequest(),
        tools: [lookupFactTool],
        parallel_tool_calls: false,
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      message:
        "This tool policy requires createOpenResponsesToolPolicyMiddleware() and toolPolicySupport: 'middleware'",
    });
  });

  test("fails when a specific required tool is not the one that was called", async () => {
    const agent = createFakeAgent({
      responses: [
        [
          {
            type: "ai",
            id: "ai-call",
            content: "",
            tool_calls: [
              {
                id: "tool-call-1",
                name: "get_weather",
                args: { city: "Boston" },
              },
            ],
          },
          {
            type: "tool",
            id: "tool-result-1",
            content: '{"temperature":"55F"}',
            tool_call_id: "tool-call-1",
          },
          {
            type: "ai",
            id: "ai-final",
            content: "Done.",
          },
        ],
      ],
    });
    const adapter = createOpenResponsesAdapter({
      agent,
      toolPolicySupport: "middleware",
    });

    await expect(
      adapter.invoke({
        ...createBaseRequest(),
        tools: [lookupFactTool, getWeatherTool],
        tool_choice: {
          type: "function",
          name: "lookup_fact",
        },
      })
    ).rejects.toMatchObject({
      code: "agent_execution_failed",
      message:
        "tool_choice requires tool 'lookup_fact', but the agent called a different tool",
    });
  });

  test("fails when allowed_tools mode required does not call a tool from the allowed set", async () => {
    const agent = createFakeAgent({
      responses: [
        [
          {
            type: "ai",
            id: "ai-call",
            content: "",
            tool_calls: [
              {
                id: "tool-call-1",
                name: "get_weather",
                args: { city: "Boston" },
              },
            ],
          },
          {
            type: "tool",
            id: "tool-result-1",
            content: '{"temperature":"55F"}',
            tool_call_id: "tool-call-1",
          },
          {
            type: "ai",
            id: "ai-final",
            content: "Done.",
          },
        ],
      ],
    });
    const adapter = createOpenResponsesAdapter({
      agent,
      toolPolicySupport: "middleware",
    });

    await expect(
      adapter.invoke({
        ...createBaseRequest(),
        tools: [lookupFactTool, getWeatherTool],
        tool_choice: {
          type: "allowed_tools",
          tools: [{ type: "function", name: "lookup_fact" }],
          mode: "required",
        },
      })
    ).rejects.toMatchObject({
      code: "agent_execution_failed",
      message:
        "tool_choice requires a tool from the allowed set, but the agent completed without calling one",
    });
  });
});
