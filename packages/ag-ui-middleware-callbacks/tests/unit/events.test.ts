import { test, expect, describe } from "bun:test";
import type { AGUIEvent } from "../../src/events";
import { EventType, EventSchemas } from "../../src/events";

describe("Event Type Definitions", () => {
  test("ACTIVITY_SNAPSHOT event has correct structure", () => {
    const event: AGUIEvent = {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "activity-1",
      activityType: "PLAN",
      content: { tasks: ["task1"] },
      replace: true
    };
    expect(event.type).toBe(EventType.ACTIVITY_SNAPSHOT);
  });

  test("ACTIVITY_DELTA event has correct structure", () => {
    const event: AGUIEvent = {
      type: EventType.ACTIVITY_DELTA,
      messageId: "activity-1",
      activityType: "PLAN",
      patch: [{ op: "add", path: "/tasks/-", value: "task2" }]
    };
    expect(event.type).toBe(EventType.ACTIVITY_DELTA);
  });

  test("THINKING_START event has correct structure", () => {
    const event: AGUIEvent = {
      type: EventType.THINKING_START,
      messageId: "think-1",
      title: "Analyzing request"
    };
    expect(event.type).toBe(EventType.THINKING_START);
  });

  test("MESSAGES_SNAPSHOT event uses Message objects", () => {
    const event: AGUIEvent = {
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "Hello"
        },
        {
          id: "msg-2",
          role: "assistant",
          tool_calls: [{
            id: "tc-1",
            type: "function",
            function: { name: "test", arguments: "{}" }
          }]
        }
      ]
    };
    expect(event.type).toBe(EventType.MESSAGES_SNAPSHOT);
    expect(event.messages).toHaveLength(2);
  });
});

describe("@ag-ui/core Integration", () => {
  test("EventType enum is exported from @ag-ui/core", () => {
    expect(EventType).toBeDefined();
    // Use string comparison to avoid TypeScript enum strictness
    expect(String(EventType.RUN_STARTED)).toBe("RUN_STARTED");
    expect(String(EventType.TEXT_MESSAGE_START)).toBe("TEXT_MESSAGE_START");
    expect(String(EventType.TOOL_CALL_START)).toBe("TOOL_CALL_START");
  });

  test("EventSchemas is exported from @ag-ui/core", () => {
    expect(EventSchemas).toBeDefined();
    expect(typeof EventSchemas.safeParse).toBe("function");
  });

  test("EventSchemas validates RUN_STARTED event", () => {
    const event = {
      type: EventType.RUN_STARTED,
      threadId: "thread-123",
      runId: "run-456",
    };
    const result = EventSchemas.safeParse(event);
    expect(result.success).toBe(true);
  });

  test("EventSchemas validates TEXT_MESSAGE_CONTENT event", () => {
    const event = {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg-1",
      delta: "Hello world",
    };
    const result = EventSchemas.safeParse(event);
    expect(result.success).toBe(true);
  });

  test("EventSchemas validates TOOL_CALL_START event", () => {
    const event = {
      type: EventType.TOOL_CALL_START,
      toolCallId: "tool-1",
      toolCallName: "calculator",
    };
    const result = EventSchemas.safeParse(event);
    expect(result.success).toBe(true);
  });

  test("EventSchemas rejects invalid event", () => {
    const event = {
      type: "INVALID_TYPE",
    };
    const result = EventSchemas.safeParse(event);
    expect(result.success).toBe(false);
  });
});
