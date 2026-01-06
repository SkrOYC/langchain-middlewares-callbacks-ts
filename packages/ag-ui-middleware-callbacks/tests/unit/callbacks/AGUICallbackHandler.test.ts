import { test, expect, describe } from "bun:test";
import { createMockTransport } from "../../fixtures/mockTransport";
import { AGUICallbackHandler } from "../../../src/callbacks/AGUICallbackHandler";

describe("AGUICallbackHandler", () => {
  test("is instantiated correctly", () => {
    const mockTransport = createMockTransport();
    const handler = new AGUICallbackHandler(mockTransport);

    expect(handler).toBeDefined();
    expect(handler.name).toBe("ag-ui-callback");
  });

  describe("LLM Callbacks", () => {
    test("handleLLMStart generates messageId internally and emits TEXT_MESSAGE_START", async () => {
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
      const runId = "run-123";
      const parentRunId = "run-parent";

      await handler.handleLLMStart(null, ["prompt"], runId, parentRunId, undefined, undefined, undefined);

      const messageId = (handler as any).messageIds.get(runId);
      expect(messageId).toBeDefined();
      expect(typeof messageId).toBe("string");

      // Should emit TEXT_MESSAGE_START (Callback responsibility)
      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TEXT_MESSAGE_START",
          messageId: expect.any(String),
          role: "assistant",
        })
      );
    });

    test("handleLLMNewToken emits TEXT_MESSAGE_CONTENT", async () => {
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
      const runId = "run-123";
      const messageId = "msg-abc";

      (handler as any).messageIds.set(runId, messageId);
      await handler.handleLLMNewToken("Hello", null, runId);

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TEXT_MESSAGE_CONTENT",
          messageId,
          delta: "Hello",
        })
      );
    });

    test("handleLLMNewToken detects and emits Thinking events", async () => {
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
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

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "THINKING_START",
          messageId: expect.any(String),
        })
      );

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "THINKING_TEXT_MESSAGE_START",
          messageId: expect.any(String),
        })
      );

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "THINKING_TEXT_MESSAGE_CONTENT",
          messageId: expect.any(String),
          delta: "I should use a tool to check => weather.",
        })
      );
    });

    test("handleLLMEnd emits THINKING_TEXT_MESSAGE_END, THINKING_END, and TEXT_MESSAGE_END", async () => {
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
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
      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "THINKING_TEXT_MESSAGE_END",
          messageId: expect.any(String),
        })
      );

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "THINKING_END",
          messageId: expect.any(String),
        })
      );

      // Should emit TEXT_MESSAGE_END (Callback responsibility)
      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TEXT_MESSAGE_END",
          messageId: messageId,
        })
      );
    });

    test("handleLLMError cleans up maps", async () => {
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
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
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
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

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TOOL_CALL_START",
          toolCallId: "tc-1",
          toolCallName: "weather_tool",
          parentMessageId,
        })
      );
    });

    test("handleToolEnd emits TOOL_CALL_RESULT and cleans up", async () => {
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
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

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TOOL_CALL_END",
          toolCallId: "tc-1",
          parentMessageId,
        })
      );

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TOOL_CALL_RESULT",
          toolCallId: "tc-1",
          parentMessageId,
          content: '{"temp":72}',
          role: "tool",
        })
      );

      expect((handler as any).toolCallInfo.has(toolRunId)).toBe(false);
    });

    test("handleToolError emits TOOL_CALL_END", async () => {
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
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

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TOOL_CALL_END",
          toolCallId: "tc-1",
          parentMessageId: (handler as any).latestMessageIds.get(parentRunId),
        })
      );
    });
  });
});
