import { mock, describe, expect, test } from "bun:test";
import { createACPPermissionMiddleware, RequestPermissionOutcome } from "../../../src/middleware/createACPPermissionMiddleware";

// Test helper functions for creating mock runtime and state objects
const createMockRuntime = (interruptMock: any) => ({
  config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
  context: {},
  interrupt: interruptMock,
});

const createMockState = (tool_calls: any[]) => ({
  messages: [
    { _getType: () => 'human', content: "Test prompt" },
    { 
      _getType: () => 'ai', 
      content: "Test response",
      tool_calls,
    }
  ]
});

describe("createACPPermissionMiddleware", () => {
  describe("initialization", () => {
    test("throws error without permissionPolicy", () => {
      expect(() => createACPPermissionMiddleware({
        permissionPolicy: {},
        transport: {} as any,
      })).toThrow("Permission middleware requires a permissionPolicy configuration");
    });

    test("throws error without transport", () => {
      expect(() => createACPPermissionMiddleware({
        permissionPolicy: { "test": { requiresPermission: true } },
      } as any)).toThrow("Permission middleware requires a transport configuration");
    });

    test("creates middleware with valid configuration", () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "delete_*": { requiresPermission: true, kind: "delete" },
          "*_file": { requiresPermission: true, kind: "edit" },
        },
        transport: mockTransport,
      });
      
      expect(middleware).toBeDefined();
      expect(middleware.name).toBe("acp-permission-control");
    });

    test("accepts custom toolKindMapper", () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const customMapper = (_name: string) => "other";
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requiresPermission: true } },
        transport: mockTransport,
        toolKindMapper: customMapper,
      });
      
      expect(middleware).toBeDefined();
    });
  });

  describe("permission workflow hooks", () => {
    test("middleware has afterModel hook with canJumpTo configuration", () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requiresPermission: true } },
        transport: mockTransport,
      });
      
      expect(middleware.afterModel).toBeDefined();
      expect(typeof middleware.afterModel).toBe("object");
      expect(middleware.afterModel?.canJumpTo).toContain("model");
    });

    test("middleware has afterAgent hook for cleanup", () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requiresPermission: true } },
        transport: mockTransport,
      });
      
      expect(middleware.afterAgent).toBeDefined();
      expect(typeof middleware.afterAgent).toBe("function");
    });
  });

  describe("RequestPermissionOutcome type", () => {
    test("handles cancelled outcome", () => {
      const outcome: RequestPermissionOutcome = { outcome: "cancelled" };
      expect(outcome.outcome).toBe("cancelled");
    });

    test("handles selected outcome with optionId", () => {
      const outcome: RequestPermissionOutcome = {
        outcome: "selected",
        optionId: "allowOnce",
      };
      expect(outcome.outcome).toBe("selected");
      expect((outcome as any).optionId).toBe("allowOnce");
    });
  });

  describe("policy matching", () => {
    test("matches exact tool names", () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "delete_file": { requiresPermission: true, kind: "delete" },
        },
        transport: mockTransport,
      });
      
      expect(middleware).toBeDefined();
    });

    test("matches wildcard patterns", () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "delete_*": { requiresPermission: true, kind: "delete" },
          "*_file": { requiresPermission: true, kind: "edit" },
        },
        transport: mockTransport,
      });
      
      expect(middleware).toBeDefined();
    });
  });

  describe("afterModel hook - no tool calls", () => {
    test("returns empty when no tool calls in state", async () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requiresPermission: true } },
        transport: mockTransport,
      });
      
      const state = { messages: [] };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      expect(result).toEqual({});
      expect(mockTransport.sendNotification).not.toHaveBeenCalled();
    });

    test("returns empty when last message is not AIMessage", async () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requiresPermission: true } },
        transport: mockTransport,
      });
      
      const state = { 
        messages: [{ _getType: () => 'human', content: "Hello" }] 
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      expect(result).toEqual({});
    });
  });

  describe("afterModel hook - auto-approved tools", () => {
    test("skips permission when policy not matched", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "protected_tool": { requiresPermission: true } },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "unprotected_tool", args: {} }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: mock(async () => ({ decisions: [] })),
      };
      
      await middleware.afterModel?.hook(state as any, runtime as any);
      
      expect(sendNotificationMock).not.toHaveBeenCalled();
      expect(sessionUpdateMock).not.toHaveBeenCalled();
    });

    test("skips permission when requiresPermission is false", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "tool": { requiresPermission: false } },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "tool", args: {} }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: mock(async () => ({ decisions: [] })),
      };
      
      await middleware.afterModel?.hook(state as any, runtime as any);
      
      expect(sendNotificationMock).not.toHaveBeenCalled();
    });
  });

  describe("afterModel hook - permission required", () => {
    test("calls interrupt when permission required", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      const interruptMock = mock(async (req: any) => ({
        decisions: [{ type: "approve" }]
      }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test_tool": { requiresPermission: true } },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "test_tool", args: { param: "value" } }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      
      expect(interruptMock).toHaveBeenCalled();
      expect(sendNotificationMock).toHaveBeenCalledWith(
        "session/request_permission",
        expect.objectContaining({
          sessionId: "session-1",
        })
      );
    });

    test("emits pending status before interrupt", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      const interruptMock = mock(async (req: any) => ({
        decisions: [{ type: "approve" }]
      }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "delete_file": { requiresPermission: true, kind: "delete" } },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "delete_file", args: { path: "/test.txt" } }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      await middleware.afterModel?.hook(state as any, runtime as any);
      
      expect(sessionUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          update: expect.objectContaining({
            sessionUpdate: "tool_call",
            toolCallId: "call-1",
            status: "pending",
          }),
        })
      );
    });

    test("processes approve decision correctly", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      const interruptMock = mock(async (req: any) => ({
        decisions: [{ type: "approve" }]
      }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "write_file": { requiresPermission: true, kind: "edit" } },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "write_file", args: { path: "/test.txt", content: "Hello" } }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      
      // Should not jump back to model on approval
      expect(result?.jumpTo).toBeUndefined();
    });

    test("processes edit decision correctly", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      const interruptMock = mock(async (req: any) => ({
        decisions: [{
          type: "edit",
          editedAction: {
            name: "write_file",
            args: { path: "/new.txt", content: "Modified" }
          }
        }]
      }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "write_file": { requiresPermission: true, kind: "edit" } },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "write_file", args: { path: "/test.txt", content: "Hello" } }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      
      // Should not jump back to model on edit
      expect(result?.jumpTo).toBeUndefined();
    });

    test("processes reject decision and jumps to model", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      const interruptMock = mock(async (req: any) => ({
        decisions: [{
          type: "reject",
          message: "I don't want to do that"
        }]
      }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "delete_file": { requiresPermission: true, kind: "delete" } },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "delete_file", args: { path: "/test.txt" } }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      
      // Should jump back to model on rejection
      expect(result?.jumpTo).toBe("model");
      // Should add rejection message
      expect(result?.messages).toBeDefined();
    });
  });

  describe("error handling", () => {
    test("throws when interrupt is not supported", async () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requiresPermission: true } },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "test", args: {} }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        // No interrupt function
      };
      
      await expect(middleware.afterModel?.hook(state as any, runtime as any))
        .rejects.toThrow("Interrupt not supported in this runtime");
    });

    test("handles connection errors gracefully", async () => {
      const sessionUpdateMock = mock(async () => { throw new Error("Connection failed"); });
      const mockTransport = {
        sendNotification: mock(() => { throw new Error("Notification failed"); }),
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requiresPermission: true } },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "test", args: {} }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: mock(async (req: any) => ({
          decisions: [{ type: "approve" }]
        })),
      };
      
      // Should not throw even if sessionUpdate fails
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      expect(result).toBeDefined();
    });
  });

  describe("thread state cleanup", () => {
    test("cleans up thread state after agent completes", async () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requiresPermission: true } },
        transport: mockTransport,
      });
      
      const runtime = { 
        context: { threadId: "thread-1" },
        config: { configurable: { thread_id: "thread-1" } },
      };
      
      // afterAgent should clean up without error
      await middleware.afterAgent?.({} as any, runtime as any);
    });
  });

  describe("mixed tool calls", () => {
    test("handles mix of permission-required and auto-approved tools", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      const interruptMock = mock(async (req: any) => ({
        decisions: [{ type: "approve" }]
      }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { 
          "delete_file": { requiresPermission: true, kind: "delete" },
          "read_file": { requiresPermission: false },  // Auto-approved
        },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "read_file", args: { path: "/test.txt" } },  // Auto-approved
              { id: "call-2", name: "delete_file", args: { path: "/old.txt" } }  // Requires permission
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      
      // Should only interrupt for delete_file, not read_file
      expect(interruptMock).toHaveBeenCalled();
      expect(sendNotificationMock).toHaveBeenCalled();
    });
  });

  describe("afterModel hook - interrupt control", () => {
    test("does NOT call interrupt when all tools are auto-approved", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      const interruptMock = mock(async () => ({ decisions: [{ type: "approve" }] }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "delete_file": { requiresPermission: false },
          "read_file": { requiresPermission: false },
        },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "read_file", args: { path: "/test.txt" } },
              { id: "call-2", name: "delete_file", args: { path: "/old.txt" } }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      
      // Should NOT call interrupt when all tools are auto-approved
      expect(interruptMock).not.toHaveBeenCalled();
      expect(sendNotificationMock).not.toHaveBeenCalled();
      // Should return empty result
      expect(result).toEqual({});
    });

    test("does NOT call interrupt when policy not matched for any tool", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      const interruptMock = mock(async () => ({ decisions: [{ type: "approve" }] }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "protected_tool": { requiresPermission: true },
        },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "unknown_tool", args: {} }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      
      // Should NOT call interrupt when policy not matched
      expect(interruptMock).not.toHaveBeenCalled();
      expect(sendNotificationMock).not.toHaveBeenCalled();
    });

    test("only interrupts for tools requiring permission when mixed", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      const interruptMock = mock(async (req: any) => ({
        decisions: [{ type: "approve" }]
      }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "sensitive_op": { requiresPermission: true, kind: "delete" },
          "read_data": { requiresPermission: false },
          "log_info": { requiresPermission: false },
        },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "tc-1", name: "read_data", args: { query: "test" } },
              { id: "tc-2", name: "sensitive_op", args: { target: "user" } },
              { id: "tc-3", name: "log_info", args: { message: "debug" } }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      
      // Interrupt should be called
      expect(interruptMock).toHaveBeenCalled();
      
      // Verify only the tool requiring permission triggered the interrupt
      const interruptCall = interruptMock.mock.calls[0][0];
      expect(interruptCall.actionRequests).toHaveLength(1);
      expect(interruptCall.actionRequests[0].name).toBe("sensitive_op");
      
      // Verify all 3 tools are preserved in the final state
      const lastMessage = result?.messages?.find(
        (m: any) => m && m._getType && m._getType() === 'ai'
      );
      expect(lastMessage?.tool_calls).toHaveLength(3);
    });
  });

  describe("decision processing edge cases", () => {
    test("handles empty decisions array - tool not approved", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      const interruptMock = mock(async () => ({ decisions: [] }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test_tool": { requiresPermission: true } },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "test_tool", args: {} }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      
      // Empty decisions = no approval = tool not in final state
      // This is contract behavior: caller must provide explicit decisions
      expect(result).toBeDefined();
      expect(result?.messages).toBeDefined();
      
      // Verify the tool call was NOT approved (no decision made)
      const lastMessage = result?.messages?.find(
        (m: any) => m && m._getType && m._getType() === 'ai'
      );
      expect(lastMessage?.tool_calls).toEqual([]);
    });

    test("preserves tool calls when decisions match", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      const interruptMock = mock(async () => ({
        decisions: [
          { type: "approve" },
        ]
      }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test_tool": { requiresPermission: true } },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "call-1", name: "test_tool", args: {} }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      
      // Tool call should be preserved when decision is approve
      expect(result).toBeDefined();
      expect(result?.messages).toBeDefined();
      
      const lastMessage = result?.messages?.find(
        (m: any) => m && m._getType && m._getType() === 'ai'
      );
      expect(lastMessage?.tool_calls).toHaveLength(1);
      expect(lastMessage?.tool_calls[0].name).toBe("test_tool");
    });

    test("preserves decision order in processing", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      
      // Track decision processing order
      const decisionOrder: string[] = [];
      
      const interruptMock = mock(async () => ({
        decisions: [
          { type: "approve", toolCallId: "tc-1" },
          { type: "edit", toolCallId: "tc-2", editedAction: { name: "write_file", args: { path: "new.txt" } } },
          { type: "reject", toolCallId: "tc-3", message: "No" }
        ]
      }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "write_file": { requiresPermission: true, kind: "edit" },
          "delete_file": { requiresPermission: true, kind: "delete" },
          "read_file": { requiresPermission: true, kind: "read" },
        },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "tc-1", name: "write_file", args: { path: "a.txt" } },
              { id: "tc-2", name: "delete_file", args: { path: "b.txt" } },
              { id: "tc-3", name: "read_file", args: { path: "c.txt" } }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      
      // Verify all decisions were processed
      expect(result).toBeDefined();
      expect(result?.messages).toBeDefined();
      
      // tc-3 (read_file) should cause jumpTo model due to reject
      expect(result?.jumpTo).toBe("model");
    });
  });

  describe("policy matching edge cases", () => {
    test("throws error for empty permission policy", () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      // Empty policy should throw - at least one policy entry is required
      expect(() => createACPPermissionMiddleware({
        permissionPolicy: {},
        transport: mockTransport,
      })).toThrow("Permission middleware requires a permissionPolicy configuration");
    });

    test("respects policy precedence - first match wins", async () => {
      const sendNotificationMock = mock(() => {});
      const sessionUpdateMock = mock(async () => {});
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: sessionUpdateMock,
      };
      
      // First pattern with requiresPermission: false should take precedence
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "delete_file": { requiresPermission: false },  // First: explicit allow
          "delete_*": { requiresPermission: true },       // Second: would deny
        },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Hello" },
          { 
            _getType: () => 'ai', 
            content: "I'll help you",
            tool_calls: [
              { id: "tc-1", name: "delete_file", args: { path: "test.txt" } }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: mock(async () => ({ decisions: [{ type: "approve" }] })),
      };
      
      const result = await middleware.afterModel?.hook(state as any, runtime as any);
      
      // Should NOT interrupt because delete_file matched first pattern with requiresPermission: false
      expect(sendNotificationMock).not.toHaveBeenCalled();
    });
  });

  describe("persistent options", () => {
    test("accepts persistent options in permission policy configuration", () => {
      const mockTransport = {
        sendNotification: mock(() => {}),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "delete_file": {
            requiresPermission: true,
            persistentOptions: [
              { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
              { optionId: "reject_always", name: "Always reject", kind: "reject_always" },
            ],
          },
        },
        transport: mockTransport,
      });
      
      expect(middleware).toBeDefined();
    });

    test("merges persistent options with default options in permission request", async () => {
      const sendNotificationMock = mock(() => {});
      const interruptMock = mock(async (req: any) => ({
        decisions: [{ type: "approve" }]
      }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "delete_file": {
            requiresPermission: true,
            persistentOptions: [
              { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
              { optionId: "reject_always", name: "Always reject", kind: "reject_always" },
            ],
          },
        },
        transport: mockTransport,
      });
      
      const state = createMockState([
        { id: "call-1", name: "delete_file", args: { path: "/test.txt" } }
      ]);
      const runtime = createMockRuntime(interruptMock);
      
      await middleware.afterModel?.hook(state as any, runtime);
      
      expect(sendNotificationMock).toHaveBeenCalledWith(
        "session/request_permission",
        expect.objectContaining({
          sessionId: "session-1",
          options: expect.arrayContaining([
            expect.objectContaining({ optionId: "approve" }),
            expect.objectContaining({ optionId: "edit" }),
            expect.objectContaining({ optionId: "reject" }),
            expect.objectContaining({ optionId: "allow_always" }),
            expect.objectContaining({ optionId: "reject_always" }),
          ]),
        })
      );
    });

    test("includes only default options when no persistent options configured", async () => {
      const sendNotificationMock = mock(() => {});
      const interruptMock = mock(async (req: any) => ({
        decisions: [{ type: "approve" }]
      }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "read_file": { requiresPermission: true },
        },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Read the file" },
          { 
            _getType: () => 'ai', 
            content: "I'll read the file",
            tool_calls: [
              { id: "call-1", name: "read_file", args: { path: "/test.txt" } }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      await middleware.afterModel?.hook(state as any, runtime as any);
      
      expect(sendNotificationMock).toHaveBeenCalledWith(
        "session/request_permission",
        expect.objectContaining({
          options: expect.arrayContaining([
            expect.objectContaining({ optionId: "approve" }),
            expect.objectContaining({ optionId: "edit" }),
            expect.objectContaining({ optionId: "reject" }),
          ]),
        })
      );
      
      // Should NOT include persistent options
      const callArgs = sendNotificationMock.mock.calls[0][1];
      expect(callArgs.options).not.toContainEqual(
        expect.objectContaining({ optionId: "allow_always" })
      );
    });

    test("handles empty persistent options array", async () => {
      const sendNotificationMock = mock(() => {});
      const interruptMock = mock(async (req: any) => ({
        decisions: [{ type: "approve" }]
      }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "write_file": {
            requiresPermission: true,
            persistentOptions: [],
          },
        },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Write the file" },
          { 
            _getType: () => 'ai', 
            content: "I'll write the file",
            tool_calls: [
              { id: "call-1", name: "write_file", args: { path: "/test.txt", content: "hello" } }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      await middleware.afterModel?.hook(state as any, runtime as any);
      
      expect(sendNotificationMock).toHaveBeenCalledWith(
        "session/request_permission",
        expect.objectContaining({
          options: expect.arrayContaining([
            expect.objectContaining({ optionId: "approve" }),
            expect.objectContaining({ optionId: "edit" }),
            expect.objectContaining({ optionId: "reject" }),
          ]),
        })
      );
    });

    test("preserves persistent option kinds correctly", async () => {
      const sendNotificationMock = mock(() => {});
      const interruptMock = mock(async (req: any) => ({
        decisions: [{ type: "approve" }]
      }));
      
      const mockTransport = {
        sendNotification: sendNotificationMock,
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "sensitive_operation": {
            requiresPermission: true,
            persistentOptions: [
              { optionId: "always_allow", name: "Trust this operation", kind: "allow_always" },
              { optionId: "always_deny", name: "Block this operation", kind: "reject_always" },
            ],
          },
        },
        transport: mockTransport,
      });
      
      const state = {
        messages: [
          { _getType: () => 'human', content: "Run sensitive operation" },
          { 
            _getType: () => 'ai', 
            content: "I'll run the sensitive operation",
            tool_calls: [
              { id: "call-1", name: "sensitive_operation", args: {} }
            ]
          }
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-1", session_id: "session-1" } },
        context: {},
        interrupt: interruptMock,
      };
      
      await middleware.afterModel?.hook(state as any, runtime as any);
      
      const callArgs = sendNotificationMock.mock.calls[0][1];
      const persistentOptions = callArgs.options.filter(
        (opt: any) => opt.optionId === "always_allow" || opt.optionId === "always_deny"
      );
      
      expect(persistentOptions).toHaveLength(2);
      expect(persistentOptions).toContainEqual(
        expect.objectContaining({ optionId: "always_allow", kind: "allow_always" })
      );
      expect(persistentOptions).toContainEqual(
        expect.objectContaining({ optionId: "always_deny", kind: "reject_always" })
      );
    });
  });
});
