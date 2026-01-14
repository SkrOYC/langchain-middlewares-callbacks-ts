import { mock, describe, expect, test } from "bun:test";
import { createACPPermissionMiddleware, RequestPermissionOutcome } from "../../../src/middleware/createACPPermissionMiddleware";

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
});
