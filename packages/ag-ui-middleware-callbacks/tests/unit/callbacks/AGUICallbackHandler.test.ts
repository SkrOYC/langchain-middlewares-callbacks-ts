import { describe, expect, test } from "bun:test";
import { AGUICallbackHandler } from "../../../src/callbacks/AGUICallbackHandler";
import { createMockCallback } from "../../fixtures/mockTransport";

describe("AGUICallbackHandler", () => {
	test("is instantiated correctly", () => {
		const mockCallback = createMockCallback();
		const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });

		expect(handler).toBeDefined();
		expect(handler.name).toBe("ag-ui-callback");
	});

	describe("LLM Callbacks", () => {
		test("handleLLMStart generates messageId internally and emits TEXT_MESSAGE_START", async () => {
			const mockCallback = createMockCallback();
			const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
			const runId = "run-123";
			const parentRunId = "run-parent";

			await handler.handleLLMStart(
				null,
				["prompt"],
				runId,
				parentRunId,
				undefined,
				undefined,
				undefined,
			);

			const messageId = (handler as any).messageIds.get(runId);
			expect(messageId).toBeDefined();
			expect(typeof messageId).toBe("string");

			// Should emit TEXT_MESSAGE_START (Callback responsibility)
			expect(mockCallback.emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "TEXT_MESSAGE_START",
					messageId: expect.any(String),
					role: "assistant",
				}),
			);
		});

		test("handleLLMNewToken emits TEXT_MESSAGE_CONTENT", async () => {
			const mockCallback = createMockCallback();
			const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
			const runId = "run-123";
			const messageId = "msg-abc";

			(handler as any).messageIds.set(runId, messageId);
			await handler.handleLLMNewToken("Hello", null, runId);

			expect(mockCallback.emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "TEXT_MESSAGE_CONTENT",
					messageId,
					delta: "Hello",
				}),
			);
		});
	});

	describe("Tool Callbacks", () => {
		test("handleToolStart emits TOOL_CALL_START with parentMessageId even after LLM end (Red Phase)", async () => {
			const mockCallback = createMockCallback();
			const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
			const parentRunId = "run-parent";
			const toolRunId = "run-tool";

			await handler.handleLLMStart(null, [], toolRunId, parentRunId);
			const parentMessageId = (handler as any).latestMessageIds.get(
				parentRunId,
			);

			// End LLM run
			await handler.handleLLMEnd({}, toolRunId);

			// Start tool call - should use parent message
			await handler.handleToolStart(
				{ name: "weather_tool" },
				JSON.stringify({ id: "tc-1", name: "weather_tool", args: {} }),
				toolRunId,
				parentRunId,
			);

			expect(mockCallback.emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "TOOL_CALL_START",
					toolCallId: "tc-1",
					toolCallName: "weather_tool",
					parentMessageId,
				}),
			);
		});

		test("handleToolEnd emits TOOL_CALL_RESULT and cleans up", async () => {
			const mockCallback = createMockCallback();
			const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
			const toolRunId = "run-tool";
			const parentRunId = "run-parent";

			await handler.handleLLMStart(null, [], toolRunId, parentRunId);
			const parentMessageId = (handler as any).latestMessageIds.get(
				parentRunId,
			);

			await handler.handleToolStart(
				{ name: "weather_tool" },
				JSON.stringify({ id: "tc-1", name: "weather_tool", args: {} }),
				toolRunId,
				parentRunId,
			);

			await handler.handleToolEnd('{"temp":72}', toolRunId, parentRunId);

			expect(mockCallback.emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "TOOL_CALL_END",
					toolCallId: "tc-1",
					// parentMessageId is not included in TOOL_CALL_END events
				}),
			);

			expect(mockCallback.emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "TOOL_CALL_RESULT",
					toolCallId: "tc-1",
					content: '{"temp":72}',
					role: "tool",
				}),
			);

			expect((handler as any).toolCallInfo.has(toolRunId)).toBe(false);
		});

		test("handleToolEnd preserves toolCallId from handleToolStart (no override)", async () => {
			const mockCallback = createMockCallback();
			const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
			const toolRunId = "run-tool";
			const parentRunId = "run-parent";

			await handler.handleLLMStart(null, [], toolRunId, parentRunId);

			// Start tool call with specific toolCallId (UUID v7 format - time-ordered)
			const startToolCallId = "019c0015-d451-7000-8000-0bfbb7aee3bd";
			await handler.handleToolStart(
				{ name: "weather_tool" },
				JSON.stringify({ id: startToolCallId, name: "weather_tool", args: {} }),
				toolRunId,
				parentRunId,
			);

			// End tool call with output containing DIFFERENT tool_call_id (UUID v4 format - random)
			// This simulates LangChain sometimes providing different IDs in the response
			const outputWithDifferentId = {
				kwargs: {
					tool_call_id: "14644ccc-1274-4f58-b80f-589650f0edb5",
				},
			};
			await handler.handleToolEnd(
				outputWithDifferentId,
				toolRunId,
				parentRunId,
			);

			// Extract all tool call events
			const toolCallStartEvents = mockCallback.events.filter(
				(e: any) => e.type === "TOOL_CALL_START",
			);
			const toolCallEndEvents = mockCallback.events.filter(
				(e: any) => e.type === "TOOL_CALL_END",
			);
			const toolCallResultEvents = mockCallback.events.filter(
				(e: any) => e.type === "TOOL_CALL_RESULT",
			);

			// Verify we have the expected events
			expect(toolCallStartEvents.length).toBe(1);
			expect(toolCallEndEvents.length).toBe(1);
			expect(toolCallResultEvents.length).toBe(1);

			// CRITICAL: All events MUST use the same toolCallId (from START, not from output)
			expect(toolCallStartEvents[0].toolCallId).toBe(startToolCallId);
			expect(toolCallEndEvents[0].toolCallId).toBe(startToolCallId); // MUST match START
			expect(toolCallResultEvents[0].toolCallId).toBe(startToolCallId); // MUST match START

			// Verify the output's tool_call_id was NOT used (it was different)
			expect(toolCallEndEvents[0].toolCallId).not.toBe(
				"14644ccc-1274-4f58-b80f-589650f0edb5",
			);
		});

		test("handleToolError emits TOOL_CALL_END", async () => {
			const mockCallback = createMockCallback();
			const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
			const toolRunId = "run-tool";
			const parentRunId = "run-parent";

			await handler.handleLLMStart(null, [], toolRunId, parentRunId);
			const parentMessageId = (handler as any).latestMessageIds.get(
				parentRunId,
			);

			await handler.handleToolStart(
				{ name: "weather_tool" },
				JSON.stringify({ id: "tc-1", name: "weather_tool", args: {} }),
				toolRunId,
				parentRunId,
			);

			await handler.handleToolError(
				new Error("Test error"),
				toolRunId,
				parentRunId,
			);

			expect(mockCallback.emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "TOOL_CALL_END",
					toolCallId: "tc-1",
					// parentMessageId is not included in TOOL_CALL_END events
				}),
			);
		});
	});

	describe("Event Emission Control", () => {
		describe("enabled toggle", () => {
			test("when enabled=false, no LLM events are emitted", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					enabled: false,
				});
				const runId = "run-123";

				await handler.handleLLMStart(null, ["prompt"], runId);
				await handler.handleLLMNewToken("Hello", null, runId);
				await handler.handleLLMEnd({}, runId);

				expect(mockCallback.emit).not.toHaveBeenCalled();
				expect((handler as any).messageIds.has(runId)).toBe(false);
			});

			test("when enabled=false, no tool events are emitted", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					enabled: false,
				});
				const toolRunId = "run-tool";
				const parentRunId = "run-parent";

				await handler.handleToolStart(
					{ name: "weather_tool" },
					JSON.stringify({ id: "tc-1", name: "weather_tool", args: {} }),
					toolRunId,
					parentRunId,
				);
				await handler.handleToolEnd('{"temp":72}', toolRunId, parentRunId);

				expect(mockCallback.emit).not.toHaveBeenCalled();
			});

			test("detectAndEmitThinking emits thinking events from contentBlocks", async () => {
				// Test that thinking events are emitted when AIMessage contains reasoning contentBlocks
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
				const runId = "run-123";

				await handler.handleLLMStart(null, ["prompt"], runId);

				// Mock an AIMessage with reasoning contentBlocks (Anthropic/Google style)
				const output = {
					generations: [
						[
							{
								message: {
									_getType: () => "ai",
									contentBlocks: [
										{
											type: "reasoning",
											reasoning: "First, I need to analyze the problem.",
										},
										{
											type: "reasoning",
											reasoning: "Then, I'll plan the solution steps.",
										},
										{
											type: "text",
											text: "Here is the answer to your question.",
										},
									],
								},
							},
						],
					],
				};

				await handler.handleLLMEnd(output, runId);

				// Should emit complete thinking cycle
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({ type: "THINKING_START" }),
				);
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({ type: "THINKING_TEXT_MESSAGE_START" }),
				);
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({
						type: "THINKING_TEXT_MESSAGE_CONTENT",
						delta:
							"First, I need to analyze the problem.Then, I'll plan the solution steps.",
					}),
				);
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({ type: "THINKING_TEXT_MESSAGE_END" }),
				);
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({ type: "THINKING_END" }),
				);

				// Should also emit text message events
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({ type: "TEXT_MESSAGE_START" }),
				);
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({ type: "TEXT_MESSAGE_END" }),
				);
			});

			test("detectAndEmitThinking emits multiple thinking cycles for different indices", async () => {
				// Test interleaved thinking pattern: think -> respond -> tool -> think -> respond
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
				const runId = "run-123";

				await handler.handleLLMStart(null, ["prompt"], runId);

				// Mock an AIMessage with multiple reasoning phases (interleaved thinking)
				const output = {
					generations: [
						[
							{
								message: {
									_getType: () => "ai",
									contentBlocks: [
										{
											type: "reasoning",
											reasoning: "Initial analysis phase",
											index: 0,
										},
										{
											type: "text",
											text: "First response after initial thinking",
										},
										{
											type: "reasoning",
											reasoning: "Post-tool reflection",
											index: 1,
										},
										{
											type: "text",
											text: "Final response after second thinking phase",
										},
									],
								},
							},
						],
					],
				};

				await handler.handleLLMEnd(output, runId);

				// Should emit TWO complete thinking cycles (one per index)
				const emitCalls = mockCallback.emit.mock.calls;

				// Count thinking cycles
				const thinkingStartCalls = emitCalls.filter(
					(call: any[]) => call[0]?.type === "THINKING_START",
				);
				const thinkingEndCalls = emitCalls.filter(
					(call: any[]) => call[0]?.type === "THINKING_END",
				);
				const thinkingContentCalls = emitCalls.filter(
					(call: any[]) => call[0]?.type === "THINKING_TEXT_MESSAGE_CONTENT",
				);

				expect(thinkingStartCalls).toHaveLength(2);
				expect(thinkingEndCalls).toHaveLength(2);
				expect(thinkingContentCalls).toHaveLength(2);

				// Verify first thinking phase content
				expect(thinkingContentCalls[0][0].delta).toBe("Initial analysis phase");

				// Verify second thinking phase content
				expect(thinkingContentCalls[1][0].delta).toBe("Post-tool reflection");

				// Should still emit text message events
				const textMessageStartCalls = emitCalls.filter(
					(call: any[]) => call[0]?.type === "TEXT_MESSAGE_START",
				);
				const textMessageEndCalls = emitCalls.filter(
					(call: any[]) => call[0]?.type === "TEXT_MESSAGE_END",
				);
				expect(textMessageStartCalls.length).toBeGreaterThan(0);
				expect(textMessageEndCalls.length).toBeGreaterThan(0);
			});

			test("blocks without explicit index are grouped under index 0", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
				const runId = "run-123";

				await handler.handleLLMStart(null, ["prompt"], runId);

				// Mock an AIMessage with reasoning blocks, some without explicit index
				const output = {
					generations: [
						[
							{
								message: {
									_getType: () => "ai",
									contentBlocks: [
										{
											type: "reasoning",
											reasoning: "First thought without index",
										},
										{
											type: "reasoning",
											reasoning: "Second thought without index",
										},
										{
											type: "reasoning",
											reasoning: "Third thought without index",
										},
									],
								},
							},
						],
					],
				};

				await handler.handleLLMEnd(output, runId);

				// Should emit ONE complete thinking cycle (all under index 0)
				const emitCalls = mockCallback.emit.mock.calls;

				const thinkingStartCalls = emitCalls.filter(
					(call: any[]) => call[0]?.type === "THINKING_START",
				);
				const thinkingEndCalls = emitCalls.filter(
					(call: any[]) => call[0]?.type === "THINKING_END",
				);
				const thinkingContentCalls = emitCalls.filter(
					(call: any[]) => call[0]?.type === "THINKING_TEXT_MESSAGE_CONTENT",
				);

				expect(thinkingStartCalls).toHaveLength(1);
				expect(thinkingEndCalls).toHaveLength(1);
				expect(thinkingContentCalls).toHaveLength(1);

				// Verify aggregated content (all three blocks joined)
				expect(thinkingContentCalls[0][0].delta).toBe(
					"First thought without indexSecond thought without indexThird thought without index",
				);
			});

			test("enabled can be toggled at runtime", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
				const runId = "run-123";

				// First call with enabled=true
				await handler.handleLLMStart(null, ["prompt"], runId);
				expect(mockCallback.emit).toHaveBeenCalled();

				// Reset mock
				mockCallback.emit.mockClear();

				// Disable and call again
				handler.enabled = false;
				const runId2 = "run-456";
				await handler.handleLLMStart(null, ["prompt"], runId2);
				await handler.handleLLMEnd({}, runId2);

				expect(mockCallback.emit).not.toHaveBeenCalled();

				// Re-enable and verify events resume
				handler.enabled = true;
				const runId3 = "run-789";
				await handler.handleLLMStart(null, ["prompt"], runId3);
				expect(mockCallback.emit).toHaveBeenCalled();
			});

			test("tool calls are collected even when enabled=false but emitToolCalls=true", async () => {
				// This verifies that handleLLMEnd collects tool calls from output
				// even when disabled, so subsequent tool callbacks have the data they need
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					enabled: false,
					emitToolCalls: true,
				});
				const runId = "run-123";

				// LLM outputs tool calls in its response
				const output = {
					tool_calls: [
						{
							id: "tc-1",
							function: { name: "weather_tool", arguments: '{"city":"NYC"}' },
						},
					],
				};

				await handler.handleLLMEnd(output, runId);

				// Verify tool call was collected for subsequent callbacks
				const toolCallNames = (handler as any).toolCallNames;
				expect(toolCallNames.get("tc-1")).toBe("weather_tool");

				const accumulatedToolArgs = (handler as any).accumulatedToolArgs;
				expect(accumulatedToolArgs.get("tc-1")).toBe('{"city":"NYC"}');

				// But no events were emitted
				expect(mockCallback.emit).not.toHaveBeenCalled();
			});

			test("enabled=false is respected by emitTextChunk", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					enabled: false,
				});

				await handler.emitTextChunk("msg-123", "assistant", "Hello");

				expect(mockCallback.emit).not.toHaveBeenCalled();
			});

			test("enabled=false is respected by emitToolChunk", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					enabled: false,
				});

				await handler.emitToolChunk("tc-123", "weather_tool", '{"city":"NYC"}');

				expect(mockCallback.emit).not.toHaveBeenCalled();
			});
		});

		describe("emitTextMessages toggle", () => {
			test("when emitTextMessages=false, TEXT_MESSAGE events are suppressed", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					emitTextMessages: false,
				});
				const runId = "run-123";

				await handler.handleLLMStart(null, ["prompt"], runId);
				await handler.handleLLMNewToken("Hello", null, runId);
				await handler.handleLLMEnd({}, runId);

				// No TEXT_MESSAGE events should be emitted
				const emitCalls = mockCallback.emit.mock.calls;
				const textMessageEvents = emitCalls.filter((call: any[]) =>
					call[0]?.type?.startsWith("TEXT_MESSAGE"),
				);
				expect(textMessageEvents).toHaveLength(0);
			});

			test("when emitTextMessages=false, thinking events are also suppressed (coupled)", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					emitTextMessages: false,
				});
				const runId = "run-123";

				await handler.handleLLMStart(null, ["prompt"], runId);

				// Mock an AIMessage with reasoning contentBlocks
				const output = {
					generations: [
						[
							{
								message: {
									_getType: () => "ai",
									contentBlocks: [
										{
											type: "reasoning",
											reasoning: "Thinking about the problem.",
										},
										{ type: "text", text: "Here is the answer." },
									],
								},
							},
						],
					],
				};

				await handler.handleLLMEnd(output, runId);

				// Both TEXT_MESSAGE and THINKING events should be suppressed
				const emitCalls = mockCallback.emit.mock.calls;
				const textMessageEvents = emitCalls.filter((call: any[]) =>
					call[0]?.type?.startsWith("TEXT_MESSAGE"),
				);
				const thinkingEvents = emitCalls.filter((call: any[]) =>
					call[0]?.type?.startsWith("THINKING"),
				);
				expect(textMessageEvents).toHaveLength(0);
				expect(thinkingEvents).toHaveLength(0);
			});

			test("emitTextMessages can be toggled at runtime", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
				const runId = "run-123";

				// First call with emitTextMessages=true
				await handler.handleLLMStart(null, ["prompt"], runId);
				expect(mockCallback.emit).toHaveBeenCalled();

				mockCallback.emit.mockClear();

				// Disable and call again
				handler.emitTextMessages = false;
				const runId2 = "run-456";
				await handler.handleLLMStart(null, ["prompt"], runId2);

				// Provide reasoning content - should be suppressed since emitTextMessages=false
				const outputWithThinking = {
					generations: [
						[
							{
								message: {
									_getType: () => "ai",
									contentBlocks: [
										{ type: "reasoning", reasoning: "Thinking content" },
										{ type: "text", text: "Response text" },
									],
								},
							},
						],
					],
				};

				await handler.handleLLMEnd(outputWithThinking, runId2);

				// No TEXT_MESSAGE events
				const emitCalls = mockCallback.emit.mock.calls;
				const textMessageEvents = emitCalls.filter((call: any[]) =>
					call[0]?.type?.startsWith("TEXT_MESSAGE"),
				);
				expect(textMessageEvents).toHaveLength(0);

				// No THINKING events (coupled with emitTextMessages)
				const thinkingEvents = emitCalls.filter((call: any[]) =>
					call[0]?.type?.startsWith("THINKING"),
				);
				expect(thinkingEvents).toHaveLength(0);
			});
		});

		describe("emitToolCalls toggle", () => {
			test("when emitToolCalls=false, TOOL_CALL events are suppressed", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					emitToolCalls: false,
				});
				const toolRunId = "run-tool";
				const parentRunId = "run-parent";

				await handler.handleToolStart(
					{ name: "weather_tool" },
					JSON.stringify({ id: "tc-1", name: "weather_tool", args: {} }),
					toolRunId,
					parentRunId,
				);
				await handler.handleToolEnd('{"temp":72}', toolRunId, parentRunId);

				// No TOOL_CALL events should be emitted
				const emitCalls = mockCallback.emit.mock.calls;
				const toolCallEvents = emitCalls.filter((call: any[]) =>
					call[0]?.type?.startsWith("TOOL_CALL"),
				);
				expect(toolCallEvents).toHaveLength(0);
			});

			test("when emitToolCalls=false, TEXT_MESSAGE events still work", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					emitToolCalls: false,
				});
				const runId = "run-123";

				await handler.handleLLMStart(null, ["prompt"], runId);
				await handler.handleLLMNewToken("Hello", null, runId);
				await handler.handleLLMEnd({}, runId);

				// TEXT_MESSAGE events should still be emitted
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({ type: "TEXT_MESSAGE_START" }),
				);
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({ type: "TEXT_MESSAGE_CONTENT" }),
				);
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({ type: "TEXT_MESSAGE_END" }),
				);
			});

			test("emitToolCalls can be toggled at runtime", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
				const toolRunId = "run-tool";
				const parentRunId = "run-parent";

				// First call with emitToolCalls=true
				await handler.handleToolStart(
					{ name: "weather_tool" },
					JSON.stringify({ id: "tc-1", name: "weather_tool", args: {} }),
					toolRunId,
					parentRunId,
				);
				expect(mockCallback.emit).toHaveBeenCalled();

				mockCallback.emit.mockClear();

				// Disable and call again
				handler.emitToolCalls = false;
				const toolRunId2 = "run-tool-2";
				await handler.handleToolStart(
					{ name: "weather_tool" },
					JSON.stringify({ id: "tc-2", name: "weather_tool", args: {} }),
					toolRunId2,
					parentRunId,
				);
				await handler.handleToolEnd('{"temp":73}', toolRunId2, parentRunId);

				expect(mockCallback.emit).not.toHaveBeenCalled();
			});
		});

		describe("emitThinking toggle", () => {
			test("when emitThinking=false, THINKING events are suppressed", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					emitThinking: false,
				});
				const runId = "run-123";

				await handler.handleLLMStart(null, ["prompt"], runId);

				// Mock an AIMessage with reasoning contentBlocks
				const output = {
					generations: [
						[
							{
								message: {
									_getType: () => "ai",
									contentBlocks: [
										{
											type: "reasoning",
											reasoning: "Thinking about the problem.",
										},
										{ type: "text", text: "Here is the answer." },
									],
								},
							},
						],
					],
				};

				await handler.handleLLMEnd(output, runId);

				// No THINKING events should be emitted
				const emitCalls = mockCallback.emit.mock.calls;
				const thinkingEvents = emitCalls.filter((call: any[]) =>
					call[0]?.type?.startsWith("THINKING"),
				);
				expect(thinkingEvents).toHaveLength(0);

				// TEXT_MESSAGE events should still be emitted
				const textMessageEvents = emitCalls.filter((call: any[]) =>
					call[0]?.type?.startsWith("TEXT_MESSAGE"),
				);
				expect(textMessageEvents.length).toBeGreaterThan(0);
			});

			test("when emitThinking=false, TEXT_MESSAGE events still work", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					emitThinking: false,
				});
				const runId = "run-123";

				await handler.handleLLMStart(null, ["prompt"], runId);
				await handler.handleLLMNewToken("Hello", null, runId);
				await handler.handleLLMEnd({}, runId);

				// TEXT_MESSAGE events should still be emitted
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({ type: "TEXT_MESSAGE_START" }),
				);
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({ type: "TEXT_MESSAGE_CONTENT" }),
				);
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({ type: "TEXT_MESSAGE_END" }),
				);
			});

			test("emitThinking can be toggled at runtime", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
				const runId = "run-123";

				// First call with emitThinking=true
				await handler.handleLLMStart(null, ["prompt"], runId);

				const outputWithThinking = {
					generations: [
						[
							{
								message: {
									_getType: () => "ai",
									contentBlocks: [
										{
											type: "reasoning",
											reasoning: "Thinking about the problem.",
										},
										{ type: "text", text: "Here is the answer." },
									],
								},
							},
						],
					],
				};

				await handler.handleLLMEnd(outputWithThinking, runId);
				expect(mockCallback.emit).toHaveBeenCalledWith(
					expect.objectContaining({ type: "THINKING_START" }),
				);

				mockCallback.emit.mockClear();

				// Disable and call again
				handler.emitThinking = false;
				const runId2 = "run-456";
				await handler.handleLLMStart(null, ["prompt"], runId2);

				const outputWithoutThinking = {
					generations: [
						[
							{
								message: {
									_getType: () => "ai",
									contentBlocks: [
										{ type: "reasoning", reasoning: "More thinking." },
										{ type: "text", text: "Another answer." },
									],
								},
							},
						],
					],
				};

				await handler.handleLLMEnd(outputWithoutThinking, runId2);

				// No THINKING events
				const emitCalls = mockCallback.emit.mock.calls;
				const thinkingEvents = emitCalls.filter((call: any[]) =>
					call[0]?.type?.startsWith("THINKING"),
				);
				expect(thinkingEvents).toHaveLength(0);
			});
		});

		describe("combined toggles", () => {
			test("enabled=false overrides all other settings", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					enabled: false,
					emitTextMessages: true,
					emitToolCalls: true,
					emitThinking: true,
				});
				const runId = "run-123";

				await handler.handleLLMStart(null, ["prompt"], runId);

				// Mock an AIMessage with reasoning contentBlocks
				const output = {
					generations: [
						[
							{
								message: {
									_getType: () => "ai",
									contentBlocks: [
										{
											type: "reasoning",
											reasoning: "Thinking about the problem.",
										},
										{ type: "text", text: "Here is the answer." },
									],
								},
							},
						],
					],
				};

				await handler.handleLLMEnd(output, runId);

				expect(mockCallback.emit).not.toHaveBeenCalled();
			});

			test("emitTextMessages=false and emitThinking=false together", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					emitTextMessages: false,
					emitThinking: false,
				});
				const runId = "run-123";

				await handler.handleLLMStart(null, ["prompt"], runId);

				// Mock an AIMessage with reasoning contentBlocks
				const output = {
					generations: [
						[
							{
								message: {
									_getType: () => "ai",
									contentBlocks: [
										{
											type: "reasoning",
											reasoning: "Thinking about the problem.",
										},
										{ type: "text", text: "Here is the answer." },
									],
								},
							},
						],
					],
				};

				await handler.handleLLMEnd(output, runId);

				// Both TEXT_MESSAGE and THINKING events should be suppressed
				const emitCalls = mockCallback.emit.mock.calls;
				const eventsWithContent = emitCalls.filter(
					(call: any[]) =>
						call[0]?.type?.startsWith("TEXT_MESSAGE") ||
						call[0]?.type?.startsWith("THINKING"),
				);
				expect(eventsWithContent).toHaveLength(0);
			});

			test("all options can be configured via constructor", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
					enabled: true,
					emitTextMessages: true,
					emitToolCalls: true,
					emitThinking: true,
				});

				expect(handler.enabled).toBe(true);
				expect(handler.emitTextMessages).toBe(true);
				expect(handler.emitToolCalls).toBe(true);
				expect(handler.emitThinking).toBe(true);
			});

			test("default values are all true", async () => {
				const mockCallback = createMockCallback();
				const handler = new AGUICallbackHandler({
					onEvent: mockCallback.emit,
				});

				expect(handler.enabled).toBe(true);
				expect(handler.emitTextMessages).toBe(true);
				expect(handler.emitToolCalls).toBe(true);
				expect(handler.emitThinking).toBe(true);
			});
		});
	});
});
