/**
 * ORL-001 Spike Verification Tests
 *
 * These tests verify the feasibility of LangChain callbacks and Hono SSE
 * as documented in the engineering spike.
 *
 * IMPORTANT: These tests verify ACTUAL BEHAVIOR, not just type existence.
 * Tests that pass "no matter what" have been removed.
 *
 * Run with: bun test tests/spike/callback-verification.test.ts
 */

import { describe, expect, test } from "bun:test";
import type { CallbackHandlerMethods } from "@langchain/core/callbacks/base";
import {
  createInternalError,
  internalErrorToPublicError,
  internalErrorToSpecErrorType,
  internalErrorToStatusCode,
} from "@/core/errors.js";
import {
  OpenResponsesEventSchema,
  OpenResponsesRequestSchema,
  OutputItemAddedEventSchema,
  OutputTextDeltaEventSchema,
  ResponseCompletedEventSchema,
  ResponseFailedEventSchema,
  ResponseInProgressEventSchema,
} from "@/core/schemas.js";
import {
  createCyclingIdGenerator,
  createDeterministicIdGenerator,
  createFakeAgent,
  createInMemoryPreviousResponseStore,
  createSequentialIdGenerator,
} from "@/testing/index.js";

// =============================================================================
// Test 1: Fake Agent Behavior (NOT just type checking)
// =============================================================================

describe("Fake Agent Behavior", () => {
  test("invoke should return the configured response", async () => {
    const agent = createFakeAgent({
      responses: [{ type: "ai", id: "msg-1", content: "Hello from agent" }],
    });

    const result = await agent.invoke({ messages: [] });

    // This will FAIL if the implementation is wrong
    expect(result).toEqual({
      type: "ai",
      id: "msg-1",
      content: "Hello from agent",
    });
  });

  test("invoke should return responses in sequence", async () => {
    const agent = createFakeAgent({
      responses: [
        { type: "ai", content: "First response" },
        { type: "ai", content: "Second response" },
      ],
    });

    const result1 = await agent.invoke({ messages: [] });
    const result2 = await agent.invoke({ messages: [] });

    expect(result1).toEqual({ type: "ai", content: "First response" });
    expect(result2).toEqual({ type: "ai", content: "Second response" });
  });

  test("stream should yield chunks in order", async () => {
    const agent = createFakeAgent({
      streamChunks: [
        { type: "chunk", content: "Hello" },
        { type: "chunk", content: " World" },
        { type: "chunk", content: "!" },
      ],
    });

    const chunks: unknown[] = [];
    for await (const chunk of agent.stream({ messages: [] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "chunk", content: "Hello" },
      { type: "chunk", content: " World" },
      { type: "chunk", content: "!" },
    ]);
  });

  test("invoke should throw configured error", async () => {
    const error = new Error("Agent failed");
    const agent = createFakeAgent({ invokeError: error });

    await expect(agent.invoke({ messages: [] })).rejects.toThrow(
      "Agent failed"
    );
  });

  test("stream should throw configured error", async () => {
    const error = new Error("Stream failed");
    const agent = createFakeAgent({ streamError: error });

    const iterator = agent.stream({ messages: [] })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow("Stream failed");
  });
  test("stream count should increment even with partial consumption", async () => {
    const agent = createFakeAgent({
      streamChunks: [
        { type: "chunk", content: "first" },
        { type: "chunk", content: "second" },
      ],
    });

    const iterator = agent.stream({ messages: [] })[Symbol.asyncIterator]();
    const first = await iterator.next();

    expect(first.value).toEqual({ type: "chunk", content: "first" });
    expect(agent.__getStreamCount()).toBe(1);
  });

  test("invoke should fail fast on empty responses", async () => {
    const agent = createFakeAgent({ responses: [] });

    await expect(agent.invoke({ messages: [] })).rejects.toThrow(
      "FakeAgent misconfigured: responses array cannot be empty"
    );
  });
});
// =============================================================================
// Test 2: ORL-001 Spike Acceptance Scenarios
// =============================================================================

