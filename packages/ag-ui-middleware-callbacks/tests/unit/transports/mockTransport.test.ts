import { test, expect } from "bun:test";
import { createMockTransport } from "../../fixtures/mockTransport";

test("createMockTransport returns object with emit function", () => {
  const transport = createMockTransport();
  expect(transport).toBeDefined();
  expect(typeof transport.emit).toBe("function");
});

test("createMockTransport emit is a mock function", () => {
  const transport = createMockTransport();
  expect(transport.emit.mock).toBeDefined();
});

test("createMockTransport tracks calls", () => {
  const transport = createMockTransport();

  transport.emit({ type: "EVENT_1" });
  transport.emit({ type: "EVENT_2" });

  expect(transport.emit).toHaveBeenCalledTimes(2);
  expect(transport.emit).toHaveBeenCalledWith({ type: "EVENT_1" });
  expect(transport.emit).toHaveBeenCalledWith({ type: "EVENT_2" });
});
