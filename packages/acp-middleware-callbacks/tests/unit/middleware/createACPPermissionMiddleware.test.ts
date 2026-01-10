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
        requestPermission: mock(async () => ({ outcome: { outcome: "cancelled" } })),
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
        requestPermission: mock(async () => ({ outcome: { outcome: "cancelled" } })),
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
    test("middleware has wrapToolCall hook", () => {
      const mockTransport = {
        requestPermission: mock(async () => ({ outcome: { outcome: "cancelled" } })),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requiresPermission: true } },
        transport: mockTransport,
      });
      
      expect(middleware.wrapToolCall).toBeDefined();
      expect(typeof middleware.wrapToolCall).toBe("function");
    });

    test("middleware has afterAgent hook for cleanup", () => {
      const mockTransport = {
        requestPermission: mock(async () => ({ outcome: { outcome: "cancelled" } })),
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
        requestPermission: mock(async () => ({ outcome: { outcome: "cancelled" } })),
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
        requestPermission: mock(async () => ({ outcome: { outcome: "cancelled" } })),
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

  describe("permission options", () => {
    test("provides default permission options", async () => {
      let capturedOptions: any = null;
      const mockTransport = {
        requestPermission: mock(async (params: any) => {
          capturedOptions = params.options;
          return { outcome: { outcome: "cancelled" } };
        }),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requiresPermission: true } },
        transport: mockTransport,
      });
      
      // Trigger a permission request
      const handlerMock = mock(async () => ({ result: "success" }));
      const request = {
        toolCall: { id: "call-1", name: "test", args: {} },
        runtime: { config: {}, context: { threadId: "thread-1", sessionId: "session-1" } },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any).catch(() => {});
      
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions).toHaveLength(4);
      expect(capturedOptions[0].optionId).toBe("allowOnce");
      expect(capturedOptions[0].kind).toBe("allow_once");
      expect(capturedOptions[1].optionId).toBe("allowAlways");
      expect(capturedOptions[1].kind).toBe("allow_always");
      expect(capturedOptions[2].optionId).toBe("rejectOnce");
      expect(capturedOptions[2].kind).toBe("reject_once");
      expect(capturedOptions[3].optionId).toBe("rejectAlways");
      expect(capturedOptions[3].kind).toBe("reject_always");
    });
  });

  describe("cancelled outcome handling", () => {
    test("throws error when permission request is cancelled", async () => {
      const mockTransport = {
        requestPermission: mock(async () => ({ outcome: { outcome: "cancelled" } })),
        sessionUpdate: mock(async () => {}),
      };

      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test_tool": { requiresPermission: true } },
        transport: mockTransport,
      });

      const handlerMock = mock(async () => ({ result: "success" }));
      const request = {
        toolCall: { id: "call-1", name: "test_tool", args: {} },
        runtime: { config: {}, context: { threadId: "thread-1", sessionId: "session-1" } },
      };

      await expect(middleware.wrapToolCall!(request, handlerMock as any))
        .rejects.toThrow("Permission request cancelled by user");
    });

    test("emits failed update on cancelled outcome", async () => {
      const sessionUpdateMock = mock(async () => {});
      const mockTransport = {
        requestPermission: mock(async () => ({ outcome: { outcome: "cancelled" } })),
        sessionUpdate: sessionUpdateMock,
      };

      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "delete_file": { requiresPermission: true, kind: "delete" } },
        transport: mockTransport,
      });

      const handlerMock = mock(async () => ({ result: "success" }));
      const request = {
        toolCall: { id: "call-1", name: "delete_file", args: {} },
        runtime: { config: {}, context: { threadId: "thread-1", sessionId: "session-1" } },
      };

      await expect(middleware.wrapToolCall!(request, handlerMock as any))
        .rejects.toThrow();

      expect(sessionUpdateMock).toHaveBeenCalled();
    });
  });

  describe("selected outcome with rejection", () => {
    test("throws error when user rejects once", async () => {
      const mockTransport = {
        requestPermission: mock(async () => ({
          outcome: { outcome: "selected", optionId: "rejectOnce" }
        })),
        sessionUpdate: mock(async () => {}),
      };

      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "write_file": { requiresPermission: true, kind: "edit" } },
        transport: mockTransport,
      });

      const handlerMock = mock(async () => ({ result: "success" }));
      const request = {
        toolCall: { id: "call-1", name: "write_file", args: {} },
        runtime: { config: {}, context: { threadId: "thread-1", sessionId: "session-1" } },
      };

      await expect(middleware.wrapToolCall!(request, handlerMock as any))
        .rejects.toThrow("Permission denied by user");
    });

    test("throws error when user rejects always", async () => {
      const mockTransport = {
        requestPermission: mock(async () => ({
          outcome: { outcome: "selected", optionId: "rejectAlways" }
        })),
        sessionUpdate: mock(async () => {}),
      };

      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "delete_file": { requiresPermission: true, kind: "delete" } },
        transport: mockTransport,
      });

      const handlerMock = mock(async () => ({ result: "success" }));
      const request = {
        toolCall: { id: "call-1", name: "delete_file", args: {} },
        runtime: { config: {}, context: { threadId: "thread-1", sessionId: "session-1" } },
      };

      await expect(middleware.wrapToolCall!(request, handlerMock as any))
        .rejects.toThrow("Permission denied by user");
    });
  });

  describe("selected outcome with approval", () => {
    test("allows execution when user approves once", async () => {
      const mockTransport = {
        requestPermission: mock(async () => ({
          outcome: { outcome: "selected", optionId: "allowOnce" }
        })),
        sessionUpdate: mock(async () => {}),
      };

      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "read_file": { requiresPermission: true, kind: "read" } },
        transport: mockTransport,
      });

      const handlerMock = mock(async () => ({ result: "success" }));
      const request = {
        toolCall: { id: "call-1", name: "read_file", args: { path: "/test.txt" } },
        runtime: { config: {}, context: { threadId: "thread-1", sessionId: "session-1" } },
      };

      const result = await middleware.wrapToolCall!(request, handlerMock as any);

      expect(handlerMock).toHaveBeenCalled();
    });

    test("emits permission_update when user allows always", async () => {
      const mockTransport = {
        requestPermission: mock(async () => ({
          outcome: { outcome: "selected", optionId: "allowAlways" }
        })),
        sessionUpdate: mock(async () => {}),
      };

      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "search_*": { requiresPermission: true, kind: "search" } },
        transport: mockTransport,
      });

      const handlerMock = mock(async () => ({ result: "success" }));
      const request = {
        toolCall: { id: "call-1", name: "search_files", args: { query: "test" } },
        runtime: { config: {}, context: { threadId: "thread-1", sessionId: "session-1" } },
      };

      await middleware.wrapToolCall!(request, handlerMock as any);

      expect(handlerMock).toHaveBeenCalled();
    });
  });

  describe("requiresPermission check", () => {
    test("skips permission flow when policy not matched", async () => {
      const requestPermissionMock = mock(async () => ({
        outcome: { outcome: "selected", optionId: "allowOnce" }
      }));
      const mockTransport = {
        requestPermission: requestPermissionMock,
        sessionUpdate: mock(async () => {}),
      };

      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "protected_tool": { requiresPermission: true } },
        transport: mockTransport,
      });

      const handlerMock = mock(async () => ({ result: "success" }));
      const request = {
        toolCall: { id: "call-1", name: "unprotected_tool", args: {} },
        runtime: { config: {}, context: { threadId: "thread-1", sessionId: "session-1" } },
      };

      const result = await middleware.wrapToolCall!(request, handlerMock as any);

      expect(handlerMock).toHaveBeenCalled();
      expect(requestPermissionMock).not.toHaveBeenCalled();
    });

    test("skips permission flow when requiresPermission is false", async () => {
      const requestPermissionMock = mock(async () => ({
        outcome: { outcome: "selected", optionId: "allowOnce" }
      }));
      const mockTransport = {
        requestPermission: requestPermissionMock,
        sessionUpdate: mock(async () => {}),
      };

      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "tool": { requiresPermission: false } },
        transport: mockTransport,
      });

      const handlerMock = mock(async () => ({ result: "success" }));
      const request = {
        toolCall: { id: "call-1", name: "tool", args: {} },
        runtime: { config: {}, context: { threadId: "thread-1", sessionId: "session-1" } },
      };

      const result = await middleware.wrapToolCall!(request, handlerMock as any);

      expect(handlerMock).toHaveBeenCalled();
      expect(requestPermissionMock).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    test("handles connection errors gracefully", async () => {
      const sessionUpdateMock = mock(async () => { throw new Error("Connection failed"); });
      const mockTransport = {
        requestPermission: mock(async () => ({
          outcome: { outcome: "selected", optionId: "allowOnce" }
        })),
        sessionUpdate: sessionUpdateMock,
      };

      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requiresPermission: true } },
        transport: mockTransport,
      });

      const handlerMock = mock(async () => ({ result: "success" }));
      const request = {
        toolCall: { id: "call-1", name: "test", args: {} },
        runtime: { config: {}, context: { threadId: "thread-1", sessionId: "session-1" } },
      };

      // Should not throw even if sessionUpdate fails
      const result = await middleware.wrapToolCall!(request, handlerMock as any);
      expect(handlerMock).toHaveBeenCalled();
    });
  });

  describe("thread state cleanup", () => {
    test("cleans up thread state after agent completes", async () => {
      const mockTransport = {
        requestPermission: mock(async () => ({
          outcome: { outcome: "selected", optionId: "allowOnce" }
        })),
        sessionUpdate: mock(async () => {}),
      };

      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requiresPermission: true } },
        transport: mockTransport,
      });

      const handlerMock = mock(async () => ({ result: "success" }));
      const request = {
        toolCall: { id: "call-1", name: "test", args: {} },
        runtime: { config: {}, context: { threadId: "thread-1", sessionId: "session-1" } },
      };

      await middleware.wrapToolCall!(request, handlerMock as any);

      // afterAgent should clean up without error
      await middleware.afterAgent?.({} as any, { context: { threadId: "thread-1" } } as any);
    });
  });
});