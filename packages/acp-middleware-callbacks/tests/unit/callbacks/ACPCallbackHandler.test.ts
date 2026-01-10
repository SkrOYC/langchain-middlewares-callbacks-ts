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

    test("sends sessionUpdate when sessionId is set", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      // Set session ID to trigger sessionUpdate path
      handler.setSessionId("test-session-123");
      
      await handler.handleToolStart({ name: "readFile" }, "path/to/file.txt", "run-1");
      
      // Should call sessionUpdate when sessionId is present
      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
      
      // Verify the sessionUpdate was called with correct structure
      const sessionUpdateCall = mockConnection.sessionUpdate.mock.calls[0][0];
      expect(sessionUpdateCall.sessionId).toBe("test-session-123");
      expect(sessionUpdateCall.update.toolCallId).toBeDefined();
      expect(sessionUpdateCall.update.kind).toBe("read");
      expect(sessionUpdateCall.update.status).toBe("in_progress");
      expect(sessionUpdateCall.update.rawInput).toBe("path/to/file.txt");
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

    test("sends sessionUpdate result when sessionId is set", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      // Set session ID to trigger sessionUpdate path
      handler.setSessionId("test-session-123");
      
      await handler.handleToolStart({ name: "readFile" }, "file.txt", "run-1");
      await handler.handleToolEnd("File content", "run-1");
      
      // Should call sessionUpdate for both start and end
      expect(mockConnection.sessionUpdate).toHaveBeenCalledTimes(2);
      
      // Verify the second call (end) has result
      const endCall = mockConnection.sessionUpdate.mock.calls[1][0];
      expect(endCall.update.sessionUpdate).toBe("tool_call_update");
      expect(endCall.update.toolCallId).toBeDefined();
      expect(endCall.update.status).toBe("completed");
      expect(endCall.update.rawOutput).toBe("File content");
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

    test("sends sessionUpdate error when sessionId is set", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any
      });
      
      // Set session ID to trigger sessionUpdate path
      handler.setSessionId("test-session-123");
      
      await handler.handleToolStart({ name: "readFile" }, "file.txt", "run-1");
      await handler.handleToolError(new Error("File not found"), "run-1");
      
      // Should call sessionUpdate for both start and error
      expect(mockConnection.sessionUpdate).toHaveBeenCalledTimes(2);
      
      // Verify the error call
      const errorCall = mockConnection.sessionUpdate.mock.calls[1][0];
      expect(errorCall.update.sessionUpdate).toBe("tool_call_update");
      expect(errorCall.update.toolCallId).toBeDefined();
      expect(errorCall.update.status).toBe("failed");
      expect(errorCall.update.rawOutput).toBeDefined();
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
      // Format: msg-timestamp-counter-random
      expect(call.messageId).toMatch(/^msg-\d+-\d+-[a-z0-9]+$/);
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

  describe("reasoning content handling", () => {
    test("emits reasoning content as agent_thought_chunk with sessionUpdate", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session",
        emitReasoningAsThought: true,
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      
      // Simulate reasoning token
      await handler.handleLLMNewToken("<reasoning>", { reasoning: true }, "run-1");
      await handler.handleLLMNewToken("Let me think about this problem.", {}, "run-1");
      await handler.handleLLMNewToken("</reasoning>", {}, "run-1");
      
      // Should have emitted session update for reasoning
      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
      
      const callArg = mockConnection.sessionUpdate.mock.calls[0][0];
      expect(callArg.sessionId).toBe("test-session");
      expect(callArg.update.sessionUpdate).toBe("agent_thought_chunk");
      expect(callArg.update.content.annotations.audience).toEqual(["assistant"]);
    });

    test("emits reasoning with audience annotation", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session",
        emitReasoningAsThought: true,
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("<reasoning>", { reasoning: true }, "run-1");
      
      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
      
      const callArg = mockConnection.sessionUpdate.mock.calls[0][0];
      expect(callArg.update.content.annotations.audience).toContain("assistant");
    });

    test("falls back to agent_message_chunk when emitReasoningAsThought is false", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session",
        emitReasoningAsThought: false,
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("<reasoning>", { reasoning: true }, "run-1");
      
      // Should use sendAgentMessage instead of sessionUpdate
      expect(mockConnection.sendAgentMessage).toHaveBeenCalled();
      
      const callArg = mockConnection.sendAgentMessage.mock.calls[0][0];
      expect(callArg.content[0].annotations.audience).toEqual(["assistant"]);
    });

    test("falls back to agent_message_chunk when no sessionId is available", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        // No sessionId provided
        emitReasoningAsThought: true,
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("<reasoning>", { reasoning: true }, "run-1");
      
      // Should use sendAgentMessage because sessionId is missing
      expect(mockConnection.sendAgentMessage).toHaveBeenCalled();
      
      // Should NOT use sessionUpdate (which requires sessionId)
      expect(mockConnection.sessionUpdate).not.toHaveBeenCalled();
    });

    test("falls back to agent_message_chunk when both emitReasoningAsThought is false and no sessionId", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        // No sessionId provided
        emitReasoningAsThought: false,
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("<reasoning>", { reasoning: true }, "run-1");
      
      // Should use sendAgentMessage as fallback
      expect(mockConnection.sendAgentMessage).toHaveBeenCalled();
      expect(mockConnection.sessionUpdate).not.toHaveBeenCalled();
    });

    test("handles LangChain v1.0.0 content blocks with reasoning", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session",
        emitReasoningAsThought: true,
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("Regular text", {}, "run-1");
      
      // Simulate LangChain v1.0.0 structured output with reasoning blocks
      await handler.handleLLMEnd({
        content: [
          { type: "reasoning", reasoning: "Thinking about the answer..." },
          { type: "text", text: "The final answer is 42." },
        ]
      }, "run-1");
      
      // Should have emitted thought chunk for reasoning and message for text
      expect(mockConnection.sessionUpdate).toHaveBeenCalled();
      expect(mockConnection.sendAgentMessage).toHaveBeenCalled();
    });

    test("processes content blocks in order", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session",
        emitReasoningAsThought: true,
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      
      await handler.handleLLMEnd({
        content: [
          { type: "reasoning", reasoning: "First step: analyze the problem", index: 0 },
          { type: "text", text: "Hello!", index: 1 },
          { type: "reasoning", reasoning: "Now I can respond", index: 2 },
          { type: "text", text: "How can I help?", index: 3 },
        ]
      }, "run-1");
      
      // Should have emitted 2 thought chunks for reasoning blocks
      expect(mockConnection.sessionUpdate).toHaveBeenCalledTimes(2);
      
      // Should have emitted 1 message for combined text blocks
      expect(mockConnection.sendAgentMessage).toHaveBeenCalledTimes(1);
    });

    test("handles output without content blocks", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session",
      });
      
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("Simple response", {}, "run-1");
      
      // End with unstructured output
      await handler.handleLLMEnd({}, "run-1");
      
      // Should have sent the text message
      expect(mockConnection.sendAgentMessage).toHaveBeenCalled();
    });

    test("resets reasoning state on handleLLMStart", async () => {
      const mockConnection = createMockConnection();
      const handler = new ACPCallbackHandler({
        connection: mockConnection as any,
        sessionId: "test-session",
      });
      
      // Start first run with reasoning
      await handler.handleLLMStart({} as any, [], "run-1");
      await handler.handleLLMNewToken("<reasoning>", { reasoning: true }, "run-1");
      
      // Verify reasoning was emitted as sessionUpdate
      const sessionUpdateAfterReasoning = mockConnection.sessionUpdate.mock.calls.length;
      expect(sessionUpdateAfterReasoning).toBeGreaterThan(0);
      
      // Start second run - should reset reasoning state
      await handler.handleLLMStart({} as any, [], "run-2");
      await handler.handleLLMNewToken("Normal text", {}, "run-2");
      
      // Verify normal text was emitted as agent message, not reasoning chunk
      const sessionUpdateCallsAfterSecondRun = mockConnection.sessionUpdate.mock.calls.length;
      const agentMessageCallsAfterSecondRun = mockConnection.sendAgentMessage.mock.calls.length;
      
      // No new sessionUpdates for normal text
      expect(sessionUpdateCallsAfterSecondRun).toBe(sessionUpdateAfterReasoning);
      // Should have emitted agent message for normal text
      expect(agentMessageCallsAfterSecondRun).toBeGreaterThan(0);
    });
  });
});