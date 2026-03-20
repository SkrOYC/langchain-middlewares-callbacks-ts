import { describe, expect, test } from "bun:test";
import type { OpenResponsesEvent } from "@/core/schemas.js";
import type {
  LangChainMessageLike,
  OpenResponsesCompatibleAgent,
  PreviousResponseStore,
} from "@/core/types.js";
import { OPENRESPONSES_REQUEST_CONTEXT_CONFIG_KEY } from "@/core/types.js";
import {
  buildOpenResponsesApp,
  createOpenResponsesAdapter,
  createOpenResponsesHandler,
} from "@/server/index.js";
import { createFakeAgent } from "@/testing/fake-agent.js";
import {
  createDeterministicClock,
  createInMemoryPreviousResponseStore,
  createSequentialIdGenerator,
} from "@/testing/index.js";

type StreamCallback = (
  input: { messages: LangChainMessageLike[] },
  config: Record<string, unknown>
) => Iterable<unknown>;

type BridgeHandler = Record<string, (...args: unknown[]) => void>;

/**
 * Wraps a sync Iterable as an AsyncIterable.
 */
const toAsyncIterable = (
  iterable: Iterable<unknown>
): AsyncIterable<unknown> => {
  const iterator = iterable[Symbol.iterator]();
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return Promise.resolve(iterator.next());
        },
      };
    },
  };
};

/**
 * Creates a test agent that fires LangChain callbacks during stream().
 */
const createCallbackDrivenAgent = (params: {
  onStream: StreamCallback;
}): OpenResponsesCompatibleAgent => ({
  invoke(input) {
    return Promise.resolve({ messages: [...input.messages] });
  },
  stream(input, config) {
    return toAsyncIterable(params.onStream(input, config ?? {}));
  },
});

const extractBridge = (config: Record<string, unknown>): BridgeHandler => {
  const callbacks = (config.callbacks ?? []) as Record<string, unknown>[];
  return callbacks[0] as BridgeHandler;
};

const extractRunId = (config: Record<string, unknown>): string => {
  return (
    ((config.configurable as Record<string, unknown>)?.run_id as string) ??
    "run-1"
  );
};

/**
 * Fires text-generation callbacks on the bridge handlers.
 */
function* simulateTextStream(
  _input: { messages: LangChainMessageLike[] },
  config: Record<string, unknown>
): Iterable<unknown> {
  const bridge = extractBridge(config);
  const runId = extractRunId(config);

  bridge.handleChatModelStart?.({}, [[]], runId, undefined);
  yield { type: "chunk", content: "" };

  bridge.handleLLMNewToken?.("Hello", undefined, runId);
  yield { type: "chunk", content: "Hello" };

  bridge.handleLLMNewToken?.(" world", undefined, runId);
  yield { type: "chunk", content: " world" };

  bridge.handleLLMEnd?.({ generations: [] }, runId);
  yield { type: "chunk", content: "" };

  bridge.handleAgentEnd?.({}, runId);
}

/**
 * Fires callbacks that fail mid-stream.
 */
function* simulateFailureStream(
  _input: { messages: LangChainMessageLike[] },
  config: Record<string, unknown>
): Iterable<unknown> {
  const bridge = extractBridge(config);
  const runId = extractRunId(config);

  bridge.handleChatModelStart?.({}, [[]], runId, undefined);
  yield { type: "chunk", content: "" };

  bridge.handleLLMNewToken?.("Hi", undefined, runId);
  yield { type: "chunk", content: "Hi" };

  throw new Error("model crashed");
}

function* simulateToolCallStream(
  _input: { messages: LangChainMessageLike[] },
  config: Record<string, unknown>
): Iterable<unknown> {
  const bridge = extractBridge(config);
  const runId = extractRunId(config);

  bridge.handleChatModelStart?.({}, [[]], runId, undefined);
  yield { type: "chunk", content: "" };

  bridge.handleAgentAction?.(
    {
      tool: "get_weather",
      toolInput: { city: "Boston" },
      toolCallId: "call-1",
    },
    runId
  );
  yield { type: "chunk", content: "" };

  bridge.handleToolStart?.(
    {},
    '{"city":"Boston"}',
    "tool-run-1",
    runId,
    undefined,
    undefined,
    "get_weather",
    "call-1"
  );
  yield { type: "chunk", content: "" };

  bridge.handleToolEnd?.({ temperature: "55F" }, "tool-run-1", runId);
  yield { type: "chunk", content: "" };

  bridge.handleAgentEnd?.({}, runId);
}

