import { describe, expect, test } from "bun:test";
import {
	extractReasoningBlocks,
	extractReasoningText,
	groupReasoningBlocksByIndex,
	isReasoningBlock,
} from "../../../src/utils/reasoningBlocks";

// Mock AIMessage class for testing
class MockAIMessage {
	public contentBlocks: any[];

	constructor(contentBlocks: any[]) {
		this.contentBlocks = contentBlocks;
	}

	_getType(): string {
		return "ai";
	}
}

class MockHumanMessage {
	public contentBlocks: any[];

	constructor(contentBlocks: any[]) {
		this.contentBlocks = contentBlocks;
	}

	_getType(): string {
		return "human";
	}
}

describe("reasoningBlocks utility", () => {
	describe("isReasoningBlock", () => {
		test("returns true for reasoning blocks", () => {
			const block = { type: "reasoning", reasoning: "test reasoning" };
			expect(isReasoningBlock(block)).toBe(true);
		});

		test("returns false for text blocks", () => {
			const block = { type: "text", text: "test text" };
			expect(isReasoningBlock(block)).toBe(false);
		});

		test("returns false for tool call blocks", () => {
			const block = { type: "tool_call", id: "tc-1", name: "test_tool" };
			expect(isReasoningBlock(block)).toBe(false);
		});

		test("returns false for null/undefined", () => {
			expect(isReasoningBlock(null as any)).toBe(false);
			expect(isReasoningBlock(undefined as any)).toBe(false);
		});
	});

	describe("extractReasoningBlocks", () => {
		test("extracts reasoning blocks from AI message", () => {
			const message = new MockAIMessage([
				{ type: "reasoning", reasoning: "First thought" },
				{ type: "text", text: "Response text" },
				{ type: "reasoning", reasoning: "Second thought" },
			]);

			const blocks = extractReasoningBlocks(message as any);

			expect(blocks).toHaveLength(2);
			expect(blocks[0].reasoning).toBe("First thought");
			expect(blocks[1].reasoning).toBe("Second thought");
		});

		test("returns empty array for human messages", () => {
			const message = new MockHumanMessage([
				{ type: "reasoning", reasoning: "Should not extract" },
			]);

			const blocks = extractReasoningBlocks(message as any);

			expect(blocks).toHaveLength(0);
		});

		test("returns empty array when no reasoning blocks", () => {
			const message = new MockAIMessage([
				{ type: "text", text: "Just text" },
				{ type: "tool_call", id: "tc-1", name: "test" },
			]);

			const blocks = extractReasoningBlocks(message as any);

			expect(blocks).toHaveLength(0);
		});

		test("handles blocks with signature", () => {
			const message = new MockAIMessage([
				{
					type: "reasoning",
					reasoning: "Thinking with signature",
					signature: "abc123",
				},
			]);

			const blocks = extractReasoningBlocks(message as any);

			expect(blocks).toHaveLength(1);
			expect(blocks[0].signature).toBe("abc123");
		});

		test("handles blocks with index", () => {
			const message = new MockAIMessage([
				{ type: "reasoning", reasoning: "Phase 1", index: 0 },
				{ type: "reasoning", reasoning: "Phase 2", index: 1 },
			]);

			const blocks = extractReasoningBlocks(message as any);

			expect(blocks).toHaveLength(2);
			expect(blocks[0].index).toBe(0);
			expect(blocks[1].index).toBe(1);
		});

		test("handles messages without contentBlocks", () => {
			const message = { _getType: () => "ai" } as any;

			const blocks = extractReasoningBlocks(message);

			expect(blocks).toHaveLength(0);
		});
	});

	describe("extractReasoningText", () => {
		test("extracts only reasoning text strings", () => {
			const message = new MockAIMessage([
				{ type: "reasoning", reasoning: "First thought" },
				{ type: "text", text: "Response text" },
				{ type: "reasoning", reasoning: "Second thought" },
			]);

			const texts = extractReasoningText(message as any);

			expect(texts).toEqual(["First thought", "Second thought"]);
		});

		test("filters out empty reasoning strings", () => {
			const message = new MockAIMessage([
				{ type: "reasoning", reasoning: "Valid thought" },
				{ type: "reasoning", reasoning: "" },
				{ type: "reasoning", reasoning: "   " },
			]);

			const texts = extractReasoningText(message as any);

			expect(texts).toEqual(["Valid thought"]);
		});

		test("returns empty array for non-AI messages", () => {
			const message = new MockHumanMessage([
				{ type: "reasoning", reasoning: "Should not extract" },
			]);

			const texts = extractReasoningText(message as any);

			expect(texts).toHaveLength(0);
		});
	});

	describe("groupReasoningBlocksByIndex", () => {
		test("groups reasoning blocks by their index", () => {
			const message = new MockAIMessage([
				{ type: "reasoning", reasoning: "Phase 0a", index: 0 },
				{ type: "reasoning", reasoning: "Phase 0b", index: 0 },
				{ type: "reasoning", reasoning: "Phase 1a", index: 1 },
				{ type: "reasoning", reasoning: "Phase 1b", index: 1 },
			]);

			const grouped = groupReasoningBlocksByIndex(message as any);

			expect(grouped.size).toBe(2);
			expect(grouped.get(0)).toHaveLength(2);
			expect(grouped.get(1)).toHaveLength(2);
		});

		test("groups blocks without index under 0", () => {
			const message = new MockAIMessage([
				{ type: "reasoning", reasoning: "No index 1" },
				{ type: "reasoning", reasoning: "No index 2" },
			]);

			const grouped = groupReasoningBlocksByIndex(message as any);

			expect(grouped.size).toBe(1);
			expect(grouped.get(0)).toHaveLength(2);
		});

		test("handles interleaved thinking pattern", () => {
			const message = new MockAIMessage([
				{ type: "reasoning", reasoning: "Initial thought", index: 0 },
				{ type: "text", text: "First response" },
				{ type: "reasoning", reasoning: "After tool thought", index: 1 },
				{ type: "text", text: "Final response" },
			]);

			const grouped = groupReasoningBlocksByIndex(message as any);

			expect(grouped.size).toBe(2);
			expect(grouped.get(0)?.[0].reasoning).toBe("Initial thought");
			expect(grouped.get(1)?.[0].reasoning).toBe("After tool thought");
		});

		test("returns empty map for messages without reasoning", () => {
			const message = new MockAIMessage([{ type: "text", text: "Just text" }]);

			const grouped = groupReasoningBlocksByIndex(message as any);

			expect(grouped.size).toBe(0);
		});
	});
});
