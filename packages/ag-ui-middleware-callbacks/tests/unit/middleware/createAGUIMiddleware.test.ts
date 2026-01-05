import { test, expect, describe } from "bun:test";
import { createMockTransport } from "../../fixtures/mockTransport";
import { createAGUIMiddleware } from "../../../src/middleware/createAGUIMiddleware";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

describe("createAGUIMiddleware", () => {
  const mockTransport = createMockTransport();

  test("returns middleware object", () => {
    const middleware = createAGUIMiddleware({ transport: mockTransport } as any);

    expect(middleware).toBeDefined();
    expect(typeof middleware).toBe("object");
  });

  describe("beforeAgent", () => {
    test("emits RUN_STARTED and mapped MESSAGES_SNAPSHOT (Red Phase)", async () => {
      const middleware = createAGUIMiddleware({ transport: mockTransport } as any);

      const state = {
        messages: [
          new HumanMessage("Hello"),
          new AIMessage("Hi there!")
        ]
      };
      const runtime = {
        config: { configurable: { thread_id: "thread-123", run_id: "run-123" } },
        context: { transport: mockTransport }
      };

      const beforeAgent = middleware.beforeAgent as any;
      await beforeAgent(state, runtime);

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "RUN_STARTED",
          threadId: "thread-123"
        })
      );

      // Verify MESSAGES_SNAPSHOT uses mapped AG-UI messages
      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "MESSAGES_SNAPSHOT",
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "Hello" }),
            expect.objectContaining({ role: "assistant", content: "Hi there!" })
          ])
        })
      );
    });

    test("applies stateMapper if provided", async () => {
      const stateMapper = (state: any) => ({ curated: state.secret ? "hidden" : "visible" });
      const middleware = createAGUIMiddleware({ 
        transport: mockTransport,
        stateMapper,
        emitStateSnapshots: "initial"
      } as any);

      const state = { secret: "top-secret", other: "public" };
      const runtime = {
        config: { configurable: { run_id: "run-123" } },
        context: { transport: mockTransport }
      };

      const beforeAgent = middleware.beforeAgent as any;
      await beforeAgent(state, runtime);

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "STATE_SNAPSHOT",
          snapshot: { curated: "hidden" }
        })
      );
    });

    test("filters 'messages' from STATE_SNAPSHOT by default (Red Phase)", async () => {
      const middleware = createAGUIMiddleware({ transport: mockTransport } as any);
      const state = { 
        messages: [new HumanMessage("test")],
        app_data: "keep me"
      };
      const runtime = {
        config: { configurable: { run_id: "run-123" } },
        context: { transport: mockTransport }
      };

      const beforeAgent = middleware.beforeAgent as any;
      await beforeAgent(state, runtime);

      const snapshotCall = mockTransport.emit.mock.calls.find(call => call[0].type === "STATE_SNAPSHOT");
      expect(snapshotCall).toBeDefined();
      // This should FAIL currently because we haven't implemented filtering yet
      expect(snapshotCall![0].snapshot.messages).toBeUndefined();
    });
  });

  describe("Step/Activity Correlation (Red Phase)", () => {
    test("emits ACTIVITY_SNAPSHOT for configured steps", async () => {
      const middleware = createAGUIMiddleware({ 
        transport: mockTransport,
        emitActivities: true
      } as any);

      const state = {};
      const runtime = {
        config: { configurable: { thread_id: "t1", run_id: "run-123" } },
        context: { transport: mockTransport }
      };

      const beforeAgent = middleware.beforeAgent as any;
      await beforeAgent(state, runtime);
      
      const beforeModel = middleware.beforeModel as any;
      await beforeModel(state, runtime);

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ACTIVITY_SNAPSHOT",
          activityType: expect.any(String),
          messageId: expect.any(String)
        })
      );
    });
  });

  describe("afterAgent", () => {
    test("applies resultMapper to RUN_FINISHED (Red Phase)", async () => {
      const resultMapper = (result: any) => ({ status: "done", count: result.messages.length });
      const middleware = createAGUIMiddleware({ 
        transport: mockTransport,
        resultMapper
      } as any);

      const state = { messages: ["msg1", "msg2"] };
      const runtime = {
        config: { configurable: { thread_id: "t1", run_id: "run-123" } },
        context: { transport: mockTransport }
      };

      const beforeAgent = middleware.beforeAgent as any;
      await beforeAgent(state, runtime);

      const afterAgent = middleware.afterAgent as any;
      await afterAgent(state, runtime);

      expect(mockTransport.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "RUN_FINISHED",
          result: { status: "done", count: 2 }
        })
      );
    });
  });
});
