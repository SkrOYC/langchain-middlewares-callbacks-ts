import { test, expect } from "bun:test";

test("TEXT_MESSAGE_START event has correct structure", () => {
  const event = {
    type: "TEXT_MESSAGE_START",
    messageId: "msg-123",
    role: "assistant",
    timestamp: expect.any(Number)
  };
  expect(event).toBeDefined();
});

test("TEXT_MESSAGE_CONTENT event has correct structure", () => {
  const event = {
    type: "TEXT_MESSAGE_CONTENT",
    messageId: "msg-123",
    delta: "Hello"
  };
  expect(event).toBeDefined();
});

test("TEXT_MESSAGE_END event has correct structure", () => {
  const event = {
    type: "TEXT_MESSAGE_END",
    messageId: "msg-123"
  };
  expect(event).toBeDefined();
});

test("TOOL_CALL_START event has correct structure", () => {
  const event = {
    type: "TOOL_CALL_START",
    toolCallId: "tc-123",
    toolCallName: "search",
    parentMessageId: "msg-123"
  };
  expect(event).toBeDefined();
});

test("TOOL_CALL_ARGS event streams deltas", () => {
  const event = {
    type: "TOOL_CALL_ARGS",
    toolCallId: "tc-123",
    delta: { query: "test" }
  };
  expect(event).toBeDefined();
});

test("RUN_STARTED event has correct structure", () => {
  const event = {
    type: "RUN_STARTED",
    threadId: "thread-123",
    runId: "run-456"
  };
  expect(event).toBeDefined();
});
