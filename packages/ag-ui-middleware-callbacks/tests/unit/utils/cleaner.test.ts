import { describe, expect, it } from "bun:test";
import {
	cleanLangChainData,
	extractToolOutput,
} from "../../../src/utils/cleaner";

describe("cleaner utilities", () => {
	describe("cleanLangChainData", () => {
		it("should handle 'lc_kwargs' and 'lc_serializable' format (Red Phase)", () => {
			const rawData = {
				messages: [
					{
						lc_serializable: true,
						lc_kwargs: {
							content: "Hello",
							additional_kwargs: {},
						},
						lc_namespace: ["langchain_core", "messages"],
						content: "Hello",
						additional_kwargs: {},
					},
				],
				other_field: "value",
			};

			const cleaned = cleanLangChainData(rawData);

			// Verify lc_ fields are gone
			expect(cleaned.messages[0].lc_serializable).toBeUndefined();
			expect(cleaned.messages[0].lc_kwargs).toBeUndefined();
			expect(cleaned.messages[0].lc_namespace).toBeUndefined();

			// Verify kwargs are flattened or cleaned
			expect(cleaned.messages[0].content).toBe("Hello");
			expect(cleaned.other_field).toBe("value");
		});
	});

	describe("extractToolOutput", () => {
		it("should extract content from 'lc_kwargs' formatted ToolMessage (Red Phase)", () => {
			const toolOutput = JSON.stringify({
				lc: 1,
				type: "constructor",
				id: ["langchain_core", "messages", "ToolMessage"],
				kwargs: {
					content: "The result is 15",
					tool_call_id: "call_1",
				},
				// Also testing with the alternate format seen in logs
				lc_kwargs: {
					content: "The result is 15",
					tool_call_id: "call_1",
				},
			});

			const extracted = extractToolOutput(toolOutput);
			expect(extracted).toBe("The result is 15");
		});
	});
});
