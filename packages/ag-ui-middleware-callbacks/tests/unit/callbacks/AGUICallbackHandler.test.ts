import { test, expect, describe } from "bun:test";
import { createMockCallback } from "../../fixtures/mockTransport";
import { AGUICallbackHandler } from "../../../src/callbacks/AGUICallbackHandler";

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

      await handler.handleLLMStart(null, ["prompt"], runId, parentRunId, undefined, undefined, undefined);

      const messageId = (handler as any).messageIds.get(runId);
      expect(messageId).toBeDefined();
      expect(typeof messageId).toBe("string");

      // Should emit TEXT_MESSAGE_START (Callback responsibility)
      expect(mockCallback.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TEXT_MESSAGE_START",
          messageId: expect.any(String),
          role: "assistant",
        })
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
        })
      );
    });

    test("handleLLMNewToken detects and emits Thinking events", async () => {
      const mockCallback = createMockCallback();
      const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
      const runId = "run-123";
      const messageId = "msg-abc";

      (handler as any).messageIds.set(runId, messageId);
      await handler.handleLLMStart(null, [], runId);

      // Mock a chunk with reasoning content (DeepSeek style)
      await handler.handleLLMNewToken(
        "",
        null,
        runId,
        undefined,
        undefined,
        {
          chunk: {
            message: {
              additional_kwargs: {
                reasoning_content: "I should use a tool to check => weather."
              }
            }
          }
        }
      );

      expect((handler as any).thinkingIds.get(runId)).toBeDefined();

      expect(mockCallback.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "THINKING_START",
          // messageId is not included in thinking events (they're separate from main message flow)
        })
      );

      expect(mockCallback.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "THINKING_TEXT_MESSAGE_START",
          // messageId is not included in thinking events
        })
      );

      expect(mockCallback.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "THINKING_TEXT_MESSAGE_CONTENT",
          delta: "I should use a tool to check => weather.",
        })
      );
    });

    test("handleLLMEnd emits THINKING_TEXT_MESSAGE_END, THINKING_END, and TEXT_MESSAGE_END", async () => {
      const mockCallback = createMockCallback();
      const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
      const runId = "run-123";
      const messageId = "msg-abc";

      (handler as any).messageIds.set(runId, messageId);

      // Trigger some reasoning first
      await handler.handleLLMNewToken(
        "",
        null,
        runId,
        undefined,
        undefined,
        {
          chunk: {
            message: {
              additional_kwargs: {
                reasoning_content: "thinking content"
              }
            }
          }
        }
      );

      await handler.handleLLMEnd({}, runId);

      // Should emit thinking end events
      expect(mockCallback.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "THINKING_TEXT_MESSAGE_END",
          // messageId is not included in thinking events
        })
      );

      expect(mockCallback.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "THINKING_END",
          // messageId is not included in thinking events
        })
      );

      // Should emit TEXT_MESSAGE_END (Callback responsibility)
      expect(mockCallback.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TEXT_MESSAGE_END",
          messageId: messageId,
        })
      );
    });

    test("handleLLMError cleans up maps", async () => {
      const mockCallback = createMockCallback();
      const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
      const runId = "run-123";

      await handler.handleLLMStart(null, [], runId);
      await handler.handleLLMNewToken("", null, runId, undefined, undefined, {
        chunk: {
          message: {
            additional_kwargs: {
              reasoning_content: "test reasoning"
            }
          }
        }
      });

      await handler.handleLLMError(new Error("Test error"), runId);

      expect((handler as any).messageIds.get(runId)).toBeUndefined();
      expect((handler as any).thinkingIds.get(runId)).toBeUndefined();
    });
  });

  describe("Tool Callbacks", () => {
    test("handleToolStart emits TOOL_CALL_START with parentMessageId even after LLM end (Red Phase)", async () => {
      const mockCallback = createMockCallback();
      const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
      const parentRunId = "run-parent";
      const toolRunId = "run-tool";

      await handler.handleLLMStart(null, [], toolRunId, parentRunId);
      const parentMessageId = (handler as any).latestMessageIds.get(parentRunId);

      // End LLM run
      await handler.handleLLMEnd({}, toolRunId);

      // Start tool call - should use parent message
      await handler.handleToolStart(
        { name: "weather_tool" },
        JSON.stringify({ id: "tc-1", name: "weather_tool", args: {} }),
        toolRunId,
        parentRunId
      );

      expect(mockCallback.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TOOL_CALL_START",
          toolCallId: "tc-1",
          toolCallName: "weather_tool",
          parentMessageId,
        })
      );
    });

    test("handleToolEnd emits TOOL_CALL_RESULT and cleans up", async () => {
      const mockCallback = createMockCallback();
      const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
      const toolRunId = "run-tool";
      const parentRunId = "run-parent";

      await handler.handleLLMStart(null, [], toolRunId, parentRunId);
      const parentMessageId = (handler as any).latestMessageIds.get(parentRunId);

      await handler.handleToolStart(
        { name: "weather_tool" },
        JSON.stringify({ id: "tc-1", name: "weather_tool", args: {} }),
        toolRunId,
        parentRunId
      );

      await handler.handleToolEnd('{"temp":72}', toolRunId, parentRunId);

      expect(mockCallback.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TOOL_CALL_END",
          toolCallId: "tc-1",
          // parentMessageId is not included in TOOL_CALL_END events
        })
      );

      expect(mockCallback.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TOOL_CALL_RESULT",
          toolCallId: "tc-1",
          content: '{"temp":72}',
          role: "tool",
        })
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
        parentRunId
      );

      // End tool call with output containing DIFFERENT tool_call_id (UUID v4 format - random)
      // This simulates LangChain sometimes providing different IDs in the response
      const outputWithDifferentId = {
        kwargs: {
          tool_call_id: "14644ccc-1274-4f58-b80f-589650f0edb5",
        },
      };
      await handler.handleToolEnd(outputWithDifferentId, toolRunId, parentRunId);

      // Extract all tool call events
      const toolCallStartEvents = mockCallback.events.filter(
        (e: any) => e.type === "TOOL_CALL_START"
      );
      const toolCallEndEvents = mockCallback.events.filter(
        (e: any) => e.type === "TOOL_CALL_END"
      );
      const toolCallResultEvents = mockCallback.events.filter(
        (e: any) => e.type === "TOOL_CALL_RESULT"
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
      expect(toolCallEndEvents[0].toolCallId).not.toBe("14644ccc-1274-4f58-b80f-589650f0edb5");
    });

    test("handleToolError emits TOOL_CALL_END", async () => {
      const mockCallback = createMockCallback();
      const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
      const toolRunId = "run-tool";
      const parentRunId = "run-parent";

      await handler.handleLLMStart(null, [], toolRunId, parentRunId);
      const parentMessageId = (handler as any).latestMessageIds.get(parentRunId);

      await handler.handleToolStart(
        { name: "weather_tool" },
        JSON.stringify({ id: "tc-1", name: "weather_tool", args: {} }),
        toolRunId,
        parentRunId
      );

      await handler.handleToolError(new Error("Test error"), toolRunId, parentRunId);

      expect(mockCallback.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TOOL_CALL_END",
          toolCallId: "tc-1",
          // parentMessageId is not included in TOOL_CALL_END events
        })
      );
    });
  });

  describe("Event Emission Control", () => {
    describe("enabled toggle", () => {
      test("when enabled=false, no LLM events are emitted", async () => {
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit, enabled: false });
        const runId = "run-123";

        await handler.handleLLMStart(null, ["prompt"], runId);
        await handler.handleLLMNewToken("Hello", null, runId);
        await handler.handleLLMEnd({}, runId);

        expect(mockCallback.emit).not.toHaveBeenCalled();
        expect((handler as any).messageIds.has(runId)).toBe(false);
      });

      test("when enabled=false, no tool events are emitted", async () => {
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit, enabled: false });
        const toolRunId = "run-tool";
        const parentRunId = "run-parent";

        await handler.handleToolStart(
          { name: "weather_tool" },
          JSON.stringify({ id: "tc-1", name: "weather_tool", args: {} }),
          toolRunId,
          parentRunId
        );
        await handler.handleToolEnd('{"temp":72}', toolRunId, parentRunId);

        expect(mockCallback.emit).not.toHaveBeenCalled();
      });

      test("when enabled=false, no thinking events are emitted", async () => {
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit, enabled: false });
        const runId = "run-123";

        await handler.handleLLMStart(null, [], runId);
        await handler.handleLLMNewToken("", null, runId, undefined, undefined, {
          chunk: {
            message: {
              additional_kwargs: {
                reasoning_content: "thinking content"
              }
            }
          }
        });
        await handler.handleLLMEnd({}, runId);

        expect(mockCallback.emit).not.toHaveBeenCalled();
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
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit, enabled: false, emitToolCalls: true });
        const runId = "run-123";

        // LLM outputs tool calls in its response
        const output = {
          tool_calls: [
            { id: "tc-1", function: { name: "weather_tool", arguments: '{"city":"NYC"}' } }
          ]
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
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit, enabled: false });

        await handler.emitTextChunk("msg-123", "assistant", "Hello");

        expect(mockCallback.emit).not.toHaveBeenCalled();
      });

      test("enabled=false is respected by emitToolChunk", async () => {
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit, enabled: false });

        await handler.emitToolChunk("tc-123", "weather_tool", '{"city":"NYC"}');

        expect(mockCallback.emit).not.toHaveBeenCalled();
      });
    });

    describe("emitTextMessages toggle", () => {
      test("when emitTextMessages=false, TEXT_MESSAGE events are suppressed", async () => {
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit, emitTextMessages: false });
        const runId = "run-123";

        await handler.handleLLMStart(null, ["prompt"], runId);
        await handler.handleLLMNewToken("Hello", null, runId);
        await handler.handleLLMEnd({}, runId);

        // No TEXT_MESSAGE events should be emitted
        const emitCalls = mockCallback.emit.mock.calls;
        const textMessageEvents = emitCalls.filter(
          (call: any[]) => call[0]?.type?.startsWith("TEXT_MESSAGE")
        );
        expect(textMessageEvents).toHaveLength(0);
      });

      test("when emitTextMessages=false, thinking events still work", async () => {
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit, emitTextMessages: false });
        const runId = "run-123";

        await handler.handleLLMStart(null, [], runId);
        await handler.handleLLMNewToken("", null, runId, undefined, undefined, {
          chunk: {
            message: {
              additional_kwargs: {
                reasoning_content: "thinking content"
              }
            }
          }
        });
        await handler.handleLLMEnd({}, runId);

        // Thinking events should still be emitted
        expect(mockCallback.emit).toHaveBeenCalledWith(
          expect.objectContaining({ type: "THINKING_START" })
        );
        expect(mockCallback.emit).toHaveBeenCalledWith(
          expect.objectContaining({ type: "THINKING_TEXT_MESSAGE_START" })
        );
        expect(mockCallback.emit).toHaveBeenCalledWith(
          expect.objectContaining({ type: "THINKING_TEXT_MESSAGE_CONTENT" })
        );
        expect(mockCallback.emit).toHaveBeenCalledWith(
          expect.objectContaining({ type: "THINKING_TEXT_MESSAGE_END" })
        );
        expect(mockCallback.emit).toHaveBeenCalledWith(
          expect.objectContaining({ type: "THINKING_END" })
        );
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
        await handler.handleLLMNewToken("Hello", null, runId2);
        await handler.handleLLMEnd({}, runId2);

        // No TEXT_MESSAGE events
        const emitCalls = mockCallback.emit.mock.calls;
        const textMessageEvents = emitCalls.filter(
          (call: any[]) => call[0]?.type?.startsWith("TEXT_MESSAGE")
        );
        expect(textMessageEvents).toHaveLength(0);
      });
    });

    describe("emitToolCalls toggle", () => {
      test("when emitToolCalls=false, TOOL_CALL events are suppressed", async () => {
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit, emitToolCalls: false });
        const toolRunId = "run-tool";
        const parentRunId = "run-parent";

        await handler.handleToolStart(
          { name: "weather_tool" },
          JSON.stringify({ id: "tc-1", name: "weather_tool", args: {} }),
          toolRunId,
          parentRunId
        );
        await handler.handleToolEnd('{"temp":72}', toolRunId, parentRunId);

        // No TOOL_CALL events should be emitted
        const emitCalls = mockCallback.emit.mock.calls;
        const toolCallEvents = emitCalls.filter(
          (call: any[]) => call[0]?.type?.startsWith("TOOL_CALL")
        );
        expect(toolCallEvents).toHaveLength(0);
      });

      test("when emitToolCalls=false, TEXT_MESSAGE events still work", async () => {
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit, emitToolCalls: false });
        const runId = "run-123";

        await handler.handleLLMStart(null, ["prompt"], runId);
        await handler.handleLLMNewToken("Hello", null, runId);
        await handler.handleLLMEnd({}, runId);

        // TEXT_MESSAGE events should still be emitted
        expect(mockCallback.emit).toHaveBeenCalledWith(
          expect.objectContaining({ type: "TEXT_MESSAGE_START" })
        );
        expect(mockCallback.emit).toHaveBeenCalledWith(
          expect.objectContaining({ type: "TEXT_MESSAGE_CONTENT" })
        );
        expect(mockCallback.emit).toHaveBeenCalledWith(
          expect.objectContaining({ type: "TEXT_MESSAGE_END" })
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
          parentRunId
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
          parentRunId
        );
        await handler.handleToolEnd('{"temp":73}', toolRunId2, parentRunId);

        expect(mockCallback.emit).not.toHaveBeenCalled();
      });
    });

    describe("emitThinking toggle", () => {
      test("when emitThinking=false, THINKING events are suppressed", async () => {
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit, emitThinking: false });
        const runId = "run-123";

        await handler.handleLLMStart(null, [], runId);
        await handler.handleLLMNewToken("", null, runId, undefined, undefined, {
          chunk: {
            message: {
              additional_kwargs: {
                reasoning_content: "thinking content"
              }
            }
          }
        });
        await handler.handleLLMEnd({}, runId);

        // No THINKING events should be emitted
        const emitCalls = mockCallback.emit.mock.calls;
        const thinkingEvents = emitCalls.filter(
          (call: any[]) => call[0]?.type?.startsWith("THINKING")
        );
        expect(thinkingEvents).toHaveLength(0);
      });

      test("when emitThinking=false, TEXT_MESSAGE events still work", async () => {
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit, emitThinking: false });
        const runId = "run-123";

        await handler.handleLLMStart(null, [], runId);
        await handler.handleLLMNewToken("Hello", null, runId);
        await handler.handleLLMEnd({}, runId);

        // TEXT_MESSAGE events should still be emitted
        expect(mockCallback.emit).toHaveBeenCalledWith(
          expect.objectContaining({ type: "TEXT_MESSAGE_START" })
        );
        expect(mockCallback.emit).toHaveBeenCalledWith(
          expect.objectContaining({ type: "TEXT_MESSAGE_CONTENT" })
        );
        expect(mockCallback.emit).toHaveBeenCalledWith(
          expect.objectContaining({ type: "TEXT_MESSAGE_END" })
        );
      });

      test("emitThinking can be toggled at runtime", async () => {
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
        const runId = "run-123";

        // First call with emitThinking=true
        await handler.handleLLMStart(null, [], runId);
        await handler.handleLLMNewToken("", null, runId, undefined, undefined, {
          chunk: {
            message: {
              additional_kwargs: {
                reasoning_content: "thinking content"
              }
            }
          }
        });
        await handler.handleLLMEnd({}, runId);
        expect(mockCallback.emit).toHaveBeenCalledWith(
          expect.objectContaining({ type: "THINKING_START" })
        );

        mockCallback.emit.mockClear();

        // Disable and call again
        handler.emitThinking = false;
        const runId2 = "run-456";
        await handler.handleLLMStart(null, [], runId2);
        await handler.handleLLMNewToken("", null, runId2, undefined, undefined, {
          chunk: {
            message: {
              additional_kwargs: {
                reasoning_content: "more thinking"
              }
            }
          }
        });
        await handler.handleLLMEnd({}, runId2);

        // No THINKING events
        const emitCalls = mockCallback.emit.mock.calls;
        const thinkingEvents = emitCalls.filter(
          (call: any[]) => call[0]?.type?.startsWith("THINKING")
        );
        expect(thinkingEvents).toHaveLength(0);
      });

      test("thinkingIds is cleaned up even when emitThinking=false", async () => {
        // Regression test: ensure thinkingIds map is cleaned up even when
        // emitThinking is toggled off before handleLLMEnd
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({ onEvent: mockCallback.emit });
        const runId = "run-123";

        // Start LLM with thinking
        await handler.handleLLMStart(null, [], runId);
        await handler.handleLLMNewToken("", null, runId, undefined, undefined, {
          chunk: {
            message: {
              additional_kwargs: {
                reasoning_content: "thinking content"
              }
            }
          }
        });

        // Verify thinkingId was created
        expect((handler as any).thinkingIds.has(runId)).toBe(true);

        // Toggle emitThinking off before handleLLMEnd
        handler.emitThinking = false;
        await handler.handleLLMEnd({}, runId);

        // thinkingIds should still be cleaned up (no memory leak)
        expect((handler as any).thinkingIds.has(runId)).toBe(false);
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
          emitThinking: true
        });
        const runId = "run-123";

        await handler.handleLLMStart(null, ["prompt"], runId);
        await handler.handleLLMNewToken("", null, runId, undefined, undefined, {
          chunk: {
            message: {
              additional_kwargs: {
                reasoning_content: "thinking content"
              }
            }
          }
        });
        await handler.handleLLMEnd({}, runId);

        expect(mockCallback.emit).not.toHaveBeenCalled();
      });

      test("emitTextMessages=false and emitThinking=false together", async () => {
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({
          onEvent: mockCallback.emit,
          emitTextMessages: false,
          emitThinking: false
        });
        const runId = "run-123";

        await handler.handleLLMStart(null, [], runId);
        await handler.handleLLMNewToken("", null, runId, undefined, undefined, {
          chunk: {
            message: {
              additional_kwargs: {
                reasoning_content: "thinking content"
              }
            }
          }
        });
        await handler.handleLLMEnd({}, runId);

        // Only TEXT_MESSAGE events should be suppressed, but we also disabled thinking
        // So nothing should be emitted
        const emitCalls = mockCallback.emit.mock.calls;
        const eventsWithContent = emitCalls.filter(
          (call: any[]) => call[0]?.type?.startsWith("TEXT_MESSAGE") ||
                          call[0]?.type?.startsWith("THINKING")
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
          emitThinking: true
        });

        expect(handler.enabled).toBe(true);
        expect(handler.emitTextMessages).toBe(true);
        expect(handler.emitToolCalls).toBe(true);
        expect(handler.emitThinking).toBe(true);
      });

      test("default values are all true", async () => {
        const mockCallback = createMockCallback();
        const handler = new AGUICallbackHandler({
          onEvent: mockCallback.emit
        });

        expect(handler.enabled).toBe(true);
        expect(handler.emitTextMessages).toBe(true);
        expect(handler.emitToolCalls).toBe(true);
        expect(handler.emitThinking).toBe(true);
      });
    });
  });
});