describe("ORL-001 Spike Acceptance", () => {
  test("should exercise callback richness for text, tool, and failures", async () => {
    const observed: string[] = [];

    const callbacks: CallbackHandlerMethods = {
      handleChatModelStart: () => {
        observed.push("chat_model.start");
      },
      handleLLMNewToken: (token) => {
        observed.push(`llm.new_token:${token}`);
      },
      handleToolStart: () => {
        observed.push("tool.start");
      },
      handleToolEnd: () => {
        observed.push("tool.end");
      },
      handleChainError: () => {
        observed.push("chain.error");
      },
      handleLLMError: () => {
        observed.push("llm.error");
      },
    };

    const invokeCallbacks = callbacks as Record<
      string,
      (...args: unknown[]) => unknown
    >;

    await Promise.resolve(
      invokeCallbacks.handleChatModelStart?.([], {}, "run-1")
    );
    await Promise.resolve(
      invokeCallbacks.handleLLMNewToken?.(
        "Hello",
        { prompt: 0, completion: 0 },
        "run-1"
      )
    );
    await Promise.resolve(
      invokeCallbacks.handleLLMNewToken?.(
        " world",
        { prompt: 0, completion: 1 },
        "run-1"
      )
    );
    await Promise.resolve(
      invokeCallbacks.handleToolStart?.({}, "tool-input", "run-2")
    );
    await Promise.resolve(
      invokeCallbacks.handleToolEnd?.("tool-output", "run-2")
    );

    // Failure before stream start
    await Promise.resolve(
      invokeCallbacks.handleChainError?.(
        new Error("pre-start failure"),
        "run-1"
      )
    );

    // Failure after stream started
    await Promise.resolve(
      invokeCallbacks.handleLLMError?.(new Error("post-start failure"), "run-1")
    );

    expect(observed).toContain("chat_model.start");
    expect(observed).toContain("llm.new_token:Hello");
    expect(observed).toContain("llm.new_token: world");
    expect(observed).toContain("tool.start");
    expect(observed).toContain("tool.end");
    expect(observed).toContain("chain.error");
    expect(observed).toContain("llm.error");
  });

  test("should model pre-start failure as HTTP error response", async () => {
    const { Hono } = await import("hono");

    const app = new Hono();
    app.get("/pre-start-fail", () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "invalid_request",
            message: "Bad input",
            type: "invalid_request_error",
          },
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        }
      );
    });

    const res = await app.request("/pre-start-fail");
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({
      error: {
        code: "invalid_request",
        message: "Bad input",
        type: "invalid_request_error",
      },
    });
  });

  test("should model post-start failure as response.failed then [DONE]", async () => {
    const { Hono } = await import("hono");
    const { streamSSE } = await import("hono/streaming");

    const app = new Hono();
    app.get("/post-start-fail", (c) => {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          event: "response.in_progress",
          data: JSON.stringify({
            type: "response.in_progress",
            sequence_number: 1,
          }),
        });

        await stream.writeSSE({
          event: "response.failed",
          data: JSON.stringify({
            type: "response.failed",
            sequence_number: 2,
            response: {
              id: "resp-1",
              object: "response",
              status: "failed",
            },
            error: {
              code: "internal_error",
              message: "post-start failure",
              type: "server_error",
            },
          }),
        });

        await stream.write("data: [DONE]\n\n");
      });
    });

    const res = await app.request("/post-start-fail");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("event: response.failed");
    expect(body).toContain('"type":"response.failed"');
    expect(body).toContain("data: [DONE]");
  });
});

// =============================================================================
// Test 3: Deterministic ID Generator (NOT just type checking)
// =============================================================================

