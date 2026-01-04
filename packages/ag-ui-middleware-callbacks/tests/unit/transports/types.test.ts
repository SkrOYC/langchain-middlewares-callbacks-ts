import { test, expect } from "bun:test";
import { createMockTransport } from "../../fixtures/mockTransport";

test("Mock transport implements AGUITransport interface", () => {
  const transport = createMockTransport();

  const event = {
    type: "TEXT_MESSAGE_START",
    messageId: "msg-123",
    role: "assistant"
  };

  transport.emit(event);
  expect(transport.emit).toHaveBeenCalledWith(event);
});

test("Mock transport can track multiple emits", () => {
  const transport = createMockTransport();

  transport.emit({ type: "EVENT_1" });
  transport.emit({ type: "EVENT_2" });
  transport.emit({ type: "EVENT_3" });

  expect(transport.emit).toHaveBeenCalledTimes(3);
});