function* simulateMultiRunToolStream(
  _input: { messages: LangChainMessageLike[] },
  config: Record<string, unknown>
): Iterable<unknown> {
  const bridge = extractBridge(config);
  const agentRunId = extractRunId(config);
  const llmRunId = "llm-run-1";

  bridge.handleChatModelStart?.({}, [[]], llmRunId, agentRunId);
  yield { type: "chunk", content: "" };

  bridge.handleLLMNewToken?.("Plan:", undefined, llmRunId);
  yield { type: "chunk", content: "Plan:" };

  bridge.handleLLMEnd?.({ generations: [] }, llmRunId);
  yield { type: "chunk", content: "" };

  bridge.handleAgentAction?.(
    {
      tool: "get_weather",
      toolInput: { city: "Boston" },
      toolCallId: "call-1",
    },
    agentRunId
  );
  yield { type: "chunk", content: "" };

  bridge.handleToolStart?.(
    {},
    '{"city":"Boston"}',
    "tool-run-1",
    agentRunId,
    undefined,
    undefined,
    "get_weather",
    "call-1"
  );
  yield { type: "chunk", content: "" };

  bridge.handleToolEnd?.({ temperature: "55F" }, "tool-run-1", agentRunId);
  yield { type: "chunk", content: "" };

  bridge.handleAgentEnd?.({}, agentRunId);
}

const collectStream = async (
  stream: AsyncIterable<OpenResponsesEvent | "[DONE]">
): Promise<(OpenResponsesEvent | "[DONE]")[]> => {
  const events: (OpenResponsesEvent | "[DONE]")[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

const extractResponseId = (
  events: (OpenResponsesEvent | "[DONE]")[]
): string => {
  const firstEvent = events[0];
  if (
    !firstEvent ||
    typeof firstEvent === "string" ||
    firstEvent.type !== "response.in_progress"
  ) {
    throw new Error("Expected first stream event to be response.in_progress");
  }

  return firstEvent.response.id;
};

const createDelayedStore = (params: {
  loadDelayMs?: number;
  saveDelayMs?: number;
}): PreviousResponseStore => {
  return {
    async load(): Promise<null> {
      if (params.loadDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, params.loadDelayMs));
      }
      return null;
    },
    async save(): Promise<void> {
      if (params.saveDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, params.saveDelayMs));
      }
    },
  };
};

const createFailingSaveStore = (): PreviousResponseStore => {
  return {
    load(): Promise<null> {
      return Promise.resolve(null);
    },
    save(): Promise<void> {
      throw new Error("save exploded");
    },
  };
};

const createHandlerContext = (params: {
  body: unknown;
  jsonDelayMs?: number;
  vars?: Record<string, unknown>;
}) => {
  const rawRequest = {
    signal: new AbortController().signal,
    json: async () => {
      if (params.jsonDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, params.jsonDelayMs));
      }
      return params.body;
    },
  } as unknown as Request;

  return {
    req: {
      header(name: string) {
        return name.toLowerCase() === "content-type"
          ? "application/json"
          : undefined;
      },
      raw: rawRequest,
    },
    json(payload: unknown) {
      return Response.json(payload);
    },
    var: params.vars ?? {},
  } as {
    req: {
      header(name: string): string | undefined;
      raw: Request;
    };
    json(payload: unknown): Response;
    var: Record<string, unknown>;
  };
};

const baseRequest = {
  model: "test-model",
  input: "Hello",
  tools: [],
  parallel_tool_calls: true,
  stream: true,
  metadata: {},
};

