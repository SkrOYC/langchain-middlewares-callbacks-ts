import { describe, expect, test } from "bun:test";
import type { InternalSemanticEvent } from "@/core/events.js";
import type { OpenResponsesEvent } from "@/core/schemas.js";
import {
  createEventSerializer,
  createSequenceGenerator,
  formatSSEFrame,
  type SerializerContext,
  serializeInternalEvent,
  validateOutgoingEvent,
} from "@/server/event-serializer.js";
import { createAsyncEventQueue } from "@/state/async-event-queue.js";
import { createCanonicalItemAccumulator } from "@/state/item-accumulator.js";
import { createResponseLifecycle } from "@/state/response-lifecycle.js";
import {
  createDeterministicClock,
  createSequentialIdGenerator,
} from "@/testing/index.js";

const createRequestSnapshot = () => ({
  model: "test-model",
  input: [],
  previous_response_id: null,
  include: [],
  tools: [],
  tool_choice: "auto" as const,
  parallel_tool_calls: true,
  instructions: null,
  store: false,
  background: false,
  truncation: "disabled" as const,
  text: { format: { type: "text" as const }, verbosity: "medium" as const },
  reasoning: null,
  top_p: 1,
  presence_penalty: 0,
  frequency_penalty: 0,
  top_logprobs: 0,
  temperature: 1,
  max_output_tokens: null,
  max_tool_calls: null,
  service_tier: "default" as const,
  safety_identifier: null,
  prompt_cache_key: null,
  metadata: {},
  stream_options: null,
});

const createContext = (
  overrides: Partial<SerializerContext> = {}
): SerializerContext => {
  const generateId = createSequentialIdGenerator([
    "item-1",
    "item-2",
    "item-3",
    "item-4",
  ]);
  return {
    accumulator: createCanonicalItemAccumulator({ generateId }),
    sequence: createSequenceGenerator(),
    responseId: "resp-1",
    lifecycle: createResponseLifecycle({
      responseId: "resp-1",
      createdAt: 1000,
      clock: createDeterministicClock(2000),
    }),
    request: createRequestSnapshot(),
    inProgressEmitted: { value: false },
    itemOutputIndices: new Map(),
    ...overrides,
  };
};

const collectEvents = async (
  serializer: AsyncGenerator<OpenResponsesEvent | "[DONE]">
): Promise<(OpenResponsesEvent | "[DONE]")[]> => {
  const events: (OpenResponsesEvent | "[DONE]")[] = [];
  for await (const event of serializer) {
    events.push(event);
  }
  return events;
};

describe("createSequenceGenerator", () => {
  test("should start at 0 and increment by 1", () => {
    const seq = createSequenceGenerator();
    expect(seq.current()).toBe(0);
    expect(seq.next()).toBe(1);
    expect(seq.next()).toBe(2);
    expect(seq.current()).toBe(2);
    expect(seq.next()).toBe(3);
    expect(seq.current()).toBe(3);
  });
});

