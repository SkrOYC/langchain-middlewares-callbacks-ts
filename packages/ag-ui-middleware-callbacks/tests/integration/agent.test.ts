import { test, expect, mock } from "bun:test";
import { createMockTransport } from "../fixtures/mockTransport";
import { createAGUIAgent } from "../../src/createAGUIAgent";

test("createAGUIAgent returns an agent object", () => {
  const mockTransport = createMockTransport();
  const fakeModel = { invoke: mock(async () => ({ messages: [] })) };
  const fakeTools = [];

  const agent = createAGUIAgent({
    model: fakeModel as any,
    tools: fakeTools,
    transport: mockTransport
  });

  expect(agent).toBeDefined();
  expect(typeof agent.invoke).toBe("function");
});

test("createAGUIAgent accepts middlewareOptions", () => {
  const mockTransport = createMockTransport();
  const fakeModel = { invoke: mock(async () => ({ messages: [] })) };
  const fakeTools = [];

  expect(() => {
    createAGUIAgent({
      model: fakeModel as any,
      tools: fakeTools,
      transport: mockTransport,
      middlewareOptions: {
        emitToolResults: false,
        errorDetailLevel: "full"
      }
    });
  }).not.toThrow();
});

test("createAGUIAgent withConfig binds callbacks", async () => {
  const mockTransport = createMockTransport();
  const fakeModel = {
    invoke: mock(async (input) => ({
      messages: [...input.messages, { role: "assistant", content: "Hello" }]
    }))
  };
  const fakeTools = [];

  const agent = createAGUIAgent({
    model: fakeModel as any,
    tools: fakeTools,
    transport: mockTransport
  });

  await agent.invoke({ messages: [{ role: "user", content: "Hi" }] });

  expect(mockTransport.emit).toHaveBeenCalled();
});

test("createAGUIAgent merges user callbacks with AG-UI callbacks", async () => {
  const mockTransport = createMockTransport();
  const fakeModel = {
    invoke: mock(async (input) => ({
      messages: [...input.messages, { role: "assistant", content: "Hello" }]
    }))
  };
  const fakeTools = [];

  const userCallback = {
    handleLLMStart: mock(() => {}),
    handleLLMEnd: mock(() => {})
  };

  const agent = createAGUIAgent({
    model: fakeModel as any,
    tools: fakeTools,
    transport: mockTransport
  });

  await agent.invoke(
    { messages: [{ role: "user", content: "Hi" }] },
    { callbacks: [userCallback] }
  );

  expect(userCallback.handleLLMStart).toHaveBeenCalled();
  expect(userCallback.handleLLMEnd).toHaveBeenCalled();
  expect(mockTransport.emit).toHaveBeenCalled();
});

test("createAGUIAgent emits RUN_STARTED on invoke", async () => {
  const mockTransport = createMockTransport();
  const fakeModel = {
    invoke: mock(async (input) => ({
      messages: [...input.messages, { role: "assistant", content: "Hello" }]
    }))
  };
  const fakeTools = [];

  const agent = createAGUIAgent({
    model: fakeModel as any,
    tools: fakeTools,
    transport: mockTransport
  });

  await agent.invoke(
    { messages: [{ role: "user", content: "Hi" }] },
    { configurable: { thread_id: "thread-123" } }
  );

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "RUN_STARTED"
    })
  );
});

test("createAGUIAgent emits RUN_FINISHED on success", async () => {
  const mockTransport = createMockTransport();
  const fakeModel = {
    invoke: mock(async (input) => ({
      messages: [...input.messages, { role: "assistant", content: "Hello" }]
    }))
  };
  const fakeTools = [];

  const agent = createAGUIAgent({
    model: fakeModel as any,
    tools: fakeTools,
    transport: mockTransport
  });

  await agent.invoke({ messages: [{ role: "user", content: "Hi" }] });

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "RUN_FINISHED"
    })
  );
});

test("createAGUIAgent withListeners emits TEXT_MESSAGE_END on error", async () => {
  const mockTransport = createMockTransport();
  const fakeModel = {
    invoke: mock(async () => {
      throw new Error("Model error");
    })
  };
  const fakeTools = [];

  const agent = createAGUIAgent({
    model: fakeModel as any,
    tools: fakeTools,
    transport: mockTransport
  });

  await expect(
    agent.invoke({ messages: [{ role: "user", content: "Hi" }] })
  ).rejects.toThrow("Model error");

  // Verify cleanup event was emitted
  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "TEXT_MESSAGE_END"
    })
  );
});

test("createAGUIAgent handles multiple tool calls", async () => {
  const mockTransport = createMockTransport();
  const fakeModel = {
    invoke: mock(async (input) => ({
      messages: [...input.messages, { role: "assistant", content: "Done" }]
    }))
  };
  const fakeTools = [
    { name: "tool1", call: mock(() => "result1"), schema: {} },
    { name: "tool2", call: mock(() => "result2"), schema: {} }
  ];

  const agent = createAGUIAgent({
    model: fakeModel as any,
    tools: fakeTools,
    transport: mockTransport
  });

  await agent.invoke({ messages: [{ role: "user", content: "Use tools" }] });

  expect(mockTransport.emit).toHaveBeenCalled();
});
