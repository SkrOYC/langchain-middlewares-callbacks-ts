import { describe, expect, it } from "bun:test";
import {
	AIMessage,
	ChatMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
} from "@langchain/core/messages";
// @ts-expect-error - Utility doesn't exist yet (TDD Red Phase)
import { mapLangChainMessageToAGUI } from "../../../src/utils/messageMapper";

describe("messageMapper", () => {
	it("should map HumanMessage to user role", () => {
		const message = new HumanMessage("Hello");
		const mapped = mapLangChainMessageToAGUI(message);
		expect(mapped.role).toBe("user");
		expect(mapped.content).toBe("Hello");
		expect(mapped.id).toBeDefined();
	});

	it("should map AIMessage with tool calls", () => {
		const message = new AIMessage({
			content: "Thinking...",
			tool_calls: [
				{
					id: "call_1",
					name: "get_weather",
					args: { location: "NYC" },
				},
			],
		});
		const mapped = mapLangChainMessageToAGUI(message);
		expect(mapped.role).toBe("assistant");
		expect(mapped.content).toBe("Thinking...");
		expect(mapped.toolCalls).toHaveLength(1);
		expect(mapped.toolCalls?.[0]).toEqual({
			id: "call_1",
			type: "function",
			function: {
				name: "get_weather",
				arguments: '{"location":"NYC"}',
			},
		});
	});

	it("should map ToolMessage to tool role", () => {
		const message = new ToolMessage({
			content: '{"temp": 22}',
			tool_call_id: "call_1",
		});
		const mapped = mapLangChainMessageToAGUI(message);
		expect(mapped.role).toBe("tool");
		expect(mapped.content).toBe('{"temp": 22}');
		expect(mapped.toolCallId).toBe("call_1");
	});

	it("should map SystemMessage to system role", () => {
		const message = new SystemMessage("System prompt");
		const mapped = mapLangChainMessageToAGUI(message);
		expect(mapped.role).toBe("system");
		expect(mapped.content).toBe("System prompt");
	});

	it("should map ChatMessage with custom role", () => {
		const message = new ChatMessage("Custom content", "developer");
		const mapped = mapLangChainMessageToAGUI(message);
		expect(mapped.role).toBe("developer");
		expect(mapped.content).toBe("Custom content");
	});

	it("should preserve message ID if present in metadata", () => {
		const message = new HumanMessage({
			content: "Hello",
			id: "existing-id",
		});
		const mapped = mapLangChainMessageToAGUI(message);
		expect(mapped.id).toBe("existing-id");
	});

	it("should preserve structured user content when AG-UI compatible", () => {
		const message = new HumanMessage({
			content: [
				{ type: "text", text: "Look at this" },
				{
					type: "binary",
					mimeType: "image/png",
					url: "https://example.com/image.png",
				},
			] as any,
		});

		const mapped = mapLangChainMessageToAGUI(message);
		expect(mapped.role).toBe("user");
		expect(Array.isArray(mapped.content)).toBe(true);
		expect(mapped.content).toEqual([
			{ type: "text", text: "Look at this" },
			{
				type: "binary",
				mimeType: "image/png",
				url: "https://example.com/image.png",
			},
		]);
	});

	it("should stringify unsupported structured user content", () => {
		const message = new HumanMessage({
			content: [{ type: "image", url: "https://example.com/nope.png" }] as any,
		});

		const mapped = mapLangChainMessageToAGUI(message);
		expect(mapped.role).toBe("user");
		expect(typeof mapped.content).toBe("string");
		expect(mapped.content).toBe(
			'[{"type":"image","url":"https://example.com/nope.png"}]',
		);
	});

	it("should fallback when message content is non-serializable", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;

		const message = new HumanMessage({
			content: cyclic as any,
		});

		const mapped = mapLangChainMessageToAGUI(message);
		expect(mapped.role).toBe("user");
		expect(mapped.content).toBe("[unserializable content]");
	});

	it("should fallback tool arguments when non-serializable", () => {
		const cyclicArgs: Record<string, unknown> = {};
		cyclicArgs.self = cyclicArgs;
		const message = new AIMessage({
			content: "Thinking...",
			tool_calls: [
				{
					id: "call_1",
					name: "get_weather",
					args: cyclicArgs,
				},
			],
		});

		const mapped = mapLangChainMessageToAGUI(message);
		expect(mapped.toolCalls).toHaveLength(1);
		expect(mapped.toolCalls?.[0]).toEqual({
			id: "call_1",
			type: "function",
			function: {
				name: "get_weather",
				arguments: "{}",
			},
		});
	});
});