describe("serializeInternalEvent", () => {
  test("run.started emits response.in_progress on first call", () => {
    const context = createContext();
    const events = serializeInternalEvent(
      { type: "run.started", runId: "run-1" },
      context
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "response.in_progress",
      sequence_number: 1,
      response: { id: "resp-1", object: "response", status: "in_progress" },
    });
    expect(context.inProgressEmitted?.value).toBe(true);
    expect(context.lifecycle.getStatus()).toBe("in_progress");
  });

  test("run.started emits nothing on subsequent calls", () => {
    const context = createContext();
    serializeInternalEvent({ type: "run.started", runId: "resp-1" }, context);
    const events = serializeInternalEvent(
      { type: "run.started", runId: "run-2" },
      context
    );

    expect(events).toHaveLength(0);
  });

  test("message.started emits output_item.added + content_part.added", () => {
    const context = createContext();
    // First start the run
    serializeInternalEvent({ type: "run.started", runId: "run-1" }, context);

    const events = serializeInternalEvent(
      { type: "message.started", itemId: "msg-1", runId: "run-1" },
      context
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "response.output_item.added",
      sequence_number: 2,
      output_index: 0,
      item: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        status: "in_progress",
      },
    });
    expect(events[1]).toMatchObject({
      type: "response.content_part.added",
      sequence_number: 3,
      item_id: "msg-1",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
  });

  test("message.started emits response.in_progress first if not yet emitted", () => {
    const context = createContext();
    const events = serializeInternalEvent(
      { type: "message.started", itemId: "msg-1", runId: "run-1" },
      context
    );

    expect(events).toHaveLength(3);
    expect(events[0]?.type).toBe("response.in_progress");
    expect(events[1]?.type).toBe("response.output_item.added");
    expect(events[2]?.type).toBe("response.content_part.added");
  });

  test("text.delta emits output_text.delta", () => {
    const context = createContext();
    serializeInternalEvent({ type: "run.started", runId: "run-1" }, context);
    serializeInternalEvent(
      { type: "message.started", itemId: "msg-1", runId: "run-1" },
      context
    );

    const events = serializeInternalEvent(
      { type: "text.delta", itemId: "msg-1", delta: "Hello" },
      context
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "response.output_text.delta",
      item_id: "msg-1",
      output_index: 0,
      content_index: 0,
      delta: "Hello",
    });
  });

  test("text.delta throws for unknown item IDs instead of defaulting to output index 0", () => {
    const context = createContext();

    expect(() =>
      serializeInternalEvent(
        { type: "text.delta", itemId: "missing-item", delta: "Hello" },
        context
      )
    ).toThrow(
      'Invariant violation: received text.delta for unknown item ID "missing-item"'
    );
  });

  test("text.completed emits text.done + part.done + item.done in order", () => {
    const context = createContext();
    serializeInternalEvent({ type: "run.started", runId: "run-1" }, context);
    serializeInternalEvent(
      { type: "message.started", itemId: "msg-1", runId: "run-1" },
      context
    );
    serializeInternalEvent(
      { type: "text.delta", itemId: "msg-1", delta: "Hello world" },
      context
    );

    const events = serializeInternalEvent(
      { type: "text.completed", itemId: "msg-1" },
      context
    );

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: "response.output_text.done",
      item_id: "msg-1",
      text: "Hello world",
    });
    expect(events[1]).toMatchObject({
      type: "response.content_part.done",
      item_id: "msg-1",
      part: { type: "output_text", text: "Hello world", annotations: [] },
    });
    expect(events[2]).toMatchObject({
      type: "response.output_item.done",
      output_index: 0,
      item: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        status: "completed",
      },
    });
  });

  test("function_call.started emits output_item.added", () => {
    const context = createContext();
    serializeInternalEvent({ type: "run.started", runId: "run-1" }, context);

    const events = serializeInternalEvent(
      {
        type: "function_call.started",
        itemId: "fc-1",
        name: "get_weather",
        callId: "call-1",
      },
      context
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "response.output_item.added",
      output_index: 0,
      item: {
        id: "fc-1",
        type: "function_call",
        name: "get_weather",
        call_id: "call-1",
        status: "in_progress",
        arguments: "",
      },
    });
  });

  test("function_call_arguments.delta emits delta event", () => {
    const context = createContext();
    serializeInternalEvent({ type: "run.started", runId: "run-1" }, context);
    serializeInternalEvent(
      {
        type: "function_call.started",
        itemId: "fc-1",
        name: "get_weather",
        callId: "call-1",
      },
      context
    );

    const events = serializeInternalEvent(
      {
        type: "function_call_arguments.delta",
        itemId: "fc-1",
        delta: '{"city":',
      },
      context
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "response.function_call_arguments.delta",
      item_id: "fc-1",
      delta: '{"city":',
    });
  });

  test("function_call.completed emits args.done + item.done", () => {
    const context = createContext();
    serializeInternalEvent({ type: "run.started", runId: "run-1" }, context);
    serializeInternalEvent(
      {
        type: "function_call.started",
        itemId: "fc-1",
        name: "get_weather",
        callId: "call-1",
      },
      context
    );
    serializeInternalEvent(
      {
        type: "function_call_arguments.delta",
        itemId: "fc-1",
        delta: '{"city":"NYC"}',
      },
      context
    );

    const events = serializeInternalEvent(
      { type: "function_call.completed", itemId: "fc-1" },
      context
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "response.function_call_arguments.done",
      item_id: "fc-1",
      arguments: '{"city":"NYC"}',
    });
    expect(events[1]).toMatchObject({
      type: "response.output_item.done",
      item: {
        id: "fc-1",
        type: "function_call",
        status: "completed",
        name: "get_weather",
        arguments: '{"city":"NYC"}',
      },
    });
  });

  test("degraded fidelity: function_call.started with arguments, no deltas", () => {
    const context = createContext();
    serializeInternalEvent({ type: "run.started", runId: "run-1" }, context);
    serializeInternalEvent(
      {
        type: "function_call.started",
        itemId: "fc-1",
        name: "get_weather",
        callId: "call-1",
        arguments: '{"city":"NYC"}',
      },
      context
    );

    // No delta events — directly complete
    const events = serializeInternalEvent(
      { type: "function_call.completed", itemId: "fc-1" },
      context
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "response.function_call_arguments.done",
      arguments: '{"city":"NYC"}',
    });
    expect(events[1]).toMatchObject({
      type: "response.output_item.done",
      item: { arguments: '{"city":"NYC"}' },
    });
  });

  test("run.completed emits response.completed", () => {
    const context = createContext();
    serializeInternalEvent({ type: "run.started", runId: "resp-1" }, context);
    serializeInternalEvent(
      { type: "message.started", itemId: "msg-1", runId: "resp-1" },
      context
    );
    serializeInternalEvent(
      { type: "text.delta", itemId: "msg-1", delta: "Hi" },
      context
    );
    serializeInternalEvent(
      { type: "text.completed", itemId: "msg-1" },
      context
    );

    const events = serializeInternalEvent(
      { type: "run.completed", runId: "resp-1" },
      context
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "response.completed",
      response: { id: "resp-1", object: "response", status: "completed" },
    });
  });

  test("run.completed starts the lifecycle when no prior in-progress event was emitted", () => {
    const context = createContext();

    const events = serializeInternalEvent(
      { type: "run.completed", runId: "resp-1" },
      context
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "response.in_progress",
      response: { id: "resp-1", object: "response", status: "in_progress" },
    });
    expect(events[1]).toMatchObject({
      type: "response.completed",
      response: { id: "resp-1", object: "response", status: "completed" },
    });
    expect(context.lifecycle.getStatus()).toBe("completed");
  });

  test("run.completed from a sub-run does not complete the response lifecycle", () => {
    const context = createContext();
    serializeInternalEvent(
      { type: "message.started", itemId: "msg-1", runId: "llm-run-1" },
      context
    );

    const events = serializeInternalEvent(
      { type: "run.completed", runId: "llm-run-1" },
      context
    );

    expect(events).toEqual([]);
    expect(context.lifecycle.getStatus()).toBe("in_progress");
  });

  test("run.failed emits error then response.failed", () => {
    const context = createContext();
    serializeInternalEvent({ type: "run.started", runId: "run-1" }, context);

    const events = serializeInternalEvent(
      { type: "run.failed", runId: "resp-1", error: new Error("boom") },
      context
    );

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("error");
    if (events[0]?.type === "error") {
      expect(events[0].error).toMatchObject({
        type: "model_error",
        message: "boom",
      });
    }
    expect(events[1]?.type).toBe("response.failed");
    if (events[1]?.type === "response.failed") {
      expect(events[1].response.id).toBe("resp-1");
      expect(events[1].response.status).toBe("failed");
      expect(events[1].response.error).toMatchObject({
        type: "model_error",
        message: "boom",
      });
    }
  });

  test("run.failed emits response.in_progress first when no prior in-progress event was emitted", () => {
    const context = createContext();

    const events = serializeInternalEvent(
      { type: "run.failed", runId: "resp-1", error: new Error("boom") },
      context
    );

    expect(events.map((event) => event.type)).toEqual([
      "response.in_progress",
      "error",
      "response.failed",
    ]);
    expect(context.lifecycle.getStatus()).toBe("failed");
  });

  test("reasoning.completed emits summary-part events before output_item.done", () => {
    const context = createContext();
    serializeInternalEvent({ type: "run.started", runId: "run-1" }, context);
    serializeInternalEvent(
      { type: "reasoning.started", itemId: "reasoning-1", runId: "run-1" },
      context
    );
    serializeInternalEvent(
      {
        type: "reasoning.delta",
        itemId: "reasoning-1",
        delta: "Thinking step 1",
      },
      context
    );

    const events = serializeInternalEvent(
      {
        type: "reasoning.completed",
        itemId: "reasoning-1",
        summaryTexts: ["Short answer summary"],
      },
      context
    );

    expect(events.map((event) => event.type)).toEqual([
      "response.reasoning.done",
      "response.content_part.done",
      "response.reasoning_summary_part.added",
      "response.reasoning_summary_text.delta",
      "response.reasoning_summary_text.done",
      "response.reasoning_summary_part.done",
      "response.output_item.done",
    ]);
  });

  test("run.failed from a sub-run does not fail the response lifecycle", () => {
    const context = createContext();
    serializeInternalEvent(
      { type: "message.started", itemId: "msg-1", runId: "llm-run-1" },
      context
    );

    const events = serializeInternalEvent(
      { type: "run.failed", runId: "llm-run-1", error: new Error("boom") },
      context
    );

    expect(events).toEqual([]);
    expect(context.lifecycle.getStatus()).toBe("in_progress");
  });

  test("tool events return empty arrays", () => {
    const context = createContext();
    expect(
      serializeInternalEvent(
        { type: "tool.started", runId: "run-1", toolName: "foo", input: "{}" },
        context
      )
    ).toEqual([]);
    expect(
      serializeInternalEvent(
        { type: "tool.completed", runId: "run-1", output: "bar" },
        context
      )
    ).toEqual([]);
    expect(
      serializeInternalEvent(
        { type: "tool.error", runId: "run-1", error: new Error("err") },
        context
      )
    ).toEqual([]);
  });

  test("multiple items have incrementing output_index", () => {
    const context = createContext();
    serializeInternalEvent({ type: "run.started", runId: "run-1" }, context);

    // First message item
    serializeInternalEvent(
      { type: "message.started", itemId: "msg-1", runId: "run-1" },
      context
    );
    serializeInternalEvent(
      { type: "text.delta", itemId: "msg-1", delta: "A" },
      context
    );
    serializeInternalEvent(
      { type: "text.completed", itemId: "msg-1" },
      context
    );

    // Second item (function call)
    const fcEvents = serializeInternalEvent(
      {
        type: "function_call.started",
        itemId: "fc-1",
        name: "tool",
        callId: "call-1",
      },
      context
    );

    expect(fcEvents[0]).toMatchObject({
      type: "response.output_item.added",
      output_index: 1,
    });
  });
});

