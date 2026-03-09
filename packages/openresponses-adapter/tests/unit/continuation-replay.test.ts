import { describe, expect, test } from "bun:test";
import type {
  PreviousResponseStore,
  StoredResponseRecord,
} from "@/core/types.js";
import {
  buildOpenResponsesApp,
  createOpenResponsesAdapter,
} from "@/server/index.js";
import {
  createFakeAgent,
  createInMemoryPreviousResponseStore,
} from "@/testing/index.js";

const createPriorRecord = (): StoredResponseRecord => {
  return {
    response_id: "resp-prev",
    created_at: 1000,
    completed_at: 2000,
    model: "gpt-4.1-mini",
    request: {
      model: "gpt-4.1-mini",
      input: [
        {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: "Be terse." }],
        },
        {
          type: "message",
          role: "user",
          content: "Tell me a joke",
        },
      ],
      metadata: {},
      tools: [],
      parallel_tool_calls: true,
    },
    response: {
      id: "resp-prev",
      object: "response",
      created_at: 1000,
      completed_at: 2000,
      status: "completed",
      model: "gpt-4.1-mini",
      previous_response_id: null,
      output: [
        {
          id: "msg-prev",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "Why did the test cross the road?",
              annotations: [],
            },
          ],
        },
        {
          id: "fc-prev",
          type: "function_call",
          status: "completed",
          name: "lookup_fact",
          call_id: "call-1",
          arguments: '{"topic":"road"}',
        },
      ],
      error: null,
      metadata: {},
    },
    status: "completed",
    error: null,
  };
};

const createMalformedStore = (): PreviousResponseStore => {
  return {
    load(): Promise<StoredResponseRecord> {
      return Promise.resolve({
        ...createPriorRecord(),
        response_id: "drifted-id",
      });
    },
    save(): Promise<void> {
      return Promise.resolve();
    },
  };
};
const createLoadFailingStore = (): PreviousResponseStore => {
  return {
    load(): Promise<StoredResponseRecord | null> {
      return Promise.reject(new Error("store load failed"));
    },
    save(): Promise<void> {
      return Promise.resolve();
    },
  };
};

const createSaveFailingStore = (): PreviousResponseStore => {
  return {
    load(): Promise<StoredResponseRecord | null> {
      return Promise.resolve(null);
    },
    save(): Promise<void> {
      return Promise.reject(new Error("store save failed"));
    },
  };
};

