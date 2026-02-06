import { describe, expect, test } from "bun:test";
import {
	asStopReason,
	createStopReasonFromError,
	isStopReason,
	mapToStopReason,
} from "../../../src/utils/stopReasonMapper";

describe("mapToStopReason", () => {
	describe("cancelled state detection", () => {
		test("returns 'cancelled' when state.cancelled is true", () => {
			expect(mapToStopReason({ cancelled: true })).toBe("cancelled");
		});

		test("returns 'cancelled' when state.permissionDenied is true", () => {
			expect(mapToStopReason({ permissionDenied: true })).toBe("cancelled");
		});

		test("returns 'cancelled' when state.userRequested is true", () => {
			expect(mapToStopReason({ userRequested: true })).toBe("cancelled");
		});

		test("returns 'cancelled' when state.interrupted is true", () => {
			expect(mapToStopReason({ interrupted: true })).toBe("cancelled");
		});

		test("cancelled takes priority over other conditions", () => {
			const state = {
				cancelled: true,
				refusal: true,
				llmOutput: { finish_reason: "length" },
			};
			expect(mapToStopReason(state)).toBe("cancelled");
		});
	});

	describe("refusal detection", () => {
		test("returns 'refusal' when state.refusal is true", () => {
			expect(mapToStopReason({ refusal: true })).toBe("refusal");
		});

		test("returns 'refusal' when state.modelRefused is true", () => {
			expect(mapToStopReason({ modelRefused: true })).toBe("refusal");
		});

		test("refusal takes priority over token limit", () => {
			const state = {
				refusal: true,
				llmOutput: { finish_reason: "length" },
			};
			expect(mapToStopReason(state)).toBe("refusal");
		});
	});

	describe("max_tokens detection", () => {
		test("returns 'max_tokens' when llmOutput.finish_reason is 'length'", () => {
			expect(mapToStopReason({ llmOutput: { finish_reason: "length" } })).toBe(
				"max_tokens",
			);
		});

		test("returns 'max_tokens' when llmOutput.finish_reason is 'context_length'", () => {
			expect(
				mapToStopReason({ llmOutput: { finish_reason: "context_length" } }),
			).toBe("max_tokens");
		});

		test("returns 'max_tokens' when llmOutput.finish_reason is 'token_limit'", () => {
			expect(
				mapToStopReason({ llmOutput: { finish_reason: "token_limit" } }),
			).toBe("max_tokens");
		});

		test("returns 'max_tokens' when state.tokenLimitReached is true", () => {
			expect(mapToStopReason({ tokenLimitReached: true })).toBe("max_tokens");
		});

		test("returns 'max_tokens' when state.contextLengthExceeded is true", () => {
			expect(mapToStopReason({ contextLengthExceeded: true })).toBe(
				"max_tokens",
			);
		});

		test("returns 'max_tokens' when state.maxTokensReached is true", () => {
			expect(mapToStopReason({ maxTokensReached: true })).toBe("max_tokens");
		});
	});

	describe("max_turn_requests detection", () => {
		test("returns 'max_turn_requests' when turnRequests >= maxTurnRequests", () => {
			expect(mapToStopReason({ turnRequests: 10, maxTurnRequests: 10 })).toBe(
				"max_turn_requests",
			);
		});

		test("returns 'max_turn_requests' when state.maxStepsReached is true", () => {
			expect(mapToStopReason({ maxStepsReached: true })).toBe(
				"max_turn_requests",
			);
		});

		test("returns 'max_turn_requests' when state.maxTurnsReached is true", () => {
			expect(mapToStopReason({ maxTurnsReached: true })).toBe(
				"max_turn_requests",
			);
		});
	});

	describe("error handling", () => {
		test("returns 'end_turn' when state.error is defined", () => {
			expect(mapToStopReason({ error: "Something went wrong" })).toBe(
				"end_turn",
			);
		});

		test("returns 'end_turn' when state.error is null", () => {
			expect(mapToStopReason({ error: null })).toBe("end_turn");
		});
	});

	describe("default case", () => {
		test("returns 'end_turn' for empty state", () => {
			expect(mapToStopReason({})).toBe("end_turn");
		});

		test("returns 'end_turn' for state with unrelated properties", () => {
			expect(mapToStopReason({ messages: [], custom: "value" })).toBe(
				"end_turn",
			);
		});
	});
});