describe("createEventSerializer", () => {
  test("full text flow produces correct event sequence with [DONE]", async () => {
    const queue = createAsyncEventQueue<InternalSemanticEvent>();
    const generateId = createSequentialIdGenerator(["item-1"]);
    const accumulator = createCanonicalItemAccumulator({ generateId });
    const lifecycle = createResponseLifecycle({
      responseId: "resp-1",
      createdAt: 1000,
      clock: createDeterministicClock(2000),
    });

    const serializer = createEventSerializer({
      queue,
      accumulator,
      lifecycle,
      responseId: "resp-1",
    });

    // Push events
    queue.push({ type: "run.started", runId: "resp-1" });
    queue.push({ type: "message.started", itemId: "msg-1", runId: "resp-1" });
    queue.push({ type: "text.delta", itemId: "msg-1", delta: "Hello" });
    queue.push({ type: "text.delta", itemId: "msg-1", delta: " world" });
    queue.push({ type: "text.completed", itemId: "msg-1" });
    queue.push({ type: "run.completed", runId: "resp-1" });
    queue.complete();

    const events = await collectEvents(serializer);

    expect(events).toHaveLength(12);

    const types = events.map((e) => (typeof e === "string" ? e : e.type));
    expect(types).toEqual([
      "response.created",
      "response.queued",
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

    // Verify sequence numbers are 1..11
    const seqNums = events
      .filter((e): e is OpenResponsesEvent => typeof e !== "string")
      .map((e) => e.sequence_number);
    expect(seqNums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test("queue failure emits error + response.failed + [DONE]", async () => {
    const queue = createAsyncEventQueue<InternalSemanticEvent>();
    const generateId = createSequentialIdGenerator(["item-1"]);
    const accumulator = createCanonicalItemAccumulator({ generateId });
    const lifecycle = createResponseLifecycle({
      responseId: "resp-1",
      createdAt: 1000,
      clock: createDeterministicClock(2000),
    });

    const serializer = createEventSerializer({
      queue,
      accumulator,
      lifecycle,
      responseId: "resp-1",
    });

    queue.push({ type: "run.started", runId: "run-1" });
    queue.push({ type: "message.started", itemId: "msg-1", runId: "run-1" });
    queue.push({ type: "text.delta", itemId: "msg-1", delta: "Hi" });
    queue.fail(new Error("transport error"));

    const events = await collectEvents(serializer);

    const types = events.map((e) => (typeof e === "string" ? e : e.type));
    expect(types).toEqual([
      "response.created",
      "response.queued",
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "error",
      "response.failed",
      "[DONE]",
    ]);
  });

  test("run.failed mid-stream emits error + failed + [DONE]", async () => {
    const queue = createAsyncEventQueue<InternalSemanticEvent>();
    const generateId = createSequentialIdGenerator(["item-1"]);
    const accumulator = createCanonicalItemAccumulator({ generateId });
    const lifecycle = createResponseLifecycle({
      responseId: "resp-1",
      createdAt: 1000,
      clock: createDeterministicClock(2000),
    });

    const serializer = createEventSerializer({
      queue,
      accumulator,
      lifecycle,
      responseId: "resp-1",
    });

    queue.push({ type: "run.started", runId: "run-1" });
    queue.push({ type: "message.started", itemId: "msg-1", runId: "run-1" });
    queue.push({ type: "text.delta", itemId: "msg-1", delta: "Hi" });
    queue.push({
      type: "run.failed",
      runId: "resp-1",
      error: new Error("model crashed"),
    });
    queue.complete();

    const events = await collectEvents(serializer);

    const types = events.map((e) => (typeof e === "string" ? e : e.type));
    expect(types).toEqual([
      "response.created",
      "response.queued",
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "error",
      "response.failed",
      "[DONE]",
    ]);
  });
});

describe("formatSSEFrame", () => {
  test("produces correct SSE frame shape", () => {
    const event: OpenResponsesEvent = {
      type: "response.in_progress",
      sequence_number: 1,
      response: {
        id: "resp-1",
        object: "response",
        created_at: 1,
        completed_at: null,
        status: "in_progress",
        incomplete_details: null,
        model: "test-model",
        previous_response_id: null,
        instructions: null,
        output: [],
        error: null,
        tools: [],
        tool_choice: "auto",
        truncation: "disabled",
        parallel_tool_calls: true,
        text: { format: { type: "text" }, verbosity: "medium" },
        top_p: 1,
        presence_penalty: 0,
        frequency_penalty: 0,
        top_logprobs: 0,
        temperature: 1,
        reasoning: null,
        usage: null,
        max_output_tokens: null,
        max_tool_calls: null,
        store: false,
        background: false,
        service_tier: "default",
        metadata: {},
        safety_identifier: null,
        prompt_cache_key: null,
      },
    };

    const frame = formatSSEFrame(event);

    expect(frame.event).toBe("response.in_progress");
    expect(frame.data).toBe(JSON.stringify(event));
    expect("id" in frame).toBe(false);
  });

  test("validates outgoing events before framing", () => {
    const invalidEvent = {
      type: "response.completed",
      sequence_number: 1,
    } as unknown as OpenResponsesEvent;

    expect(() => formatSSEFrame(invalidEvent)).toThrow();
  });
});

describe("validateOutgoingEvent", () => {
  test("throws for schema-invalid events in non-production mode", () => {
    const invalidEvent = {
      type: "response.completed",
      sequence_number: 1,
    } as unknown as OpenResponsesEvent;

    expect(() => validateOutgoingEvent(invalidEvent)).toThrow();
  });
});
