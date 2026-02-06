import { expect, test } from "bun:test";
import { AGUIMiddlewareOptionsSchema } from "../../../src/middleware/types";
import { createMockCallback } from "../../fixtures/mockTransport";

test("AGUIMiddlewareOptionsSchema validates valid options", () => {
	const mockCallback = createMockCallback();
	const validOptions = {
		onEvent: mockCallback.emit,
		emitToolResults: true,
		emitStateSnapshots: "initial",
		maxUIPayloadSize: 50 * 1024,
		errorDetailLevel: "message",
	};

	expect(() => AGUIMiddlewareOptionsSchema.parse(validOptions)).not.toThrow();
});

test("AGUIMiddlewareOptionsSchema validates minimal options", () => {
	const mockCallback = createMockCallback();
	const minimalOptions = {
		onEvent: mockCallback.emit,
	};

	expect(() => AGUIMiddlewareOptionsSchema.parse(minimalOptions)).not.toThrow();
});

test("AGUIMiddlewareOptionsSchema rejects invalid onEvent", () => {
	const invalidOptions = {
		onEvent: "not-a-function",
	};

	expect(() => AGUIMiddlewareOptionsSchema.parse(invalidOptions)).toThrow();
});

test("AGUIMiddlewareOptionsSchema rejects invalid emitStateSnapshots", () => {
	const mockCallback = createMockCallback();
	const invalidOptions = {
		onEvent: mockCallback.emit,
		emitStateSnapshots: "invalid",
	};

	expect(() => AGUIMiddlewareOptionsSchema.parse(invalidOptions)).toThrow();
});
