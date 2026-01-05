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
    test("handleLLMStart generates messageId internally and sets it in the map", async () => {
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
      const runId = "run-123";

      await handler.handleLLMStart(null, ["prompt"], runId);

      // messageId should be generated internally
      const messageId = (handler as any).messageIds.get(runId);
      expect(messageId).toBeDefined();
      expect(typeof messageId).toBe("string");
      
      // Should NOT emit TEXT_MESSAGE_START anymore (Middleware responsibility)
      expect(mockTransport.emit).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TEXT_MESSAGE_START",
        })
      );
    });

    test("handleLLMNewToken emits TEXT_MESSAGE_CONTENT", async () => {
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
      const runId = "run-123";

      await handler.handleLLMStart(null, [], runId);
      const messageId = (handler as any).messageIds.get(runId);

      await handler.handleLLMNewToken("Hello", null, runId);

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TEXT_MESSAGE_CONTENT",
          messageId,
          delta: "Hello",
        })
      );
    });

    test("handleLLMNewToken detects and emits Reasoning events (Red Phase)", async () => {
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
      const runId = "run-123";

      await handler.handleLLMStart(null, [], runId);
      const messageId = (handler as any).messageIds.get(runId);

      // Mock a chunk with reasoning content (DeepSeek style)
      await handler.handleLLMNewToken(
        "", // empty token for reasoning
        null,
        runId,
        undefined,
        undefined,
        {
          chunk: {
            message: {
              additional_kwargs: {
                reasoning_content: "I should use a tool to check the weather."
              }
            }
          }
        }
      );

      // Should emit REASONING_START (first time) and REASONING_MESSAGE_CONTENT
      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "REASONING_START",
          messageId: expect.any(String),
        })
      );

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "REASONING_MESSAGE_CONTENT",
          messageId: expect.any(String),
          delta: "I should use a tool to check the weather.",
        })
      );
    });

    test("handleLLMEnd emits REASONING_END but NOT TEXT_MESSAGE_END", async () => {
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
      const runId = "run-123";

      await handler.handleLLMStart(null, [], runId);
      const messageId = (handler as any).messageIds.get(runId);
      
      // Trigger some reasoning first
      await handler.handleLLMNewToken("", null, runId, undefined, undefined, {
        chunk: { message: { additional_kwargs: { reasoning_content: "thinking" } } }
      });

      await handler.handleLLMEnd({}, runId);

      // Should NOT emit TEXT_MESSAGE_END anymore (Middleware responsibility)
      expect(mockTransport.emit).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TEXT_MESSAGE_END",
          messageId,
        })
      );

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "REASONING_END",
          messageId: expect.any(String),
        })
      );
    });
  });

  describe("Tool Callbacks", () => {
    test("handleToolStart emits TOOL_CALL_START with parentMessageId even after LLM end (Red Phase)", async () => {
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
      const parentRunId = "run-parent";
      const toolRunId = "run-tool";

      await handler.handleLLMStart(null, [], parentRunId);
      const parentMessageId = (handler as any).messageIds.get(parentRunId);
      
      // End LLM run
      await handler.handleLLMEnd({}, parentRunId);

      // Start tool call in the same logical step
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
          parentMessageId,
        })
      );
    });

    test("handleToolEnd emits TOOL_CALL_RESULT and cleans up", async () => {
      const mockTransport = createMockTransport();
      const handler = new AGUICallbackHandler(mockTransport);
      const toolRunId = "run-tool";

      await handler.handleToolStart(
        { name: "weather_tool" },
        JSON.stringify({ id: "tc-1", name: "weather_tool", args: {} }),
        toolRunId
      );

      await handler.handleToolEnd('{"temp": 72}', toolRunId);

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TOOL_CALL_RESULT",
          toolCallId: "tc-1",
          content: '{"temp":72}',
          role: "tool",
        })
      );
      
      expect((handler as any).toolCallInfo.has(toolRunId)).toBe(false);
    });
  });
});
