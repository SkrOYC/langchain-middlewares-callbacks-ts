import { test, expect, describe, mock } from "bun:test";
import { createACPModeMiddleware, STANDARD_MODES } from "../../../src/middleware/createACPModeMiddleware";

describe("createACPModeMiddleware", () => {
  describe("initialization", () => {
    test("returns middleware object", () => {
      const middleware = createACPModeMiddleware({
        modes: { agentic: { systemPrompt: "You are helpful." } },
        defaultMode: "agentic",
      });
      
      expect(middleware).toBeDefined();
      expect(typeof middleware).toBe("object");
      expect(middleware.name).toBe("acp-mode-control");
    });

    test("throws error when modes is empty", () => {
      expect(() => {
        createACPModeMiddleware({
          modes: {},
          defaultMode: "agentic",
        });
      }).toThrow("Mode middleware requires at least one mode configuration");
    });

    test("throws error when defaultMode is not in modes", () => {
      expect(() => {
        createACPModeMiddleware({
          modes: { agentic: { systemPrompt: "You are helpful." } },
          defaultMode: "nonexistent",
        });
      }).toThrow('Default mode "nonexistent" is not defined in modes configuration');
    });

    test("accepts configuration with single mode", () => {
      const middleware = createACPModeMiddleware({
        modes: { agentic: { systemPrompt: "You are helpful." } },
        defaultMode: "agentic",
      });
      
      expect(middleware).toBeDefined();
    });

    test("accepts configuration with multiple modes", () => {
      const middleware = createACPModeMiddleware({
        modes: {
          agentic: { systemPrompt: "You have full autonomy." },
          readonly: { systemPrompt: "You can only read.", allowedTools: ["read_file"] },
        },
        defaultMode: "agentic",
      });
      
      expect(middleware).toBeDefined();
    });

    test("accepts custom sessionIdExtractor", () => {
      const customExtractor = (config: any) => config.customSessionId;
      const middleware = createACPModeMiddleware({
        modes: { agentic: { systemPrompt: "You are helpful." } },
        defaultMode: "agentic",
        sessionIdExtractor: customExtractor,
      });
      
      expect(middleware).toBeDefined();
    });

    test("accepts transport configuration", () => {
      const mockTransport = {
        sessionUpdate: mock(async () => {}),
      };
      
      const middleware = createACPModeMiddleware({
        modes: { agentic: { systemPrompt: "You are helpful." } },
        defaultMode: "agentic",
        transport: mockTransport,
      });
      
      expect(middleware).toBeDefined();
    });
  });

  describe("mode selection", () => {
    test("uses defaultMode when no mode specified", async () => {
      const middleware = createACPModeMiddleware({
        modes: {
          agentic: { systemPrompt: "Full autonomy." },
          readonly: { systemPrompt: "Read-only mode." },
        },
        defaultMode: "readonly",
      });
      
      const state = {};
      const runtime = {
        config: {},
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      expect(result.acp_mode).toBe("readonly");
    });

    test("extracts mode from config.configurable.acp_mode", async () => {
      const middleware = createACPModeMiddleware({
        modes: {
          agentic: { systemPrompt: "Full autonomy." },
          interactive: { systemPrompt: "Interactive mode." },
        },
        defaultMode: "agentic",
      });
      
      const state = {};
      const runtime = {
        config: { configurable: { acp_mode: "interactive" } },
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      expect(result.acp_mode).toBe("interactive");
    });

    test("extracts mode from config.mode", async () => {
      const middleware = createACPModeMiddleware({
        modes: {
          agentic: { systemPrompt: "Full autonomy." },
          planning: { systemPrompt: "Planning mode." },
        },
        defaultMode: "agentic",
      });
      
      const state = {};
      const runtime = {
        config: { mode: "planning" },
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      expect(result.acp_mode).toBe("planning");
    });

    test("extracts mode from config.modeId", async () => {
      const middleware = createACPModeMiddleware({
        modes: {
          agentic: { systemPrompt: "Full autonomy." },
          readonly: { systemPrompt: "Read-only mode." },
        },
        defaultMode: "agentic",
      });
      
      const state = {};
      const runtime = {
        config: { modeId: "readonly" },
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      expect(result.acp_mode).toBe("readonly");
    });

    test("throws error for undefined mode", async () => {
      const middleware = createACPModeMiddleware({
        modes: {
          agentic: { systemPrompt: "Full autonomy." },
        },
        defaultMode: "agentic",
      });
      
      const state = {};
      const runtime = {
        config: { configurable: { acp_mode: "nonexistent" } },
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      
      await expect(beforeAgent(state, runtime)).rejects.toThrow('Mode "nonexistent" is not configured');
    });
  });

  describe("mode configuration application", () => {
    test("applies modeConfig to state", async () => {
      const modeConfig = { systemPrompt: "Custom prompt.", description: "Test mode" };
      const middleware = createACPModeMiddleware({
        modes: { test: modeConfig },
        defaultMode: "test",
      });
      
      const state = {};
      const runtime = {
        config: {},
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      expect(result.acp_modeConfig).toEqual(modeConfig);
    });

    test("applies allowedTools from mode config", async () => {
      const middleware = createACPModeMiddleware({
        modes: {
          readonly: {
            systemPrompt: "Read-only mode.",
            allowedTools: ["read_file", "search"],
            requirePermission: false,
          },
        },
        defaultMode: "readonly",
      });
      
      const state = {};
      const runtime = {
        config: {},
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      expect(result.acp_modeConfig.allowedTools).toEqual(["read_file", "search"]);
      expect(result.acp_modeConfig.requirePermission).toBe(false);
    });

    test("applies requirePermission from mode config", async () => {
      const middleware = createACPModeMiddleware({
        modes: {
          interactive: {
            systemPrompt: "Interactive mode.",
            requirePermission: true,
          },
        },
        defaultMode: "interactive",
      });
      
      const state = {};
      const runtime = {
        config: {},
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      expect(result.acp_modeConfig.requirePermission).toBe(true);
    });
  });

  describe("session ID extraction", () => {
    test("extracts session ID from config.configurable.session_id", async () => {
      const middleware = createACPModeMiddleware({
        modes: { agentic: { systemPrompt: "You are helpful." } },
        defaultMode: "agentic",
      });
      
      const state = {};
      const runtime = {
        config: { configurable: { session_id: "test-session-123" } },
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      expect(result.acp_sessionId).toBe("test-session-123");
    });

    test("extracts session ID from config.configurable.sessionId", async () => {
      const middleware = createACPModeMiddleware({
        modes: { agentic: { systemPrompt: "You are helpful." } },
        defaultMode: "agentic",
      });
      
      const state = {};
      const runtime = {
        config: { configurable: { sessionId: "session-from-config" } },
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      expect(result.acp_sessionId).toBe("session-from-config");
    });

    test("uses custom sessionIdExtractor when provided", async () => {
      const customExtractor = mock((config: any) => config.customSessionId);
      
      const middleware = createACPModeMiddleware({
        modes: { agentic: { systemPrompt: "You are helpful." } },
        defaultMode: "agentic",
        sessionIdExtractor: customExtractor,
      });
      
      const state = {};
      const runtime = {
        config: { customSessionId: "custom-session" },
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      expect(customExtractor).toHaveBeenCalled();
      expect(result.acp_sessionId).toBe("custom-session");
    });
  });

  describe("current_mode_update emission", () => {
    test("emits current_mode_update when transport is provided", async () => {
      const sessionUpdateMock = mock(async () => {});
      const mockTransport = {
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPModeMiddleware({
        modes: { agentic: { systemPrompt: "Full autonomy." } },
        defaultMode: "agentic",
        transport: mockTransport,
      });
      
      const state = {};
      const runtime = {
        config: { configurable: { session_id: "test-session" } },
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      await beforeAgent(state, runtime);
      
      expect(sessionUpdateMock).toHaveBeenCalled();
      const callArg = sessionUpdateMock.mock.calls[0][0];
      expect(callArg.sessionId).toBe("test-session");
      expect(callArg.update.sessionUpdate).toBe("current_mode_update");
      expect(callArg.update.currentModeId).toBe("agentic");
    });

    test("does not emit when no transport provided", async () => {
      const middleware = createACPModeMiddleware({
        modes: { agentic: { systemPrompt: "Full autonomy." } },
        defaultMode: "agentic",
      });
      
      const state = {};
      const runtime = {
        config: { configurable: { session_id: "test-session" } },
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      // Should not throw and should still return mode info
      expect(result.acp_mode).toBe("agentic");
    });

    test("does not emit when no session ID available", async () => {
      const sessionUpdateMock = mock(async () => {});
      const mockTransport = {
        sessionUpdate: sessionUpdateMock,
      };
      
      const middleware = createACPModeMiddleware({
        modes: { agentic: { systemPrompt: "Full autonomy." } },
        defaultMode: "agentic",
        transport: mockTransport,
      });
      
      const state = {};
      const runtime = {
        config: {},
        context: {},
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      await beforeAgent(state, runtime);
      
      // Should not emit when no session ID
      expect(sessionUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe("thread state cleanup", () => {
    test("cleans up thread state after agent execution", async () => {
      const middleware = createACPModeMiddleware({
        modes: { agentic: { systemPrompt: "Full autonomy." } },
        defaultMode: "agentic",
      });
      
      const state = {};
      const runtime = {
        config: {},
        context: { threadId: "test-thread" },
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const afterAgent = middleware.afterAgent as any;
      
      // Execute beforeAgent to set up thread state
      await beforeAgent(state, runtime);
      
      // Execute afterAgent to clean up
      await afterAgent(state, runtime);
      
      // Should complete without errors
      expect(true).toBe(true);
    });
  });

  describe("STANDARD_MODES", () => {
    test("contains agentic mode", () => {
      expect(STANDARD_MODES.agentic).toBeDefined();
      expect(STANDARD_MODES.agentic.systemPrompt).toContain("full autonomy");
    });

    test("contains interactive mode", () => {
      expect(STANDARD_MODES.interactive).toBeDefined();
      expect(STANDARD_MODES.interactive.systemPrompt).toContain("confirmation");
      expect(STANDARD_MODES.interactive.requirePermission).toBe(true);
    });

    test("contains readonly mode", () => {
      expect(STANDARD_MODES.readonly).toBeDefined();
      expect(STANDARD_MODES.readonly.systemPrompt).toContain("read-only");
      expect(STANDARD_MODES.readonly.allowedTools).toBeDefined();
      expect(STANDARD_MODES.readonly.allowedTools?.length).toBeGreaterThan(0);
    });

    test("contains planning mode", () => {
      expect(STANDARD_MODES.planning).toBeDefined();
      expect(STANDARD_MODES.planning.systemPrompt).toContain("planning");
    });
  });

  describe("context schema", () => {
    test("middleware accepts context with thread_id", async () => {
      const middleware = createACPModeMiddleware({
        modes: { agentic: { systemPrompt: "You are helpful." } },
        defaultMode: "agentic",
      });
      
      expect(middleware.contextSchema).toBeDefined();
    });
  });
});
