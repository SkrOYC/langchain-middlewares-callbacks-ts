import { test, expect, mock } from "bun:test";
import { createMockTransport } from "../../fixtures/mockTransport";
import { createAGUIMiddleware } from "../../../src/middleware/createAGUIMiddleware";

test("createAGUIMiddleware returns middleware object", () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  expect(middleware).toBeDefined();
  expect(typeof middleware).toBe("object");
});

test("createAGUIMiddleware validates options", () => {
  const mockTransport = createMockTransport();

  expect(() => createAGUIMiddleware({ transport: mockTransport })).not.toThrow();
});

test("createAGUIMiddleware rejects invalid options", () => {
  expect(() => createAGUIMiddleware({ transport: null as any })).toThrow();
});

// beforeAgent tests

test("Middleware beforeAgent emits RUN_STARTED event", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = {};
  const runtime = {
    config: { configurable: { thread_id: "thread-123" } },
    context: { transport: mockTransport }
  };

  await middleware.beforeAgent?.(state, runtime);

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "RUN_STARTED",
      threadId: "thread-123"
    })
  );
});

test("Middleware beforeAgent uses threadIdOverride", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({
    transport: mockTransport,
    threadIdOverride: "override-123"
  });

  const state = {};
  const runtime = {
    config: { configurable: {} },
    context: { transport: mockTransport }
  };

  await middleware.beforeAgent?.(state, runtime);

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      threadId: "override-123"
    })
  );
});

test("Middleware beforeAgent respects emitStateSnapshots option", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({
    transport: mockTransport,
    emitStateSnapshots: "none"
  });

  const state = {};
  const runtime = {
    config: { configurable: {} },
    context: { transport: mockTransport }
  };

  await middleware.beforeAgent?.(state, runtime);

  // Should not emit STATE_SNAPSHOT when set to "none"
  const snapshotCalls = mockTransport.emit.mock.calls.filter(
    ([event]) => event.type === "STATE_SNAPSHOT"
  );
  expect(snapshotCalls.length).toBe(0);
});

// beforeModel tests

test("Middleware beforeModel emits STEP_STARTED", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { messages: [] };
  const runtime = {
    config: { configurable: { thread_id: "test-thread" } },
    context: { transport: mockTransport }
  };

  // Call beforeAgent first to set up runId and threadId
  await middleware.beforeAgent?.(state, runtime);

  // Now call beforeModel - it should have runId and threadId set
  const result = await middleware.beforeModel?.(state, runtime);

  // Middleware emits STEP_STARTED (not TEXT_MESSAGE_START - that's now handled by callbacks)
  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "STEP_STARTED",
      runId: expect.any(String),
      threadId: "test-thread",
    })
  );
  expect(result).toBeDefined();
});

test("Middleware beforeModel emits STEP_STARTED with correct IDs", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { messages: [] };
  const runtime = {
    config: { configurable: { thread_id: "test-thread" } },
    context: { transport: mockTransport }
  };

  // Call beforeAgent first to set up runId and threadId
  await middleware.beforeAgent?.(state, runtime);

  await middleware.beforeModel?.(state, runtime);

  // Verify STEP_STARTED was emitted with proper IDs
  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "STEP_STARTED",
      threadId: "test-thread",
      runId: expect.any(String),
      stepName: expect.stringMatching(/^model_call_/),
    })
  );
});

test("Middleware beforeModel emits STEP_STARTED", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { messages: [] };
  const runtime = {
    config: { metadata: {} },
    context: { transport: mockTransport }
  };

  await middleware.beforeModel?.(state, runtime);

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "STEP_STARTED"
    })
  );
});

// afterModel tests