describe("continuation replay", () => {
  test("replays prior input, prior output, then new input in exact order", async () => {
    const store = createInMemoryPreviousResponseStore();
    await store.save(createPriorRecord());

    const agent = createFakeAgent({
      responses: [{ type: "ai", id: "ai-1", content: "Done" }],
    });
    const adapter = createOpenResponsesAdapter({
      agent,
      previousResponseStore: store,
      clock: (() => {
        let now = 3000;
        return () => now++;
      })(),
      generateId: (() => {
        let counter = 0;
        return () => `generated-${++counter}`;
      })(),
    });

    const response = await adapter.invoke({
      model: "gpt-4.1-mini",
      previous_response_id: "resp-prev",
      input: [
        {
          type: "message",
          role: "user",
          content: "Explain why it is funny.",
        },
      ],
      metadata: {},
      tools: [],
      parallel_tool_calls: true,
      stream: false,
    });

    const invokeInput = agent.__getLastInvokeInput();
    expect(response.previous_response_id).toBe("resp-prev");
    expect(invokeInput?.messages).toEqual([
      {
        type: "system",
        role: "system",
        content: [{ type: "input_text", text: "Be terse." }],
      },
      {
        type: "human",
        role: "user",
        content: "Tell me a joke",
      },
      {
        type: "ai",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Why did the test cross the road?",
            annotations: [],
          },
        ],
      },
      {
        type: "ai",
        role: "assistant",
        content: [],
        tool_calls: [
          {
            id: "call-1",
            type: "tool_call",
            name: "lookup_fact",
            args: { topic: "road" },
          },
        ],
      },
      {
        type: "human",
        role: "user",
        content: "Explain why it is funny.",
      },
    ]);
  });

  test("maps tool-call history input items to LangChain-compatible messages", async () => {
    const agent = createFakeAgent();
    const adapter = createOpenResponsesAdapter({ agent });

    await adapter.invoke({
      model: "gpt-4.1-mini",
      input: [
        {
          type: "function_call",
          call_id: "call-1",
          name: "lookup_fact",
          arguments: '{"topic":"road"}',
        },
        {
          type: "function_call_output",
          call_id: "call-1",
          output: '{"result":"because tests do that"}',
        },
        {
          type: "message",
          role: "user",
          content: "Continue.",
        },
      ],
      metadata: {},
      tools: [],
      parallel_tool_calls: true,
      stream: false,
    });

    expect(agent.__getLastInvokeInput()?.messages).toEqual([
      {
        type: "ai",
        role: "assistant",
        content: [],
        tool_calls: [
          {
            id: "call-1",
            type: "tool_call",
            name: "lookup_fact",
            args: { topic: "road" },
          },
        ],
      },
      {
        type: "tool",
        role: "tool",
        tool_call_id: "call-1",
        content: '{"result":"because tests do that"}',
      },
      {
        type: "human",
        role: "user",
        content: "Continue.",
      },
    ]);
  });

  test("persists normalized request input and canonical final response after invoke", async () => {
    const store = createInMemoryPreviousResponseStore();
    const agent = createFakeAgent({
      responses: [{ type: "ai", id: "ai-1", content: "Hello back" }],
    });
    const adapter = createOpenResponsesAdapter({
      agent,
      previousResponseStore: store,
      clock: (() => {
        let now = 5000;
        return () => now++;
      })(),
      generateId: (() => {
        let counter = 0;
        return () => `resp-${++counter}`;
      })(),
    });

    const response = await adapter.invoke({
      model: "gpt-4.1-mini",
      input: "Hello",
      metadata: { source: "unit" },
      tools: [],
      parallel_tool_calls: true,
      stream: false,
    });

    const stored = await store.load(response.id);
    expect(stored).not.toBeNull();
    expect(stored?.request.input).toEqual([
      {
        type: "message",
        role: "user",
        content: "Hello",
      },
    ]);
    expect(stored?.response).toEqual(response);
    expect(stored?.response_id).toBe(response.id);
    expect(stored?.status).toBe("completed");
  });

  test("materializes output from LangChain-style state messages including tool calls", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createFakeAgent({
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
              content: "Because it is a testing pun.",
            },
          ],
        ],
      }),
      generateId: (() => {
        let counter = 0;
        return () => `resp-tool-${++counter}`;
      })(),
    });

    const response = await adapter.invoke({
      model: "gpt-4.1-mini",
      input: "Tell me a joke",
      metadata: {},
      tools: [],
      parallel_tool_calls: true,
      stream: false,
    });

    expect(response.output).toEqual([
      {
        id: "tool-call-1",
        type: "function_call",
        status: "completed",
        name: "lookup_fact",
        call_id: "tool-call-1",
        arguments: '{"topic":"road"}',
      },
      {
        id: "ai-final",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "Because it is a testing pun.",
            annotations: [],
          },
        ],
      },
    ]);
  });

  test("persists replayed transcript for later continuation hops", async () => {
    const store = createInMemoryPreviousResponseStore();
    await store.save(createPriorRecord());

    const agent = createFakeAgent({
      responses: [
        { type: "ai", id: "ai-2", content: "Second answer" },
        { type: "ai", id: "ai-3", content: "Third answer" },
      ],
    });
    const adapter = createOpenResponsesAdapter({
      agent,
      previousResponseStore: store,
      clock: (() => {
        let now = 7000;
        return () => now++;
      })(),
      generateId: (() => {
        let counter = 0;
        return () => `resp-hop-${++counter}`;
      })(),
    });

    const secondResponse = await adapter.invoke({
      model: "gpt-4.1-mini",
      previous_response_id: "resp-prev",
      input: "Why is that funny?",
      metadata: {},
      tools: [],
      parallel_tool_calls: true,
      stream: false,
    });

    const storedSecond = await store.load(secondResponse.id);
    expect(storedSecond?.request.input).toEqual([
      {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: "Be terse." }],
      },
      {
        type: "message",
        role: "user",
        content: "Tell me a joke",
      },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Why did the test cross the road?",
            annotations: [],
          },
        ],
      },
      {
        type: "function_call",
        call_id: "call-1",
        name: "lookup_fact",
        arguments: '{"topic":"road"}',
        status: "completed",
      },
      {
        type: "message",
        role: "user",
        content: "Why is that funny?",
      },
    ]);

    await adapter.invoke({
      model: "gpt-4.1-mini",
      previous_response_id: secondResponse.id,
      input: "Explain it again.",
      metadata: {},
      tools: [],
      parallel_tool_calls: true,
      stream: false,
    });

    expect(agent.__getLastInvokeInput()?.messages).toEqual([
      {
        type: "system",
        role: "system",
        content: [{ type: "input_text", text: "Be terse." }],
      },
      {
        type: "human",
        role: "user",
        content: "Tell me a joke",
      },
      {
        type: "ai",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Why did the test cross the road?",
            annotations: [],
          },
        ],
      },
      {
        type: "ai",
        role: "assistant",
        content: [],
        tool_calls: [
          {
            id: "call-1",
            type: "tool_call",
            name: "lookup_fact",
            args: { topic: "road" },
          },
        ],
      },
      {
        type: "human",
        role: "user",
        content: "Why is that funny?",
      },
      {
        type: "ai",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Second answer",
            annotations: [],
          },
        ],
      },
      {
        type: "human",
        role: "user",
        content: "Explain it again.",
      },
    ]);
  });

  test("returns previous_response_not_found for unknown prior records", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createFakeAgent(),
      previousResponseStore: createInMemoryPreviousResponseStore(),
    });

    await expect(
      adapter.invoke({
        model: "gpt-4.1-mini",
        previous_response_id: "missing",
        input: "Next",
        metadata: {},
        tools: [],
        parallel_tool_calls: true,
        stream: false,
      })
    ).rejects.toMatchObject({ code: "previous_response_not_found" });
  });

  test("returns previous_response_unusable for malformed prior records", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createFakeAgent(),
      previousResponseStore: createMalformedStore(),
    });

    await expect(
      adapter.invoke({
        model: "gpt-4.1-mini",
        previous_response_id: "resp-prev",
        input: "Next",
        metadata: {},
        tools: [],
        parallel_tool_calls: true,
        stream: false,
      })
    ).rejects.toMatchObject({ code: "previous_response_unusable" });
  });

  test("classifies previous-response store load failures as internal errors", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createFakeAgent(),
      previousResponseStore: createLoadFailingStore(),
    });

    await expect(
      adapter.invoke({
        model: "gpt-4.1-mini",
        previous_response_id: "resp-prev",
        input: "Next",
        metadata: {},
        tools: [],
        parallel_tool_calls: true,
        stream: false,
      })
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to load previous response",
    });
  });

  test("classifies previous-response store save failures as internal errors", async () => {
    const adapter = createOpenResponsesAdapter({
      agent: createFakeAgent(),
      previousResponseStore: createSaveFailingStore(),
    });

    await expect(
      adapter.invoke({
        model: "gpt-4.1-mini",
        input: "Next",
        metadata: {},
        tools: [],
        parallel_tool_calls: true,
        stream: false,
      })
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to save previous response",
    });
  });

  test("uses onError to map public error responses", async () => {
    const app = await buildOpenResponsesApp({
      agent: createFakeAgent({ invokeError: new Error("agent exploded") }),
      onError: () => ({
        code: "custom_error",
        message: "custom mapped error",
        type: "server_error",
      }),
    });

    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: "Hello",
      }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "custom_error",
        message: "custom mapped error",
        type: "server_error",
      },
    });
  });

  test("maps missing store, missing record, and unusable record to HTTP errors", async () => {
    const appWithoutStore = await buildOpenResponsesApp({
      agent: createFakeAgent(),
    });
    const missingStoreResponse = await appWithoutStore.request(
      "/v1/responses",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          previous_response_id: "resp-prev",
          input: "Next",
        }),
      }
    );
    expect(missingStoreResponse.status).toBe(400);
    expect(await missingStoreResponse.json()).toEqual({
      error: {
        code: "invalid_request",
        message:
          "previous_response_id requires previousResponseStore to be configured",
        type: "invalid_request_error",
      },
    });

    const appWithMissingRecord = await buildOpenResponsesApp({
      agent: createFakeAgent(),
      previousResponseStore: createInMemoryPreviousResponseStore(),
    });
    const missingRecordResponse = await appWithMissingRecord.request(
      "/v1/responses",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          previous_response_id: "missing",
          input: "Next",
        }),
      }
    );
    expect(missingRecordResponse.status).toBe(404);
    await expect(missingRecordResponse.json()).resolves.toMatchObject({
      error: { code: "previous_response_not_found" },
    });

    const appWithMalformedStore = await buildOpenResponsesApp({
      agent: createFakeAgent(),
      previousResponseStore: createMalformedStore(),
    });
    const malformedRecordResponse = await appWithMalformedStore.request(
      "/v1/responses",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          previous_response_id: "resp-prev",
          input: "Next",
        }),
      }
    );
    expect(malformedRecordResponse.status).toBe(409);
    await expect(malformedRecordResponse.json()).resolves.toMatchObject({
      error: { code: "previous_response_unusable" },
    });
  });
});