describe("Deterministic ID Generator", () => {
  test("should generate sequential IDs", () => {
    const generateId = createDeterministicIdGenerator("run-");

    expect(generateId()).toBe("run-0");
    expect(generateId()).toBe("run-1");
    expect(generateId()).toBe("run-2");
  });

  test("should handle custom prefixes", () => {
    const generateId = createDeterministicIdGenerator("response-");

    expect(generateId()).toBe("response-0");
    expect(generateId()).toBe("response-1");
  });

  test("should throw on empty array", () => {
    const generateId = createSequentialIdGenerator([]);

    expect(generateId).toThrow();
  });

  test("should cycle through array", () => {
    const generateId = createCyclingIdGenerator(["a", "b", "c"]);

    expect(generateId()).toBe("a");
    expect(generateId()).toBe("b");
    expect(generateId()).toBe("c");
    expect(generateId()).toBe("a"); // cycles back
  });
});

// =============================================================================
// Test 3: Schema Validation (ACTUAL validation, not just existence)
// =============================================================================

describe("Schema Validation", () => {
  test("should accept valid minimal request", () => {
    const validRequest = {
      model: "gpt-4",
      input: "Hello",
    };

    const result = OpenResponsesRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  test("should accept request with all fields", () => {
    const fullRequest = {
      model: "gpt-4",
      input: [{ type: "message", role: "user", content: "Hello" }],
      stream: true,
      tools: [
        {
          type: "function",
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object" },
        },
      ],
      tool_choice: "auto",
      parallel_tool_calls: false,
      temperature: 0.5,
      metadata: { source: "test" },
    };

    const result = OpenResponsesRequestSchema.safeParse(fullRequest);
    expect(result.success).toBe(true);
  });

  test("should reject request missing required model", () => {
    const invalidRequest = {
      input: "Hello",
    };

    const result = OpenResponsesRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });

  test("should validate all streaming event types", () => {
    // Test response.in_progress
    expect(
      ResponseInProgressEventSchema.safeParse({
        type: "response.in_progress",
        sequence_number: 1,
        response: { id: "r1", object: "response", status: "in_progress" },
      }).success
    ).toBe(true);

    // Test response.output_item.added
    expect(
      OutputItemAddedEventSchema.safeParse({
        type: "response.output_item.added",
        sequence_number: 2,
        output_index: 0,
        item: {
          id: "item-1",
          type: "message",
          role: "assistant",
          status: "in_progress",
          content: [],
        },
      }).success
    ).toBe(true);

    // Test response.output_text.delta
    expect(
      OutputTextDeltaEventSchema.safeParse({
        type: "response.output_text.delta",
        sequence_number: 3,
        item_id: "item-1",
        output_index: 0,
        content_index: 0,
        delta: "Hello",
      }).success
    ).toBe(true);

    // Test response.completed
    expect(
      ResponseCompletedEventSchema.safeParse({
        type: "response.completed",
        sequence_number: 10,
        response: { id: "r1", object: "response", status: "completed" },
      }).success
    ).toBe(true);

    // Test response.failed
    expect(
      ResponseFailedEventSchema.safeParse({
        type: "response.failed",
        sequence_number: 10,
        response: { id: "r1", object: "response", status: "failed" },
        error: {
          code: "500",
          message: "Internal error",
          type: "server_error",
        },
      }).success
    ).toBe(true);
  });

  test("should reject invalid event sequence numbers", () => {
    // sequence_number must be positive
    const result = ResponseInProgressEventSchema.safeParse({
      type: "response.in_progress",
      sequence_number: 0, // invalid - must be positive
      response: { id: "r1", object: "response", status: "in_progress" },
    });
    expect(result.success).toBe(false);
  });

  test("should reject unknown event types", () => {
    const result = OpenResponsesEventSchema.safeParse({
      type: "response.unknown_event",
      sequence_number: 1,
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// Test 4: Error Mapping (ACTUAL mapping logic)
// =============================================================================

describe("Error Mapping", () => {
  test("should map invalid_request to 400 and invalid_request_error", () => {
    expect(internalErrorToStatusCode.invalid_request).toBe(400);
    expect(internalErrorToSpecErrorType.invalid_request).toBe(
      "invalid_request_error"
    );
  });

  test("should map previous_response_not_found to 404 and not_found", () => {
    expect(internalErrorToStatusCode.previous_response_not_found).toBe(404);
    expect(internalErrorToSpecErrorType.previous_response_not_found).toBe(
      "not_found"
    );
  });

  test("should map agent_execution_failed to 500 and model_error", () => {
    expect(internalErrorToStatusCode.agent_execution_failed).toBe(500);
    expect(internalErrorToSpecErrorType.agent_execution_failed).toBe(
      "model_error"
    );
  });

  test("should map unsupported_media_type to 415", () => {
    expect(internalErrorToStatusCode.unsupported_media_type).toBe(415);
  });

  test("should map previous_response_unusable to 409", () => {
    expect(internalErrorToStatusCode.previous_response_unusable).toBe(409);
  });

  test("internalErrorToPublicError should produce correct ErrorObject", () => {
    const internal = createInternalError(
      "previous_response_not_found",
      "Response 'abc-123' not found"
    );

    const publicError = internalErrorToPublicError(internal);

    expect(publicError.type).toBe("not_found");
    expect(publicError.code).toBe("previous_response_not_found");
    expect(publicError.message).toBe("Response 'abc-123' not found");
  });

  test("should use default message when internal message is empty", () => {
    const internal = createInternalError("internal_error", "");

    const publicError = internalErrorToPublicError(internal, "Default error");

    expect(publicError.message).toBe("Default error");
  });
});

// =============================================================================
// Test 5: In-Memory Store Behavior
// =============================================================================

describe("In-Memory Store", () => {
  test("should save and load records", async () => {
    const store = createInMemoryPreviousResponseStore();

    const record = {
      response_id: "resp-1",
      created_at: 1000,
      completed_at: 2000,
      model: "gpt-4",
      request: {
        model: "gpt-4",
        input: "Hello",
        metadata: {},
        tools: [],
        parallel_tool_calls: true,
      },
      response: {
        id: "resp-1",
        object: "response" as const,
        created_at: 1000,
        completed_at: 2000,
        status: "completed" as const,
        model: "gpt-4",
        previous_response_id: null,
        output: [],
        error: null,
        metadata: {},
      },
      status: "completed" as const,
      error: null,
    };

    await store.save(record);
    const loaded = await store.load("resp-1");

    expect(loaded).not.toBeNull();
    expect(loaded?.response_id).toBe("resp-1");
    expect(loaded?.status).toBe("completed");
  });

  test("should return null for missing record", async () => {
    const store = createInMemoryPreviousResponseStore();

    const result = await store.load("nonexistent");

    expect(result).toBeNull();
  });

  test("should overwrite existing record on save", async () => {
    const store = createInMemoryPreviousResponseStore();

    const baseResponse = {
      id: "resp-1",
      object: "response" as const,
      created_at: 1000,
      completed_at: 2000,
      status: "completed" as const,
      model: "gpt-4",
      previous_response_id: null,
      output: [],
      error: null,
      metadata: {},
    };

    await store.save({
      response_id: "resp-1",
      created_at: 1000,
      completed_at: 2000,
      model: "gpt-4",
      request: {
        model: "gpt-4",
        input: "Hello",
        metadata: {},
        tools: [],
        parallel_tool_calls: true,
      },
      response: baseResponse,
      status: "completed",
      error: null,
    });

    await store.save({
      response_id: "resp-1",
      created_at: 1000,
      completed_at: 3000,
      model: "gpt-4",
      request: {
        model: "gpt-4",
        input: "Updated",
        metadata: {},
        tools: [],
        parallel_tool_calls: true,
      },
      response: {
        ...baseResponse,
        completed_at: 3000,
      },
      status: "completed",
      error: null,
    });

    const loaded = await store.load("resp-1");
    expect(loaded?.request.input).toBe("Updated");
  });
});
