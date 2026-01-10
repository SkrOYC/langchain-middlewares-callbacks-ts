import { test, expect, describe, mock } from "bun:test";
import { createACPSessionMiddleware } from "../../../src/middleware/createACPSessionMiddleware";

describe("createACPSessionMiddleware", () => {
  describe("initialization", () => {
    test("returns middleware object", () => {
      const middleware = createACPSessionMiddleware();
      
      expect(middleware).toBeDefined();
      expect(typeof middleware).toBe("object");
      expect(middleware.name).toBe("acp-session-lifecycle");
    });

    test("accepts empty configuration", () => {
      const middleware = createACPSessionMiddleware({});
      expect(middleware).toBeDefined();
    });

    test("accepts custom sessionIdExtractor", () => {
      const customExtractor = (config: any) => config.customSessionId;
      const middleware = createACPSessionMiddleware({
        sessionIdExtractor: customExtractor
      });
      expect(middleware).toBeDefined();
    });

    test("accepts emitStateSnapshots configuration", () => {
      const middleware = createACPSessionMiddleware({
        emitStateSnapshots: "all"
      });
      expect(middleware).toBeDefined();
    });

    test("accepts lifecycle callbacks", () => {
      const onNewSession = mock((_sessionId: string, _state: any) => {});
      const onPrompt = mock((_sessionId: string, _state: any) => {});
      
      const middleware = createACPSessionMiddleware({
        onNewSession,
        onPrompt
      });
      
      expect(middleware).toBeDefined();
    });
  });

  describe("sessionId extraction", () => {
    test("extracts session ID from config.configurable.thread_id", async () => {
      const middleware = createACPSessionMiddleware();
      
      const state = {};
      const runtime = {
        config: { configurable: { thread_id: "session-123" } }
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      expect(result.acp_sessionId).toBe("session-123");
    });

    test("extracts session ID from runtime.context", async () => {
      const middleware = createACPSessionMiddleware();
      
      const state = {};
      const runtime = {
        config: {},
        context: { sessionId: "context-session" }
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      expect(result.acp_sessionId).toBe("context-session");
    });
  });

  describe("lifecycle callbacks", () => {
    test("calls onNewSession with session ID and state", async () => {
      const onNewSession = mock((sessionId: string, state: any) => {
        expect(sessionId).toBe("session-onNew");
        expect(state).toEqual({ messages: [] });
      });
      
      const middleware = createACPSessionMiddleware({
        onNewSession,
        emitStateSnapshots: "initial"
      });
      
      const state = { messages: [] };
      const runtime = {
        config: { configurable: { thread_id: "session-onNew" } }
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      await beforeAgent(state, runtime);
      
      expect(onNewSession).toHaveBeenCalled();
    });

    test("calls onPrompt with session ID and state", async () => {
      const onPrompt = mock((sessionId: string, state: any) => {
        expect(sessionId).toBe("session-prompt");
        expect(state).toEqual({ messages: [] });
      });
      
      const middleware = createACPSessionMiddleware({
        onPrompt
      });
      
      const state = { messages: [] };
      const runtime = {
        config: { configurable: { thread_id: "session-prompt" } }
      };
      
      const beforeModel = middleware.beforeModel as any;
      await beforeModel(state, runtime);
      
      expect(onPrompt).toHaveBeenCalled();
    });

    test("handles callback errors gracefully", async () => {
      const onPrompt = mock(() => {
        throw new Error("Callback error");
      });
      
      const middleware = createACPSessionMiddleware({
        onPrompt
      });
      
      const state = { messages: [] };
      const runtime = {
        config: { configurable: { thread_id: "session-error" } }
      };
      
      const beforeModel = middleware.beforeModel as any;
      // Should not throw
      await expect(beforeModel(state, runtime)).resolves.toBeDefined();
    });

    test("increments turn count in beforeModel", async () => {
      const middleware = createACPSessionMiddleware();
      
      const state = { messages: [] };
      const runtime = {
        config: { configurable: { thread_id: "session-turns" } }
      };
      
      const beforeModel = middleware.beforeModel as any;
      
      const result1 = await beforeModel(state, runtime);
      expect(result1.acp_turnCount).toBe(1);
      
      const result2 = await beforeModel(state, runtime);
      expect(result2.acp_turnCount).toBe(2);
    });
  });

  describe("state snapshot modes", () => {
    test("emits initial state when configured", async () => {
      const onNewSession = mock((_sessionId: string, _state: any) => {});
      
      const middleware = createACPSessionMiddleware({
        emitStateSnapshots: "initial",
        onNewSession
      });
      
      const state = { value: "test" };
      const runtime = {
        config: { configurable: { thread_id: "session-initial" } }
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      const result = await beforeAgent(state, runtime);
      
      expect(result.acp_shouldEmitSnapshot).toBe(true);
      expect(onNewSession).toHaveBeenCalled();
    });

    test("emits final state when configured", async () => {
      const middleware = createACPSessionMiddleware({
        emitStateSnapshots: "final"
      });
      
      const state = { finalValue: "completed" };
      const runtime = {
        config: { configurable: { thread_id: "session-final" } }
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      await beforeAgent(state, runtime);
      
      const afterAgent = middleware.afterAgent as any;
      const result = await afterAgent(state, runtime);
      
      expect(result.acp_shouldEmitSnapshot).toBe(true);
      expect(result.acp_finalState).toEqual(state);
    });

    test("applies stateMapper to final state", async () => {
      const stateMapper = (state: any) => ({ mapped: state.finalValue });
      const middleware = createACPSessionMiddleware({
        emitStateSnapshots: "final",
        stateMapper
      });
      
      const state = { finalValue: "completed" };
      const runtime = {
        config: { configurable: { thread_id: "session-final-mapped" } }
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      await beforeAgent(state, runtime);
      
      const afterAgent = middleware.afterAgent as any;
      const result = await afterAgent(state, runtime);
      
      expect(result.acp_finalState).toEqual({ mapped: "completed" });
    });

    test("stateMapper handles nested objects", async () => {
      const stateMapper = (state: any) => ({
        deep: {
          nested: {
            value: state.nested.value,
            computed: state.nested.value * 2
          }
        },
        items: state.items.map((item: any) => ({ ...item, processed: true }))
      });
      
      const middleware = createACPSessionMiddleware({
        emitStateSnapshots: "final",
        stateMapper
      });
      
      const state = {
        nested: { value: 42 },
        items: [{ id: 1, name: "first" }, { id: 2, name: "second" }]
      };
      const runtime = {
        config: { configurable: { thread_id: "session-nested-mapping" } }
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      await beforeAgent(state, runtime);
      
      const afterAgent = middleware.afterAgent as any;
      const result = await afterAgent(state, runtime);
      
      expect(result.acp_finalState.deep.nested.value).toBe(42);
      expect(result.acp_finalState.deep.nested.computed).toBe(84);
      expect(result.acp_finalState.items).toHaveLength(2);
      expect(result.acp_finalState.items[0].processed).toBe(true);
      expect(result.acp_finalState.items[1].processed).toBe(true);
    });

    test("stateMapper can completely change state structure", async () => {
      // This mapper transforms the state into a completely different structure
      const stateMapper = (state: any) => ({
        summary: {
          messageCount: state.messages.length,
          hasError: state.error !== null,
          timestamp: Date.now(),
          summary: `Processed ${state.messages.length} messages`
        },
        _meta: {
          originalKeys: Object.keys(state),
          transformedAt: new Date().toISOString()
        }
      });
      
      const middleware = createACPSessionMiddleware({
        emitStateSnapshots: "final",
        stateMapper
      });
      
      const state = {
        messages: [{ id: 1, text: "Hello" }, { id: 2, text: "World" }],
        error: null,
        metadata: { source: "test" }
      };
      const runtime = {
        config: { configurable: { thread_id: "session-structural-change" } }
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      await beforeAgent(state, runtime);
      
      const afterAgent = middleware.afterAgent as any;
      const result = await afterAgent(state, runtime);
      
      // Verify the structure was completely transformed
      expect(result.acp_finalState.summary).toBeDefined();
      expect(result.acp_finalState.summary.messageCount).toBe(2);
      expect(result.acp_finalState.summary.hasError).toBe(false);
      expect(result.acp_finalState._meta.originalKeys).toEqual(["messages", "error", "metadata"]);
      // Original state keys should NOT exist in transformed state
      expect(result.acp_finalState.messages).toBeUndefined();
      expect(result.acp_finalState.error).toBeUndefined();
    });
  });

  describe("state mapping in afterModel", () => {
    test("applies stateMapper in afterModel when emitStateSnapshots is 'all'", async () => {
      const stateMapper = (state: any) => ({ filtered: state.value });
      const middleware = createACPSessionMiddleware({
        emitStateSnapshots: "all",
        stateMapper
      });
      
      const state = { value: "model-state" };
      const runtime = {
        config: { configurable: { thread_id: "session-afterModel" } }
      };
      
      const afterModel = middleware.afterModel as any;
      const result = await afterModel(state, runtime);
      
      // Should have set acp_snapshotEmitted flag
      expect(result.acp_snapshotEmitted).toBe(true);
    });

    test("does not apply stateMapper when emitStateSnapshots is not 'all'", async () => {
      const stateMapper = (state: any) => ({ filtered: state.value });
      const middleware = createACPSessionMiddleware({
        emitStateSnapshots: "final",
        stateMapper
      });
      
      const state = { value: "model-state" };
      const runtime = {
        config: { configurable: { thread_id: "session-no-mapping" } }
      };
      
      const afterModel = middleware.afterModel as any;
      const result = await afterModel(state, runtime);
      
      // Should not have acp_snapshotEmitted when not in 'all' mode
      expect(result.acp_snapshotEmitted).toBeUndefined();
    });
  });

  describe("checkpointer", () => {
    test("creates a checkpointer with session ID", async () => {
      const { createACPCheckpointer } = await import("../../../src/middleware/createACPSessionMiddleware");
      const checkpointer = createACPCheckpointer("test-session");
      
      expect(checkpointer).toBeDefined();
      expect(typeof checkpointer.get).toBe("function");
      expect(typeof checkpointer.put).toBe("function");
      expect(typeof checkpointer.list).toBe("function");
    });

    test("checkpointer.get returns null for non-existent checkpoint", async () => {
      const { createACPCheckpointer } = await import("../../../src/middleware/createACPSessionMiddleware");
      const checkpointer = createACPCheckpointer("test-session");
      
      const result = await checkpointer.get("thread-1");
      expect(result).toBeNull();
    });

    test("checkpointer.put and get store and retrieve state", async () => {
      const { createACPCheckpointer } = await import("../../../src/middleware/createACPSessionMiddleware");
      const checkpointer = createACPCheckpointer("test-session");
      
      const state = { messages: [], value: "test" };
      await checkpointer.put("thread-1", "checkpoint-1", state);
      
      const result = await checkpointer.get("thread-1", "checkpoint-1");
      expect(result).toEqual(state);
    });

    test("checkpointer.list returns checkpoint IDs for session", async () => {
      const { createACPCheckpointer } = await import("../../../src/middleware/createACPSessionMiddleware");
      const checkpointer = createACPCheckpointer("test-session");
      
      // Create multiple checkpoints for different threads
      await checkpointer.put("thread-1", "checkpoint-1", {});
      await checkpointer.put("thread-1", "checkpoint-2", {});
      await checkpointer.put("thread-2", "checkpoint-1", {});
      
      const result1 = await checkpointer.list("thread-1");
      expect(result1).toHaveLength(2);
      expect(result1).toContainEqual({ checkpointId: "checkpoint-1" });
      expect(result1).toContainEqual({ checkpointId: "checkpoint-2" });
      
      const result2 = await checkpointer.list("thread-2");
      expect(result2).toHaveLength(1);
      expect(result2).toContainEqual({ checkpointId: "checkpoint-1" });
    });

    test("checkpointer.get with latest checkpoint ID", async () => {
      const { createACPCheckpointer } = await import("../../../src/middleware/createACPSessionMiddleware");
      const checkpointer = createACPCheckpointer("test-session");
      
      const state1 = { version: 1 };
      const state2 = { version: 2 };
      
      await checkpointer.put("thread-1", "v1", state1);
      await checkpointer.put("thread-1", "v2", state2);
      
      // Get without checkpointId should return latest
      const latest = await checkpointer.get("thread-1");
      expect(latest).toEqual(state2);
    });

    test("checkpointer handles complex nested state", async () => {
      const { createACPCheckpointer } = await import("../../../src/middleware/createACPSessionMiddleware");
      const checkpointer = createACPCheckpointer("test-session");
      
      const complexState = {
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" }
        ],
        context: {
          files: ["/src/index.ts", "/src/utils.ts"],
          variables: { DEBUG: true }
        },
        metadata: {
          timestamp: Date.now(),
          version: "1.0.0"
        }
      };
      
      await checkpointer.put("thread-complex", "complex-checkpoint", complexState);
      const result = await checkpointer.get("thread-complex", "complex-checkpoint");
      
      expect(result).toEqual(complexState);
      expect(result.messages).toHaveLength(2);
      expect(result.context.files).toHaveLength(2);
    });
  });

  describe("error handling", () => {
    test("middleware continues when onNewSession callback throws", async () => {
      const onNewSession = () => {
        throw new Error("Callback error");
      };
      
      const middleware = createACPSessionMiddleware({
        onNewSession
      });
      
      const state = { value: "test" };
      const runtime = {
        config: { configurable: { thread_id: "session-error-test" } }
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      // Should return valid result even when callback throws
      const result = await beforeAgent(state, runtime);
      expect(result.acp_sessionId).toBe("session-error-test");
      expect(result.acp_threadId).toBe("session-error-test");
    });

    test("middleware continues when onPrompt callback throws", async () => {
      const onPrompt = () => {
        throw new Error("Callback error");
      };
      
      const middleware = createACPSessionMiddleware({
        onPrompt
      });
      
      const state = { value: "test" };
      const runtime = {
        config: { configurable: { thread_id: "session-error-prompt" } }
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      await beforeAgent(state, runtime);
      
      const beforeModel = middleware.beforeModel as any;
      // Should return valid result even when callback throws
      const result = await beforeModel(state, runtime);
      expect(result.acp_turnCount).toBe(1);
      expect(result.acp_sessionId).toBe("session-error-prompt");
    });

    test("middleware handles multiple errors in sequence", async () => {
      let errorCount = 0;
      const onNewSession = () => {
        errorCount++;
        throw new Error(`Error ${errorCount}`);
      };
      
      const middleware = createACPSessionMiddleware({
        onNewSession
      });
      
      const runtime = {
        config: { configurable: { thread_id: "session-multi-error" } }
      };
      
      const beforeAgent = middleware.beforeAgent as any;
      
      // First run
      await beforeAgent({ value: "test1" }, runtime);
      expect(errorCount).toBe(1);
      
      // Second run should also work despite previous error
      await beforeAgent({ value: "test2" }, runtime);
      expect(errorCount).toBe(2);
      
      // Middleware should still be functional
      const afterAgent = middleware.afterAgent as any;
      const result = await afterAgent({ value: "test2" }, runtime);
      expect(result.acp_sessionId).toBe("session-multi-error");
    });
  });
});