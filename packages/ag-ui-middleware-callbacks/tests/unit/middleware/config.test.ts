import { expect, test } from "bun:test";
import { AGUIMiddlewareOptionsSchema } from "../../../src/middleware/types";
import { createMockCallback } from "../../fixtures/mock-transport";

test("AGUIMiddlewareOptionsSchema validates valid options", () => {
  const mockCallback = createMockCallback();
  const validOptions = {
    publish: mockCallback.emit,
    emitStateSnapshots: "initial",
    errorDetailLevel: "message",
  };

  expect(() => AGUIMiddlewareOptionsSchema.parse(validOptions)).not.toThrow();
});

test("AGUIMiddlewareOptionsSchema validates minimal options", () => {
  const mockCallback = createMockCallback();
  const minimalOptions = {
    publish: mockCallback.emit,
  };

  expect(() => AGUIMiddlewareOptionsSchema.parse(minimalOptions)).not.toThrow();
});

test("AGUIMiddlewareOptionsSchema rejects invalid publish", () => {
  const invalidOptions = {
    publish: "not-a-function",
  };

  expect(() => AGUIMiddlewareOptionsSchema.parse(invalidOptions)).toThrow();
});

test("AGUIMiddlewareOptionsSchema rejects invalid emitStateSnapshots", () => {
  const mockCallback = createMockCallback();
  const invalidOptions = {
    publish: mockCallback.emit,
    emitStateSnapshots: "invalid",
  };

  expect(() => AGUIMiddlewareOptionsSchema.parse(invalidOptions)).toThrow();
});
