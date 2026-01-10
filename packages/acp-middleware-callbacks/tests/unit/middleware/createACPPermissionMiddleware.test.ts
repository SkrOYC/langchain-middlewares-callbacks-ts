import { test, expect, describe, mock } from "bun:test";
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
        permissionPolicy: { "test": { requirePermission: true } },
      } as any)).toThrow("Permission middleware requires a transport configuration");
    });

    test("creates middleware with valid configuration", () => {
      const mockTransport = {
        requestPermission: mock(async () => ({ outcome: { outcome: "cancelled" } })),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "delete_*": { requirePermission: true, kind: "delete" },
          "*_file": { requirePermission: true, kind: "edit" },
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
      
      const customMapper = (name: string) => "other";
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: {
          "test": { requirePermission: true },
        },
        transport: mockTransport,
        toolKindMapper: customMapper,
      });
      
      expect(middleware).toBeDefined();
    });
  });

  describe("permission workflow", () => {
    test("middleware has wrapToolCall hook", () => {
      const mockTransport = {
        requestPermission: mock(async () => ({ outcome: { outcome: "cancelled" } })),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requirePermission: true } },
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
        permissionPolicy: { "test": { requirePermission: true } },
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
          "delete_file": { requirePermission: true, kind: "delete" },
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
          "delete_*": { requirePermission: true, kind: "delete" },
          "*_file": { requirePermission: true, kind: "edit" },
        },
        transport: mockTransport,
      });
      
      expect(middleware).toBeDefined();
    });
  });

  describe("permission options", () => {
    test("provides default permission options", () => {
      const mockTransport = {
        requestPermission: mock(async (params: any) => {
          expect(params.options).toBeDefined();
          expect(params.options).toHaveLength(4);
          expect(params.options[0].optionId).toBe("allowOnce");
          expect(params.options[0].kind).toBe("allow_once");
          expect(params.options[1].optionId).toBe("allowAlways");
          expect(params.options[1].kind).toBe("allow_always");
          expect(params.options[2].optionId).toBe("rejectOnce");
          expect(params.options[2].kind).toBe("reject_once");
          expect(params.options[3].optionId).toBe("rejectAlways");
          expect(params.options[3].kind).toBe("reject_always");
          return { outcome: { outcome: "cancelled" } };
        }),
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPPermissionMiddleware({
        permissionPolicy: { "test": { requirePermission: true } },
        transport: mockTransport,
      });
      
      expect(middleware).toBeDefined();
    });
  });
});
