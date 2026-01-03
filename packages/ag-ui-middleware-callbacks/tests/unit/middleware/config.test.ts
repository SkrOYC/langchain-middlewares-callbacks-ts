import { test, expect } from "bun:test";
import { createMockTransport } from "../../fixtures/mockTransport";

test("AGUIMiddlewareOptionsSchema validates valid options", () => {
  const validOptions = {
    transport: createMockTransport(),
    emitToolResults: true,
    emitStateSnapshots: "initial",
    maxUIPayloadSize: 50 * 1024,
    errorDetailLevel: "message"
  };

  expect(() => AGUIMiddlewareOptionsSchema.parse(validOptions)).not.toThrow();
});

test("AGUIMiddlewareOptionsSchema validates minimal options", () => {
  const minimalOptions = {
    transport: createMockTransport()
  };

  expect(() => AGUIMiddlewareOptionsSchema.parse(minimalOptions)).not.toThrow();
});

test("AGUIMiddlewareOptionsSchema rejects invalid transport", () => {
  const invalidOptions = {
    transport: "not-a-transport"
  };

  expect(() => AGUIMiddlewareOptionsSchema.parse(invalidOptions)).toThrow();
});

test("AGUIMiddlewareOptionsSchema rejects invalid emitStateSnapshots", () => {
  const invalidOptions = {
    transport: createMockTransport(),
    emitStateSnapshots: "invalid"
  };

  expect(() => AGUIMiddlewareOptionsSchema.parse(invalidOptions)).toThrow();
});