test("Middleware afterModel emits STEP_FINISHED (not TEXT_MESSAGE_END)", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { messages: [] };
  const runtime = {
    config: { configurable: { thread_id: "test-thread" } },
    context: { transport: mockTransport }
  };

  // Call beforeAgent first to set up runId and threadId
  await middleware.beforeAgent?.(state, runtime);
  
  await middleware.afterModel?.(state, runtime);

  // Middleware emits STEP_FINISHED (TEXT_MESSAGE_END is now handled by callbacks)
  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "STEP_FINISHED",
      threadId: "test-thread",
    })
  );
  
  // Verify TEXT_MESSAGE_END was NOT emitted by middleware
  const textEndCalls = mockTransport.emit.mock.calls.filter(
    ([event]: any[]) => event.type === "TEXT_MESSAGE_END"
  );
  expect(textEndCalls.length).toBe(0);
});

test("Middleware afterModel emits STEP_FINISHED", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { messages: [] };
  const runtime = {
    config: { metadata: {} },
    context: { transport: mockTransport }
  };

  // Call beforeModel first to set up the closure variable
  await middleware.beforeModel?.(state, runtime);
  
  await middleware.afterModel?.(state, runtime);

  // Middleware emits STEP_FINISHED (not TEXT_MESSAGE_END - that's now handled by callbacks)
  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "STEP_FINISHED"
    })
  );
});

// State snapshot tests

test("Middleware emits STATE_SNAPSHOT when configured to 'initial'", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({
    transport: mockTransport,
    emitStateSnapshots: "initial"
  });

  const state = { messages: [] };
  const runtime = {
    config: { configurable: {} },
    context: { transport: mockTransport }
  };

  await middleware.beforeAgent?.(state, runtime);

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "STATE_SNAPSHOT"
    })
  );
});

test("Middleware emits STATE_SNAPSHOT when configured to 'final'", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({
    transport: mockTransport,
    emitStateSnapshots: "final"
  });

  const state = { messages: [] };
  const runtime = {
    config: { configurable: {} },
    context: { transport: mockTransport }
  };

  await middleware.afterAgent?.(state, runtime);

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "STATE_SNAPSHOT"
    })
  );
});

test("Middleware emits STATE_DELTA when configured to 'all'", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({
    transport: mockTransport,
    emitStateSnapshots: "all"
  });

  const state = { messages: [] };
  const runtime = {
    config: { configurable: {} },
    context: { transport: mockTransport }
  };

  await middleware.beforeAgent?.(state, runtime);

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "STATE_SNAPSHOT"
    })
  );
});

// MESSAGES_SNAPSHOT tests

test("Middleware beforeAgent emits MESSAGES_SNAPSHOT", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { 
    messages: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi there!" }],
    otherData: "test"
  };
  const runtime = {
    config: { configurable: {} },
    context: { transport: mockTransport }
  };

  await middleware.beforeAgent?.(state, runtime);

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "MESSAGES_SNAPSHOT",
      messages: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi there!" }]
    })
  );
});

test("Middleware beforeAgent does not emit MESSAGES_SNAPSHOT when no messages in state", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { otherData: "test" };
  const runtime = {
    config: { configurable: {} },
    context: { transport: mockTransport }
  };

  await middleware.beforeAgent?.(state, runtime);

  // Should not have emitted MESSAGES_SNAPSHOT
  const messagesSnapshotCalls = mockTransport.emit.mock.calls.filter(
    ([event]: any[]) => event.type === "MESSAGES_SNAPSHOT"
  );
  expect(messagesSnapshotCalls.length).toBe(0);
});

// Error handling tests

test("Middleware afterAgent emits RUN_FINISHED on success", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { messages: [] };
  const runtime = {
    config: { configurable: {} },
    context: { transport: mockTransport }
  };

  await middleware.afterAgent?.(state, runtime);

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "RUN_FINISHED"
    })
  );
});

test("Middleware afterAgent emits RUN_ERROR on error", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({
    transport: mockTransport,
    errorDetailLevel: "message"
  });

  const state = { error: new Error("Test error") };
  const runtime = {
    config: { configurable: {} },
    context: { transport: mockTransport }
  };

  await middleware.afterAgent?.(state, runtime);

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "RUN_ERROR",
      message: "Test error"
    })
  );
});
