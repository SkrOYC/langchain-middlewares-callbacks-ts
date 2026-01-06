import { test, expect } from "bun:test";
import type { AGUIEvent } from "../../src/events";

test("ACTIVITY_SNAPSHOT event has correct structure", () => {
  const event: AGUIEvent = {
    type: "ACTIVITY_SNAPSHOT",
    messageId: "activity-1",
    activityType: "PLAN",
    content: { tasks: ["task1"] },
    replace: true
  };
  expect(event.type).toBe("ACTIVITY_SNAPSHOT");
});

test("ACTIVITY_DELTA event has correct structure", () => {
  const event: AGUIEvent = {
    type: "ACTIVITY_DELTA",
    messageId: "activity-1",
    activityType: "PLAN",
    patch: [{ op: "add", path: "/tasks/-", value: "task2" }]
  };
  expect(event.type).toBe("ACTIVITY_DELTA");
});

test("THINKING_START event has correct structure", () => {
  const event: AGUIEvent = {
    type: "THINKING_START",
    messageId: "think-1",
    title: "Analyzing request"
  };
  expect(event.type).toBe("THINKING_START");
});

test("MESSAGES_SNAPSHOT event uses Message objects", () => {
  const event: AGUIEvent = {
    type: "MESSAGES_SNAPSHOT",
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
  expect(event.type).toBe("MESSAGES_SNAPSHOT");
  expect(event.messages).toHaveLength(2);
});
