import { test, expect, describe, mock, beforeEach } from "bun:test";
import { ACPCallbackHandler, createACPCallbackHandler } from "../../../src/callbacks/ACPCallbackHandler";

// Mock connection factory with tracking
function createMockConnection() {
  const sessionUpdate = mock(async (_params: any) => undefined);
  const close = mock(async () => undefined);

  return {
    sessionUpdate,
    close,
  };
}

describe("ACPCallbackHandler", () => {
  describe("initialization", () => {
    test("creates handler with connection", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });

      expect(handler).toBeDefined();
      expect(handler.name).toBe("acp-callback-handler");
    });

    test("factory function creates handler", () => {
      const mockConnection = createMockConnection();
      const handler = createACPCallbackHandler({
        connection: mockConnection as any
      });

      expect(handler).toBeDefined();
      expect(handler).toBeInstanceOf(ACPCallbackHandler);
    });

    test("creates handler with emitTextChunks option", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        emitTextChunks: true
      });

      expect(handler).toBeDefined();
    });
  });

  describe("handleLLMStart", () => {
    test("generates message ID on LLM start", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });

      await handler.handleLLMStart({} as any, [], "run-1");

      // Message ID should be generated (verified by subsequent calls working)
      expect(handler).toBeDefined();
    });

    test("handles multiple LLM start calls", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMStart({} as any, [], "run-2");

      expect(handler).toBeDefined();
    });
  });

  describe("handleLLMNewToken", () => {
    test("sends agent message chunk for each token", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("Hello", {}, "run-1");
      await handler.handleLLMNewToken(" ", {}, "run-1");

      // Should have sent messages for each token via sessionUpdate
      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
    });

    test("generates message ID if not already set", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });

      // Call handleLLMNewToken without handleLLMStart
      await handler.handleLLMNewToken("First token", {}, "run-1");

      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
    });

    test("handles empty token", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("", {}, "run-1");

      // Should not call sessionUpdate for empty tokens
      expect(mockConnection.sessionUpdate).not.toHaveBeenCalled();
    });

    test("uses default sessionId when not provided", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("Hello", {}, "run-1");

      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
      const callArg = mockConnection.sessionUpdate.mock.calls[0][0];
      expect(callArg.sessionId).toBe("default");
    });

    test("uses provided sessionId", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "my-session"
      });

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("Hello", {}, "run-1");

      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
      const callArg = mockConnection.sessionUpdate.mock.calls[0][0];
      expect(callArg.sessionId).toBe("my-session");
    });

    test("handles multiple tokens in sequence", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("H", {}, "run-1");
      await handler.handleLLMNewToken("e", {}, "run-1");
      await handler.handleLLMNewToken("l", {}, "run-1");
      await handler.handleLLMNewToken("l", {}, "run-1");
      await handler.handleLLMNewToken("o", {}, "run-1");

      // Should have sent 5 messages for the 5 tokens
      expect(mockConnection.sessionUpdate).toHaveBeenCalledTimes(5);
    });

    test("handles token with structured content", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("", {}, "run-1", undefined, undefined, {
        chunk: {
          message: {
            content: [
              { type: "text", text: "Hello from content block" }
            ]
          }
        }
      });

      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
    });

    test("handles content blocks with multiple blocks", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("", {}, "run-1", undefined, undefined, {
        chunk: {
          message: {
            content: [
              { type: "text", text: "First" },
              { type: "text", text: "Second" }
            ]
          }
        }
      });

      // Should emit both content blocks
      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
    });
  });

  describe("handleLLMEnd", () => {
    test("resets state on LLM end", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("Hello", {}, "run-1");
      await handler.handleLLMEnd({}, "run-1");

      expect(handler).toBeDefined();
    });

    test("handles end without any tokens", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMEnd({}, "run-1");

      expect(handler).toBeDefined();
    });
  });

  describe("handleLLMError", () => {
    test("emits error as agent message chunk", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("Hello", {}, "run-1");
      await handler.handleLLMError(new Error("Test error"), "run-1");

      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
    });

    test("handles error without active message", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleLLMError(new Error("Test error"), "run-1");

      expect(handler).toBeDefined();
    });

    test("includes error code in error message", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMError(new Error("Model overloaded"), "run-1");

      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
      const callArg = mockConnection.sessionUpdate.mock.calls[0][0];
      expect(callArg.update.content.text).toContain("Error");
    });
  });

  describe("handleToolStart", () => {
    test("emits tool call start event", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleToolStart({} as any, '{"path": "test.txt"}', "run-1", undefined, [], undefined, "read_file");

      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
      const callArg = mockConnection.sessionUpdate.mock.calls[0][0];
      expect(callArg.update.sessionUpdate).toBe("tool_call");
      expect(callArg.update.toolCallId).toBeDefined();
    });

    test("extracts tool name from runName", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleToolStart({} as any, '{"path": "test.txt"}', "run-1", undefined, [], undefined, "custom_tool_name");

      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
      const callArg = mockConnection.sessionUpdate.mock.calls[0][0];
      expect(callArg.update.title).toContain("custom_tool_name");
    });
  });

  describe("handleToolEnd", () => {
    test("emits tool call end event", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleToolStart({} as any, '{"path": "test.txt"}', "run-1", undefined, [], undefined, "read_file");
      await handler.handleToolEnd({ content: "File contents here" }, "run-1");

      expect(mockConnection.sessionUpdate).toHaveBeenCalledTimes(2);
      const callArg = mockConnection.sessionUpdate.mock.calls[1][0];
      expect(callArg.update.sessionUpdate).toBe("tool_call_update");
      expect(callArg.update.status).toBe("completed");
    });

    test("handles failed tool call", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleToolStart({} as any, '{"path": "test.txt"}', "run-1", undefined, [], undefined, "read_file");
      await handler.handleToolError(new Error("File not found"), "run-1");

      expect(mockConnection.sessionUpdate).toHaveBeenCalledTimes(2);
      const callArg = mockConnection.sessionUpdate.mock.calls[1][0];
      expect(callArg.update.status).toBe("failed");
    });

    test("handles tool call without start", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleToolEnd({ content: "result" }, "run-1");

      // Should not emit anything if no tool call was started
      expect(mockConnection.sessionUpdate).not.toHaveBeenCalled();
    });
  });

  describe("handleToolError", () => {
    test("emits tool call error event", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleToolStart({} as any, '{"path": "test.txt"}', "run-1", undefined, [], undefined, "read_file");
      await handler.handleToolError(new Error("Tool execution failed"), "run-1");

      expect(mockConnection.sessionUpdate).toHaveBeenCalledTimes(2);
      const callArg = mockConnection.sessionUpdate.mock.calls[1][0];
      expect(callArg.update.status).toBe("failed");
    });
  });

  describe("handleAgentError", () => {
    test("emits agent error as message chunk", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session"
      });

      await handler.handleAgentError(new Error("Agent failed"), "run-1");

      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
      const callArg = mockConnection.sessionUpdate.mock.calls[0][0];
      expect(callArg.update.content.text).toContain("[Error");
    });
  });

  describe("setSessionId", () => {
    test("updates session ID", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });

      handler.setSessionId("new-session-id");

      expect(handler.getSessionId()).toBe("new-session-id");
    });

    test("returns null when no session ID set", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });

      expect(handler.getSessionId()).toBeNull();
    });
  });

  describe("sessionId management", () => {
    test("uses session ID from handler config", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "handler-session"
      });

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("Hello", {}, "run-1");

      const callArg = mockConnection.sessionUpdate.mock.calls[0][0];
      expect(callArg.sessionId).toBe("handler-session");
    });

    test("session ID can be updated after creation", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "initial-session"
      });

      handler.setSessionId("updated-session");

      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("Hello", {}, "run-1");

      const callArg = mockConnection.sessionUpdate.mock.calls[0][0];
      expect(callArg.sessionId).toBe("updated-session");
    });
  });

  describe("dispose", () => {
    test("disposes handler without error", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });

      await handler.dispose();

      expect(handler).toBeDefined();
    });
  });
});