describe("createStopReasonFromError", () => {
	describe("cancellation detection", () => {
		test("returns 'cancelled' for 'cancelled' in message", () => {
			expect(createStopReasonFromError(new Error("Operation cancelled"))).toBe(
				"cancelled",
			);
		});

		test("returns 'cancelled' for 'canceled' in message (US spelling)", () => {
			expect(createStopReasonFromError(new Error("Operation canceled"))).toBe(
				"cancelled",
			);
		});

		test("returns 'cancelled' for 'aborted' in message", () => {
			expect(createStopReasonFromError(new Error("Request aborted"))).toBe(
				"cancelled",
			);
		});

		test("returns 'cancelled' for 'interrupted' in message", () => {
			expect(createStopReasonFromError(new Error("Process interrupted"))).toBe(
				"cancelled",
			);
		});
	});

	describe("permission denial detection", () => {
		test("returns 'cancelled' for 'permission' in message", () => {
			expect(createStopReasonFromError(new Error("Permission denied"))).toBe(
				"cancelled",
			);
		});

		test("returns 'cancelled' for 'unauthorized' in message", () => {
			expect(createStopReasonFromError(new Error("Unauthorized access"))).toBe(
				"cancelled",
			);
		});

		test("returns 'cancelled' for 'forbidden' in message", () => {
			expect(createStopReasonFromError(new Error("Forbidden operation"))).toBe(
				"cancelled",
			);
		});
	});

	describe("refusal detection", () => {
		test("returns 'refusal' for 'refuse' in message", () => {
			expect(
				createStopReasonFromError(new Error("Agent refuses to continue")),
			).toBe("refusal");
		});

		test("returns 'refusal' for 'declined' in message", () => {
			expect(createStopReasonFromError(new Error("Request declined"))).toBe(
				"refusal",
			);
		});

		test("returns 'refusal' when error name contains 'refusal'", () => {
			const error = new Error("Test");
			error.name = "RefusalError";
			expect(createStopReasonFromError(error)).toBe("refusal");
		});
	});

	describe("token limit detection", () => {
		test("returns 'max_tokens' for 'token' in message", () => {
			expect(createStopReasonFromError(new Error("Token limit exceeded"))).toBe(
				"max_tokens",
			);
		});

		test("returns 'max_tokens' for 'length' in message", () => {
			expect(
				createStopReasonFromError(new Error("Token length exceeded")),
			).toBe("max_tokens");
		});

		test("returns 'max_tokens' for 'context' in message", () => {
			expect(
				createStopReasonFromError(new Error("Context length exceeded")),
			).toBe("max_tokens");
		});
	});

	describe("turn limit detection", () => {
		test("returns 'max_turn_requests' for 'turn' in message", () => {
			expect(createStopReasonFromError(new Error("Max turns reached"))).toBe(
				"max_turn_requests",
			);
		});

		test("returns 'max_turn_requests' for 'step' in message", () => {
			expect(createStopReasonFromError(new Error("Max steps exceeded"))).toBe(
				"max_turn_requests",
			);
		});
	});

	describe("default case", () => {
		test("returns 'end_turn' for unknown errors", () => {
			expect(createStopReasonFromError(new Error("Unknown error"))).toBe(
				"end_turn",
			);
		});

		test("returns 'end_turn' for non-Error values", () => {
			expect(createStopReasonFromError("string error" as any)).toBe("end_turn");
			expect(createStopReasonFromError(null as any)).toBe("end_turn");
			expect(createStopReasonFromError(undefined as any)).toBe("end_turn");
			expect(createStopReasonFromError(123 as any)).toBe("end_turn");
		});
	});
});

describe("isStopReason", () => {
	test("returns true for valid stop reasons", () => {
		expect(isStopReason("end_turn")).toBe(true);
		expect(isStopReason("max_tokens")).toBe(true);
		expect(isStopReason("max_turn_requests")).toBe(true);
		expect(isStopReason("refusal")).toBe(true);
		expect(isStopReason("cancelled")).toBe(true);
	});

	test("returns false for invalid values", () => {
		expect(isStopReason("unknown")).toBe(false);
		expect(isStopReason("")).toBe(false);
		expect(isStopReason(null)).toBe(false);
		expect(isStopReason(undefined)).toBe(false);
		expect(isStopReason(123)).toBe(false);
		expect(isStopReason({})).toBe(false);
	});
});

describe("asStopReason", () => {
	test("returns value if it's a valid stop reason", () => {
		expect(asStopReason("cancelled")).toBe("cancelled");
		expect(asStopReason("refusal")).toBe("refusal");
		expect(asStopReason("max_tokens")).toBe("max_tokens");
		expect(asStopReason("max_turn_requests")).toBe("max_turn_requests");
		expect(asStopReason("end_turn")).toBe("end_turn");
	});

	test("returns default for invalid values", () => {
		expect(asStopReason("unknown")).toBe("end_turn");
		expect(asStopReason(null)).toBe("end_turn");
		expect(asStopReason(undefined)).toBe("end_turn");
	});

	test("uses custom default when provided", () => {
		expect(asStopReason("unknown", "cancelled")).toBe("cancelled");
		expect(asStopReason(null, "refusal")).toBe("refusal");
	});
});