describe("adapter.stream()", () => {
  test("basic text streaming produces correct event sequence", async () => {
    const agent = createCallbackDrivenAgent({
      onStream: simulateTextStream,
    });

    const adapter = createOpenResponsesAdapter({
      agent,
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator([
        "resp-1",
        "msg-1",
        "extra-1",
        "extra-2",
      ]),
    });

    const stream = await adapter.stream(baseRequest);
    const events = await collectStream(stream);

    const types = events.map((e) => (typeof e === "string" ? e : e.type));
    expect(types).toEqual([
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.completed",
      "[DONE]",
    ]);

    // Verify sequence numbers are strictly incrementing 1..9
    const seqNums = events
      .filter((e): e is OpenResponsesEvent => typeof e !== "string")
      .map((e) => e.sequence_number);
    expect(seqNums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // Verify response ID is consistent
    const inProgressEvent = events[0] as OpenResponsesEvent & {
      response: { id: string };
    };
    expect(inProgressEvent.response.id).toBe("resp-1");
  });

  test("agent failure mid-stream produces response.failed + [DONE]", async () => {
    const agent = createCallbackDrivenAgent({
      onStream: simulateFailureStream,
    });

    const adapter = createOpenResponsesAdapter({
      agent,
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator(["resp-1", "msg-1", "extra-1"]),
    });

    const stream = await adapter.stream(baseRequest);
    const events = await collectStream(stream);

    const types = events.map((e) => (typeof e === "string" ? e : e.type));

    expect(types).toContain("response.in_progress");
    expect(types).toContain("response.output_text.delta");
    expect(types).toContain("response.failed");
    expect(types.at(-1)).toBe("[DONE]");

    // Verify no response.completed
    expect(types).not.toContain("response.completed");
  });

  test("agent throws before yielding produces response.failed + [DONE]", async () => {
    const throwOnStream: StreamCallback = () => {
      // Return an iterable that throws on first next()
      return {
        [Symbol.iterator]() {
          return {
            next(): IteratorResult<unknown> {
              throw new Error("init failed");
            },
          };
        },
      };
    };

    const agent = createCallbackDrivenAgent({ onStream: throwOnStream });

    const adapter = createOpenResponsesAdapter({
      agent,
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator(["resp-1"]),
    });

    const stream = await adapter.stream(baseRequest);
    const events = await collectStream(stream);

    const types = events.map((e) => (typeof e === "string" ? e : e.type));
    expect(types).toContain("response.failed");
    expect(types.at(-1)).toBe("[DONE]");
  });

  test("pre-stream validation error rejects the promise", async () => {
    const agent = createCallbackDrivenAgent({
      onStream: simulateTextStream,
    });

    const adapter = createOpenResponsesAdapter({
      agent,
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator(["resp-1"]),
    });

    const request = {
      model: "test-model",
      input: "Hello",
      tools: [],
      parallel_tool_calls: true,
      stream: true,
      metadata: {},
      previous_response_id: "non-existent-id",
    };

    await expect(adapter.stream(request)).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  test("previous response load timeout rejects before streaming starts", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createCallbackDrivenAgent({ onStream: simulateTextStream }),
      previousResponseStore: createDelayedStore({ loadDelayMs: 30 }),
      timeoutBudgets: { previousResponseLoadMs: 10 },
    });

    await expect(
      adapter.stream({
        ...baseRequest,
        previous_response_id: "resp-prev",
      })
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "Previous response load timed out after 10ms",
    });
  });

  test("agent execution timeout after stream start emits response.failed then [DONE]", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createFakeAgent({
        streamChunks: [{ type: "chunk", content: "late" }],
        delay: 30,
      }),
      timeoutBudgets: { agentExecutionMs: 10 },
    });

    const stream = await adapter.stream(baseRequest);
    const events = await collectStream(stream);

    expect(
      events.map((event) => (typeof event === "string" ? event : event.type))
    ).toEqual(["response.failed", "[DONE]"]);
  });

  test("streaming completion persists a response record for continuation", async () => {
    const previousResponseStore = createInMemoryPreviousResponseStore();
    const adapter = createOpenResponsesAdapter({
      agent: createCallbackDrivenAgent({
        onStream: simulateTextStream,
      }),
      previousResponseStore,
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator([
        "resp-1",
        "msg-1",
        "extra-1",
        "extra-2",
      ]),
    });

    const stream = await adapter.stream(baseRequest);
    const events = await collectStream(stream);
    const stored = await previousResponseStore.load(extractResponseId(events));
    expect(stored).toBeTruthy();
    expect(stored?.response.status).toBe("completed");
    expect(stored?.response.output).toEqual([
      {
        id: "msg-1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "Hello world",
            annotations: [],
          },
        ],
      },
    ]);
  });

  test("streaming failure persists a failed response record for continuation", async () => {
    const previousResponseStore = createInMemoryPreviousResponseStore();
    const adapter = createOpenResponsesAdapter({
      agent: createCallbackDrivenAgent({
        onStream: simulateFailureStream,
      }),
      previousResponseStore,
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator(["resp-1", "msg-1", "extra-1"]),
    });

    const stream = await adapter.stream(baseRequest);
    const events = await collectStream(stream);
    const stored = await previousResponseStore.load(extractResponseId(events));
    expect(stored).toBeTruthy();
    expect(stored?.response.status).toBe("failed");
    expect(stored?.response.error).toMatchObject({
      code: "agent_execution_failed",
    });
  });

  test("streaming best-effort save mode swallows persistence failures", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createCallbackDrivenAgent({
        onStream: simulateTextStream,
      }),
      previousResponseStore: createFailingSaveStore(),
      previousResponseSaveMode: "best_effort",
    });

    const stream = await adapter.stream(baseRequest);
    const events = await collectStream(stream);
    expect(events.at(-1)).toBe("[DONE]");
  });

  test("streaming persistence stores replay tool items separately from response output", async () => {
    const previousResponseStore = createInMemoryPreviousResponseStore();
    const adapter = createOpenResponsesAdapter({
      agent: createCallbackDrivenAgent({
        onStream: simulateToolCallStream,
      }),
      previousResponseStore,
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator(["resp-1", "fc-1", "extra-1"]),
    });

    const stream = await adapter.stream(baseRequest);
    const events = await collectStream(stream);
    const stored = await previousResponseStore.load(extractResponseId(events));

    expect(stored?.request.input).toEqual([
      {
        type: "message",
        role: "user",
        content: "Hello",
      },
      {
        type: "function_call",
        call_id: "call-1",
        name: "get_weather",
        arguments: '{"city":"Boston"}',
        status: "completed",
      },
      {
        type: "function_call_output",
        call_id: "call-1",
        output: '{"temperature":"55F"}',
        status: "completed",
      },
    ]);
    expect(stored?.response.output).toEqual([]);
  });

  test("multi-run callback sequences do not complete the response on sub-run completion", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createCallbackDrivenAgent({
        onStream: simulateMultiRunToolStream,
      }),
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator([
        "resp-1",
        "msg-1",
        "fc-1",
        "extra-1",
      ]),
    });

    const stream = await adapter.stream(baseRequest);
    const events = await collectStream(stream);
    const types = events.map((event) =>
      typeof event === "string" ? event : event.type
    );

    expect(types).toEqual([
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.output_item.added",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
      "[DONE]",
    ]);

    expect(types.filter((type) => type === "response.completed")).toHaveLength(
      1
    );
  });
});

