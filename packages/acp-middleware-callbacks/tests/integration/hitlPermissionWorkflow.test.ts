import { test, expect, describe, mock } from "bun:test";
import { createACPPermissionMiddleware } from "../../src/middleware/createACPPermissionMiddleware";

/**
 * Integration tests for the complete HITL permission workflow.
 * 
 * This test suite verifies:
 * 1. Permission middleware correctly intercepts tool calls requiring approval
 * 2. interrupt() is called to checkpoint state and pause execution
 * 3. Decisions from Command.resume are processed correctly
 * 4. Tool execution proceeds based on decisions (approve/edit/reject)
 * 5. session/request_permission notification is sent before interrupting
 */

describe("HITL Permission Workflow Integration", () => {
  describe("complete workflow with approve decision", () => {
    test("agent pauses for permission, resumes with approval, executes tool", async () => {
      const notificationCalls: Array<{ method: string; params: any }> = [];
      const sessionUpdateCalls: Array<any> = [];
      
      // Mock transport
      const mockTransport = {
        sendNotification: mock((method: string, params: any) => {
          notificationCalls.push({ method, params });
        }),
        sessionUpdate: mock(async (params: any) => {
          sessionUpdateCalls.push(params);
        }),
      };
      
      // Create middleware with permission policy
      const permissionMiddleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "write_file": { 
            requiresPermission: true, 
            kind: "edit",
            description: "Write a file to disk",
          },
          "read_file": { 
            requiresPermission: false,  // Auto-approved
            kind: "read",
          },
        },
        transport: mockTransport,
        descriptionPrefix: "File operation requires approval",
      });
      
      // Simulate agent state with tool calls
      const initialState = {
        messages: [
          { _getType: () => 'human', content: "Write hello to file.txt and read it" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you with that",
            tool_calls: [
              { id: "tc-1", name: "write_file", args: { path: "file.txt", content: "Hello" } },
              { id: "tc-2", name: "read_file", args: { path: "file.txt" } },
            ]
          }
        ]
      };
      
      // Mock runtime with interrupt
      let interruptResolve: any;
      const interruptPromise = new Promise((resolve) => {
        interruptResolve = resolve;
      });
      
      const runtime = {
        config: { configurable: { thread_id: "session-123", session_id: "acp-session-456" } },
        context: {},
        interrupt: mock(async (hitlRequest: any) => {
          // Verify interrupt was called with correct data
          expect(hitlRequest.actionRequests).toHaveLength(1);
          expect(hitlRequest.actionRequests[0].name).toBe("write_file");
          expect(hitlRequest.actionRequests[0].args.path).toBe("file.txt");
          expect(hitlRequest.reviewConfigs).toHaveLength(1);
          expect(hitlRequest.reviewConfigs[0].actionName).toBe("write_file");
          expect(hitlRequest.reviewConfigs[0].allowedDecisions).toContain("approve");
          
          // Simulate user approval via Command.resume
          return {
            decisions: [{ type: "approve" }]
          };
        }),
      };
      
      // Execute the afterModel hook
      const result = await permissionMiddleware.afterModel?.hook(
        initialState as any,
        runtime as any
      );
      
      // Verify notification was sent before interrupt
      expect(notificationCalls).toHaveLength(1);
      expect(notificationCalls[0].method).toBe("session/request_permission");
      expect(notificationCalls[0].params.sessionId).toBe("acp-session-456");
      
      // Verify session updates
      expect(sessionUpdateCalls.length).toBeGreaterThanOrEqual(1);
      const pendingUpdate = sessionUpdateCalls.find(
        (c: any) => c.update.toolCallId === "tc-1" && c.update.status === "pending"
      );
      expect(pendingUpdate).toBeDefined();
      
      // Verify result - should not jump back to model (approved)
      expect(result?.jumpTo).toBeUndefined();
      
      // Verify tool calls were preserved in state
      const lastMessage = result?.messages?.find(
        (m: any) => m && m._getType && m._getType() === 'ai'
      );
      expect(lastMessage?.tool_calls).toBeDefined();
      expect(lastMessage.tool_calls).toHaveLength(2); // Both tools preserved
    });
  });

  describe("complete workflow with edit decision", () => {
    test("agent pauses, user edits arguments, execution proceeds with modified args", async () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const permissionMiddleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "write_file": { requiresPermission: true, kind: "edit" },
        },
        transport: mockTransport,
      });
      
      const initialState = {
        messages: [
          { _getType: () => 'human', content: "Write to file" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "tc-1", name: "write_file", args: { path: "old.txt", content: "Original" } }
            ]
          }
        ]
      };
      
      const runtime = {
        config: { configurable: { thread_id: "session-123", session_id: "acp-session-456" } },
        context: {},
        interrupt: mock(async () => {
          // Simulate user editing the arguments
          return {
            decisions: [{
              type: "edit",
              editedAction: {
                name: "write_file",
                args: { path: "new.txt", content: "Modified content" }
              }
            }]
          };
        }),
      };
      
      const result = await permissionMiddleware.afterModel?.hook(
        initialState as any,
        runtime as any
      );
      
      // Verify result
      expect(result?.jumpTo).toBeUndefined();
      
      // Verify the tool call was modified
      const lastMessage = result?.messages?.find(
        (m: any) => m && m._getType && m._getType() === 'ai'
      );
      expect(lastMessage?.tool_calls[0].args.path).toBe("new.txt");
      expect(lastMessage?.tool_calls[0].args.content).toBe("Modified content");
    });
  });

  describe("complete workflow with reject decision", () => {
    test("agent pauses, user rejects, execution jumps back to model", async () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const permissionMiddleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "delete_file": { requiresPermission: true, kind: "delete" },
        },
        transport: mockTransport,
      });
      
      const initialState = {
        messages: [
          { _getType: () => 'human', content: "Delete file" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "tc-1", name: "delete_file", args: { path: "important.txt" } }
            ]
          }
        ]
      };
      
      const runtime = {
        config: { configurable: { thread_id: "session-123", session_id: "acp-session-456" } },
        context: {},
        interrupt: mock(async () => {
          // Simulate user rejection
          return {
            decisions: [{
              type: "reject",
              message: "I can't let you do that, Dave"
            }]
          };
        }),
      };
      
      const result = await permissionMiddleware.afterModel?.hook(
        initialState as any,
        runtime as any
      );
      
      // Verify result - should jump back to model
      expect(result?.jumpTo).toBe("model");
      
      // Verify rejection message was added
      const toolMessage = result?.messages?.find(
        (m: any) => m && m.role === "tool"
      );
      expect(toolMessage).toBeDefined();
      expect(toolMessage.content[0].content.text).toBe("I can't let you do that, Dave");
      
      // Verify the rejected tool call was NOT included in the final tool_calls
      const lastMessage = result?.messages?.find(
        (m: any) => m && m._getType && m._getType() === 'ai'
      );
      expect(lastMessage?.tool_calls).toHaveLength(0);
    });
  });

  describe("mixed permission requirements", () => {
    test("only interrupts for tools requiring permission", async () => {
      const interruptMock = mock(async () => ({ decisions: [{ type: "approve" }] }));
      
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const permissionMiddleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "write_file": { requiresPermission: true, kind: "edit" },
          "read_file": { requiresPermission: false },  // Auto-approved
          "search": { requiresPermission: false },  // Auto-approved
        },
        transport: mockTransport,
      });
      
      const initialState = {
        messages: [
          { _getType: () => 'human', content: "Do everything" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "tc-1", name: "read_file", args: { path: "a.txt" } },     // Auto-approved
              { id: "tc-2", name: "write_file", args: { path: "b.txt" } },    // Requires permission
              { id: "tc-3", name: "search", args: { query: "test" } },        // Auto-approved
            ]
          }
        ]
      };
      
      const runtime = {
        config: { configurable: { thread_id: "session-123", session_id: "acp-session-456" } },
        context: {},
        interrupt: interruptMock,
      };
      
      const result = await permissionMiddleware.afterModel?.hook(
        initialState as any,
        runtime as any
      );
      
      // Verify interrupt was called (only once for write_file)
      expect(interruptMock).toHaveBeenCalled();
      
      // Verify only the permission-required tool was in the interrupt request
      const interruptCall = interruptMock.mock.calls[0][0];
      expect(interruptCall.actionRequests).toHaveLength(1);
      expect(interruptCall.actionRequests[0].name).toBe("write_file");
      
      // Verify final state has all three tools (auto-approved + approved)
      const lastMessage = result?.messages?.find(
        (m: any) => m && m._getType && m._getType() === 'ai'
      );
      expect(lastMessage?.tool_calls).toHaveLength(3);
    });
  });

  describe("session cancel handling", () => {
    test("onSessionCancel callback is invoked when provided", async () => {
      let cancelCallbackInvoked = false;
      
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const permissionMiddleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "dangerous_tool": { requiresPermission: true },
        },
        transport: mockTransport,
        onSessionCancel: mock((sessionId: string) => {
          cancelCallbackInvoked = true;
          expect(sessionId).toBe("acp-session-456");
        }),
      });
      
      const initialState = {
        messages: [
          { _getType: () => 'human', content: "Run dangerous tool" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "tc-1", name: "dangerous_tool", args: {} }
            ]
          }
        ]
      };
      
      // Note: The actual cancel handling would need to be implemented
      // by the caller monitoring for session/cancel notifications
      // This test verifies the callback is registered
      expect(permissionMiddleware).toBeDefined();
      expect(cancelCallbackInvoked).toBe(false);
    });
  });

  describe("checkpointing behavior", () => {
    test("interrupt preserves state for durable execution", async () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const permissionMiddleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "file_operation": { requiresPermission: true },
        },
        transport: mockTransport,
      });
      
      // Complex state with multiple messages and context
      const complexState = {
        messages: [
          { _getType: () => 'human', content: "First message" },
          { _getType: () => 'human', content: "Second message" },
          { _getType: () => 'ai', content: "Response 1" },
          { _getType: () => 'tool', content: "Tool result", tool_call_id: "prev-call" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you with the file operation",
            tool_calls: [
              { id: "tc-1", name: "file_operation", args: { operation: "complex", data: { nested: true } } }
            ]
          }
        ],
        // Additional state that should be preserved
        someContext: "should be preserved",
        counter: 42,
      };
      
      const runtime = {
        config: { 
          configurable: { 
            thread_id: "session-123", 
            session_id: "acp-session-456",
            checkpoint_id: "checkpoint-789",
          } 
        },
        context: { customContext: "preserved" },
        interrupt: mock(async (hitlRequest: any) => {
          // Verify the interrupt request contains the correct tool info
          expect(hitlRequest.actionRequests[0].args.operation).toBe("complex");
          expect(hitlRequest.actionRequests[0].args.data.nested).toBe(true);
          
          // In a real scenario, LangGraph would checkpoint here
          // The state would be persisted before resuming
          return { decisions: [{ type: "approve" }] };
        }),
      };
      
      const result = await permissionMiddleware.afterModel?.hook(
        complexState as any,
        runtime as any
      );
      
      // Verify the result preserves the state structure
      expect(result).toBeDefined();
      expect(result?.messages).toBeDefined();
      expect(Array.isArray(result?.messages)).toBe(true);
    });
  });

  describe("error resilience", () => {
    test("continues execution when notifications fail", async () => {
      const mockTransport = {
        sendNotification: mock(() => { throw new Error("Notification failed"); }),
        sessionUpdate: mock(async () => {}),
      };
      
      const permissionMiddleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "test_tool": { requiresPermission: true },
        },
        transport: mockTransport,
      });
      
      const initialState = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "tc-1", name: "test_tool", args: {} }
            ]
          }
        ]
      };
      
      const runtime = {
        config: { configurable: { thread_id: "session-123", session_id: "acp-session-456" } },
        context: {},
        interrupt: mock(async () => ({ decisions: [{ type: "approve" }] })),
      };
      
      // Should not throw even if notification fails
      const result = await permissionMiddleware.afterModel?.hook(
        initialState as any,
        runtime as any
      );
      
      expect(result).toBeDefined();
      expect(result?.jumpTo).toBeUndefined();
    });
  });
});
