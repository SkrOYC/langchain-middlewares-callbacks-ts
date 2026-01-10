import { test, expect, describe, mock, beforeEach } from "bun:test";
import { ACPCallbackHandler, createACPCallbackHandler } from "../../../src/callbacks/ACPCallbackHandler";

// Mock connection factory with tracking
function createMockConnection() {
  const sendAgentMessage = mock(async (_message: any) => undefined);
  const sessionUpdate = mock(async (_params: any) => undefined);
  const close = mock(async () => undefined);
  
  return {
    sendAgentMessage,
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
        connection: mockConnection as any
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("Hello", {}, "run-1");
      await handler.handleLLMNewToken(" ", {}, "run-1");
      
      // Should have sent messages for each token
      expect(mockConnection.sendAgentMessage).toHaveBeenCalled();
    });

    test("generates message ID if not already set", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      // Call handleLLMNewToken without handleLLMStart
      await handler.handleLLMNewToken("First token", {}, "run-1");
      
      expect(mockConnection.sendAgentMessage).toHaveBeenCalled();
    });

    test("handles connection errors gracefully", async () => {
      const errorConnection = {
        sendAgentMessage: mock(async () => { throw new Error("Connection error"); }),
        close: mock(async () => undefined)
      };
      
      const handler = new ACPCallbackHandler({
        connection: errorConnection as any
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      // Should not throw
      await expect(handler.handleLLMNewToken("token", {}, "run-1")).resolves.toBeUndefined();
    });
  });

  describe("handleLLMEnd", () => {
    test("sends final agent message on LLM end", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("Final response", {}, "run-1");
      await handler.handleLLMEnd({} as any, "run-1");
      
      expect(mockConnection.sendAgentMessage).toHaveBeenCalled();
    });

    test("handles end without start gracefully", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      await handler.handleLLMEnd({} as any, "run-1");
      
      // Should not send any messages
      expect(mockConnection.sendAgentMessage).not.toHaveBeenCalled();
    });
  });

  describe("handleLLMError", () => {
    test("sends error message on LLM error", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMError(new Error("Model error"), "run-1");
      
      expect(mockConnection.sendAgentMessage).toHaveBeenCalled();
    });

    test("clears message ID after error", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMError(new Error("Error"), "run-1");
      
      // Verify no more messages sent for this run
      const callsBeforeError = mockConnection.sendAgentMessage.mock.calls.length;
      
      await handler.handleLLMStart({} as any, [], "run-2");
      await handler.handleLLMEnd({} as any, "run-2");
      
      // Should have sent messages for run-2
      expect(mockConnection.sendAgentMessage.mock.calls.length).toBeGreaterThan(callsBeforeError);
    });
  });

  describe("handleToolStart", () => {
    test("sends tool call start event", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      await handler.handleToolStart({ name: "readFile" }, "path/to/file.txt", "run-1");
      
      expect(mockConnection.sendAgentMessage).toHaveBeenCalled();
    });

    test("handles multiple tool calls", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      await handler.handleToolStart({ name: "tool1" }, "input", "run-1");
      await handler.handleToolStart({ name: "tool2" }, "input", "run-2");
      
      expect(mockConnection.sendAgentMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe("handleToolEnd", () => {
    test("sends tool call update with result", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      await handler.handleToolStart({ name: "readFile" }, "file.txt", "run-1");
      await handler.handleToolEnd("File content", "run-1");
      
      expect(mockConnection.sendAgentMessage).toHaveBeenCalledTimes(2);
    });

    test("handles end without start gracefully", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      await handler.handleToolEnd("result", "run-1");
      
      expect(mockConnection.sendAgentMessage).not.toHaveBeenCalled();
    });
  });

  describe("handleToolError", () => {
    test("sends tool call update with error", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      await handler.handleToolStart({ name: "readFile" }, "file.txt", "run-1");
      await handler.handleToolError(new Error("File not found"), "run-1");
      
      expect(mockConnection.sendAgentMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe("dispose", () => {
    test("closes connection on dispose", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      await handler.dispose();
      
      expect(mockConnection.close).toHaveBeenCalled();
    });

    test("handles close errors gracefully", async () => {
      const errorConnection = {
        sendAgentMessage: mock(async () => undefined),
        close: mock(async () => { throw new Error("Close error"); })
      };
      
      const handler = new ACPCallbackHandler({
        connection: errorConnection as any
      });
      
      // Should not throw even if close fails
      await handler.dispose();
    });
  });

  describe("message ID generation", () => {
    test("generates unique message IDs", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("token1", {}, "run-1");
      
      const firstCall = mockConnection.sendAgentMessage.mock.calls[0][0];
      const messageId1 = firstCall.messageId;
      
      await handler.handleLLMStart({} as any, [], "run-2");
      await handler.handleLLMNewToken("token2", {}, "run-2");
      
      // Get the second message (index 1)
      const secondCall = mockConnection.sendAgentMessage.mock.calls[1][0];
      const messageId2 = secondCall.messageId;
      
      expect(messageId1).not.toBe(messageId2);
    });

    test("message IDs follow expected format", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("token", {}, "run-1");
      
      const call = mockConnection.sendAgentMessage.mock.calls[0][0];
      expect(call.messageId).toMatch(/^msg-\d+-[a-z0-9]+$/);
    });
  });

  describe("session ID management", () => {
    test("setSessionId updates the session ID", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      expect(handler.getSessionId()).toBeNull();
      
      handler.setSessionId("test-session-123");
      expect(handler.getSessionId()).toBe("test-session-123");
    });

    test("getSessionId returns null when not set", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      expect(handler.getSessionId()).toBeNull();
    });

    test("session ID persists across multiple operations", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      handler.setSessionId("persistent-session");
      
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("token", {}, "run-1");
      
      // Session ID should still be set after operations
      expect(handler.getSessionId()).toBe("persistent-session");
    });
  });

  describe("detectToolKind", () => {
    test("detects read tools", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      expect(handler.detectToolKind("read_content")).toBe("read");
      expect(handler.detectToolKind("LoadData")).toBe("read");
      expect(handler.detectToolKind("getData")).toBe("read");
    });

    test("detects edit tools", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      expect(handler.detectToolKind("WriteContent")).toBe("edit");
      expect(handler.detectToolKind("EditText")).toBe("edit");
      expect(handler.detectToolKind("CreateResource")).toBe("edit");
      expect(handler.detectToolKind("ModifyState")).toBe("edit");
    });

    test("detects delete tools", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      expect(handler.detectToolKind("delete_record")).toBe("delete");
      expect(handler.detectToolKind("RemoveEntry")).toBe("delete");
      expect(handler.detectToolKind("rm_backup")).toBe("delete");
    });

    test("detects move tools", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      expect(handler.detectToolKind("move_resource")).toBe("move");
      expect(handler.detectToolKind("RenameEntry")).toBe("move");
      expect(handler.detectToolKind("mv_item")).toBe("move");
    });

    test("detects search tools", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      expect(handler.detectToolKind("SearchDatabase")).toBe("search");
      expect(handler.detectToolKind("FindPattern")).toBe("search");
      expect(handler.detectToolKind("grep_text")).toBe("search");
    });

    test("detects execute tools", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      expect(handler.detectToolKind("execCommand")).toBe("execute");
      expect(handler.detectToolKind("runScript")).toBe("execute");
      expect(handler.detectToolKind("bash_shell")).toBe("execute");
      expect(handler.detectToolKind("cmd_exe")).toBe("execute");
    });

    test("detects think tools", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      expect(handler.detectToolKind("thinkAboutIt")).toBe("think");
      expect(handler.detectToolKind("reasoning")).toBe("think");
      expect(handler.detectToolKind("analyze_problem")).toBe("think");
    });

    test("detects fetch tools", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      expect(handler.detectToolKind("fetchUrl")).toBe("fetch");
      expect(handler.detectToolKind("httpRequest")).toBe("fetch");
      expect(handler.detectToolKind("api_call")).toBe("fetch");
    });

    test("detects switch_mode tools", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      expect(handler.detectToolKind("switchMode")).toBe("switch_mode");
      expect(handler.detectToolKind("change_mode")).toBe("switch_mode");
    });

    test("returns other for unknown tools", () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      expect(handler.detectToolKind("customTool")).toBe("other");
      expect(handler.detectToolKind("unknown")).toBe("other");
    });
  });
});