describe("adapter.invoke() budgets", () => {
  test("agent execution timeout fails invoke", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createFakeAgent({ delay: 30 }),
      timeoutBudgets: { agentExecutionMs: 10 },
    });

    await expect(
      adapter.invoke({
        ...baseRequest,
        stream: false,
      })
    ).rejects.toMatchObject({
      code: "agent_execution_failed",
      message: "Agent execution timed out after 10ms",
    });
  });

  test("strict previous response save timeout fails invoke", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createFakeAgent(),
      previousResponseStore: createDelayedStore({ saveDelayMs: 30 }),
      timeoutBudgets: { previousResponseSaveMs: 10 },
    });

    await expect(
      adapter.invoke({
        ...baseRequest,
        stream: false,
      })
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "Previous response save timed out after 10ms",
    });
  });

  test("best-effort previous response save timeout preserves invoke response", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createFakeAgent(),
      previousResponseStore: createDelayedStore({ saveDelayMs: 30 }),
      timeoutBudgets: { previousResponseSaveMs: 10 },
      previousResponseSaveMode: "best_effort",
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator(["resp-1", "msg-1"]),
    });

    const response = await adapter.invoke({
      ...baseRequest,
      stream: false,
    });

    expect(response.id).toBe("resp-1");
    expect(response.status).toBe("completed");
  });
});

describe("Hono streaming route", () => {
  test("returns SSE frames for streaming requests", async () => {
    const app = await buildOpenResponsesApp({
      agent: createCallbackDrivenAgent({ onStream: simulateTextStream }),
      clock: createDeterministicClock(1000),
      generateId: createSequentialIdGenerator([
        "resp-1",
        "msg-1",
        "extra-1",
        "extra-2",
      ]),
    });

    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(baseRequest),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const body = await response.text();
    expect(body).toContain("event: response.in_progress");
    expect(body).toContain("event: response.completed");
    expect(body).toContain("data: [DONE]");
  });

  test("returns JSON errors before stream start when validation fails", async () => {
    const app = await buildOpenResponsesApp({
      agent: createCallbackDrivenAgent({ onStream: simulateTextStream }),
    });

    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...baseRequest,
        previous_response_id: "missing-response",
      }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
    });
  });

  test("request validation timeout returns JSON error response", async () => {
    const handler = createOpenResponsesHandler({
      agent: createFakeAgent(),
      timeoutBudgets: { requestValidationMs: 10 },
    });

    const response = await handler(
      createHandlerContext({
        body: {
          model: "test-model",
          input: "Hello",
        },
        jsonDelayMs: 30,
      }) as never
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "internal_error",
        message: "Request validation timed out after 10ms",
      },
    });
  });

  test("propagates opaque request context into agent config without serializing it", async () => {
    const agent = createFakeAgent();
    const handler = createOpenResponsesHandler({
      agent,
      getRequestContext: (c) => ({
        principalId: String(
          (c as { var: Record<string, unknown> }).var.principalId
        ),
        traceId: String((c as { var: Record<string, unknown> }).var.traceId),
      }),
    });

    const response = await handler(
      createHandlerContext({
        body: {
          model: "test-model",
          input: "Hello",
        },
        vars: {
          principalId: "user-123",
          traceId: "trace-456",
        },
      }) as never
    );

    expect(response.status).toBe(200);
    expect(agent.__getLastInvokeConfig()).toMatchObject({
      configurable: {
        [OPENRESPONSES_REQUEST_CONTEXT_CONFIG_KEY]: {
          principalId: "user-123",
          traceId: "trace-456",
        },
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      metadata: {},
    });
  });
});
