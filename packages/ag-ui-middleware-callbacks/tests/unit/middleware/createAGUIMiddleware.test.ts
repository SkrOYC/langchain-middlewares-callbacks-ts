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

test("Middleware beforeModel emits TEXT_MESSAGE_START", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { messages: [] };
  const runtime = {
    config: { metadata: {} },
    context: { transport: mockTransport }
  };

  const result = await middleware.beforeModel?.(state, runtime);

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "TEXT_MESSAGE_START",
      role: "assistant"
    })
  );
  expect(result).toBeDefined();
});

test("Middleware beforeModel generates unique messageId", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { messages: [] };
  const runtime = {
    config: { metadata: {} },
    context: { transport: mockTransport }
  };

  await middleware.beforeModel?.(state, runtime);

  const messageId1 = runtime.config.metadata.agui_messageId;
  await middleware.beforeModel?.(state, runtime);
  const messageId2 = runtime.config.metadata.agui_messageId;

  expect(messageId1).toBeDefined();
  expect(messageId2).toBeDefined();
  expect(messageId1).not.toBe(messageId2);
});

test("Middleware beforeModel sets messageId in metadata", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { messages: [] };
  const runtime = {
    config: { metadata: {} },
    context: { transport: mockTransport }
  };

  await middleware.beforeModel?.(state, runtime);

  expect(runtime.config.metadata.agui_messageId).toBeDefined();
  expect(typeof runtime.config.metadata.agui_messageId).toBe("string");
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

test("Middleware afterModel emits TEXT_MESSAGE_END", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { messages: [] };
  const runtime = {
    config: { metadata: { agui_messageId: "msg-123" } },
    context: { transport: mockTransport }
  };

  await middleware.afterModel?.(state, runtime);

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "TEXT_MESSAGE_END",
      messageId: "msg-123"
    })
  );
});

test("Middleware afterModel cleans metadata", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { messages: [] };
  const runtime = {
    config: { metadata: { agui_messageId: "msg-123" } },
    context: { transport: mockTransport }
  };

  await middleware.afterModel?.(state, runtime);

  expect(runtime.config.metadata.agui_messageId).toBeUndefined();
});

test("Middleware afterModel emits STEP_FINISHED", async () => {
  const mockTransport = createMockTransport();
  const middleware = createAGUIMiddleware({ transport: mockTransport });

  const state = { messages: [] };
  const runtime = {
    config: { metadata: { agui_messageId: "msg-123" } },
    context: { transport: mockTransport }
  };

  await middleware.afterModel?.(state, runtime);

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
