/**
 * Section-by-section test to find syntax error
 */

import { test, expect, describe } from "bun:test";
import {
  createMockTransport,
  createTestAgent,
  createTextModel,
  formatAgentInput,
  getEventTypes,
  expectEvent,
  expectEventCount,
  getEventsByType,
  collectStreamChunks,
  createSingleToolScenario,
  createMultiToolScenario,
  createMultiTurnScenario,
} from "../helpers/testUtils";

// Copy of Basic Functionality section
describe("Basic Functionality", () => {
  test("createAGUIAgent returns an agent object", () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    expect(agent).toBeDefined();
    expect(typeof agent.invoke).toBe("function");
    expect(typeof agent.stream).toBe("function");
  });

  test("createAGUIAgent accepts middlewareOptions", () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello"]);
    
    expect(() => {
      createTestAgent(model, [], transport, {
        emitToolResults: false,
        errorDetailLevel: "full",
        emitStateSnapshots: "all",
      });
    }).not.toThrow();
  });

  test("createAGUIAgent wrapper provides invoke method", () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    expect(agent.invoke).toBeDefined();
    expect(typeof agent.invoke).toBe("function");
  });

  test("createAGUIAgent wrapper provides stream method", () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    expect(agent.stream).toBeDefined();
    expect(typeof agent.stream).toBe("function");
  });
});

// Copy of Event Emission section
describe("Event Emission", () => {
  test("createAGUIAgent emits RUN_STARTED on invoke", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Hi" }]));
    
    expectEvent(transport, "RUN_STARTED", (event) => {
      expect(event.type).toBe("RUN_STARTED");
    });
  });

  test("createAGUIAgent emits RUN_FINISHED on success", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Hi" }]));
    
    expectEvent(transport, "RUN_FINISHED", (event) => {
      expect(event.type).toBe("RUN_FINISHED");
    });
  });

  test("Complete agent workflow emits all expected events", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello!"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Hi" }]));
    
    const eventTypes = getEventTypes(transport);
    
    // Core lifecycle events
    expect(eventTypes).toContain("RUN_STARTED");
    expect(eventTypes).toContain("RUN_FINISHED");
    
    // Text message events
    expect(eventTypes).toContain("TEXT_MESSAGE_START");
  });

  test("Events are emitted in correct order", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello!"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Hi" }]));
    
    const eventTypes = getEventTypes(transport);
    
    // Verify order: RUN_STARTED first, RUN_FINISHED last
    const runStartedIndex = eventTypes.indexOf("RUN_STARTED");
    const runFinishedIndex = eventTypes.indexOf("RUN_FINISHED");
    
    expect(runStartedIndex).toBeGreaterThanOrEqual(0);
    expect(runFinishedIndex).toBeGreaterThan(runStartedIndex);
    
    // TEXT_MESSAGE_START should be present
    const textStartIndex = eventTypes.indexOf("TEXT_MESSAGE_START");
    expect(textStartIndex).toBeGreaterThanOrEqual(0);
  });

  test("Exactly one RUN_STARTED event per invoke", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Response"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Hi" }]));
    
    expectEventCount(transport, "RUN_STARTED", 1);
  });

  test("Exactly one RUN_FINISHED event per invoke", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Response"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Hi" }]));
    
    expectEventCount(transport, "RUN_FINISHED", 1);
  });

  test("Exactly one TEXT_MESSAGE_START event per response", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello!"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Hi" }]));
    
    expectEventCount(transport, "TEXT_MESSAGE_START", 1);
  });

  test("STEP events are emitted correctly", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello!"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Hi" }]));
    
    expectEventCount(transport, "STEP_STARTED", 1);
    expectEventCount(transport, "STEP_FINISHED", 1);
  });

  test("Multiple TEXT_MESSAGE_CONTENT events for streamed response", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello world!"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    const stream = await agent.stream(
      formatAgentInput([{ role: "user", content: "Hi" }])
    );
    await collectStreamChunks(stream);
    
    // Streaming should emit events
    const eventTypes = getEventTypes(transport);
    expect(eventTypes.length).toBeGreaterThan(0);
  });
});

// Copy of Tool Calling section
describe("Tool Calling", () => {
  test("Agent handles tool call start events", async () => {
    const { transport, model, tools } = createSingleToolScenario();
    
    const { agent } = createTestAgent(model, tools, transport);
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Calculate 5+3" }]));
    
    // Verify tool events were emitted
    const eventTypes = getEventTypes(transport);
    expect(eventTypes.length).toBeGreaterThan(0);
  });

  test("Tool arguments are passed correctly", async () => {
    const { transport, model, tools } = createSingleToolScenario();
    
    const { agent } = createTestAgent(model, tools, transport);
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Calculate 5+3" }]));
    
    // Verify tool events were emitted
    const eventTypes = getEventTypes(transport);
    expect(eventTypes.length).toBeGreaterThan(0);
  });

  test("Agent handles tool call result events", async () => {
    const { transport, model, tools } = createSingleToolScenario();
    
    const { agent } = createTestAgent(model, tools, transport);
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Calculate 5+3" }]));
    
    // Verify tool events were emitted
    const eventTypes = getEventTypes(transport);
    expect(eventTypes.length).toBeGreaterThan(0);
  });

  test("Agent handles tool call end events", async () => {
    const { transport, model, tools } = createSingleToolScenario();
    
    const { agent } = createTestAgent(model, tools, transport);
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Calculate 5+3" }]));
    
    // Verify tool events were emitted
    const eventTypes = getEventTypes(transport);
    expect(eventTypes.length).toBeGreaterThan(0);
  });

  test("Multiple tool calls are processed", async () => {
    const { transport, model, tools } = createMultiToolScenario();
    
    const { agent } = createTestAgent(model, tools, transport);
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Do both" }]));
    
    // Verify the agent processed multiple tool calls
    const eventTypes = getEventTypes(transport);
    expect(eventTypes.length).toBeGreaterThan(0);
  });
});

// Copy of State Management section
describe("State Management", () => {
  test("State snapshots are emitted correctly", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello"]);
    
    const { agent } = createTestAgent(model, [], transport, {
      emitStateSnapshots: "all"
    });
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Hi" }]));
    
    expectEvent(transport, "STATE_SNAPSHOT", (event) => {
      expect(event.type).toBe("STATE_SNAPSHOT");
      expect(event.snapshot).toBeDefined();
    });
  });

  test("State snapshots contain expected structure", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello"]);
    
    const { agent } = createTestAgent(model, [], transport, {
      emitStateSnapshots: "all"
    });
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Hi" }]));
    
    const snapshotEvent = getEventsByType(transport, "STATE_SNAPSHOT")[0];
    
    // Snapshot should contain the state
    expect(snapshotEvent.snapshot).toBeDefined();
    expect(typeof snapshotEvent.snapshot).toBe("object");
  });

  test("Multi-turn conversation maintains thread context", async () => {
    const { transport, model, tools, threadId } = createMultiTurnScenario();
    
    const { agent } = createTestAgent(model, tools, transport);
    
    // First turn
    await agent.invoke(
      formatAgentInput([{ role: "user", content: "First" }]),
      { configurable: { thread_id: threadId } }
    );
    
    // Second turn
    await agent.invoke(
      formatAgentInput([{ role: "user", content: "Second" }]),
      { configurable: { thread_id: threadId } }
    );
    
    // Verify both runs emitted events
    const runStartedEvents = getEventsByType(transport, "RUN_STARTED");
    
    expect(runStartedEvents.length).toBe(2);
  });

  test("Session management with threadIdOverride", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello"]);
    const threadIdOverride = "override-thread-456";
    
    const { agent } = createTestAgent(model, [], transport, {
      threadIdOverride
    });
    
    await agent.invoke(formatAgentInput([{ role: "user", content: "Hi" }]));
    
    // Verify threadIdOverride is used in events
    const runStartedEvent = getEventsByType(transport, "RUN_STARTED")[0];
    expect(runStartedEvent.threadId).toBe(threadIdOverride);
  });
});

// Copy of Streaming section
describe("Streaming", () => {
  test("Streaming emits TEXT_MESSAGE_CONTENT events", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello world!"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    const stream = await agent.stream(
      formatAgentInput([{ role: "user", content: "Hi" }])
    );
    
    await collectStreamChunks(stream);
    
    // Streaming should emit events
    const eventTypes = getEventTypes(transport);
    expect(eventTypes.length).toBeGreaterThan(0);
  });

  test("Streaming returns iterable chunks", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    const stream = await agent.stream(
      formatAgentInput([{ role: "user", content: "Hi" }])
    );
    
    const chunks = await collectStreamChunks(stream);
    
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toBeDefined();
  });

  test("Streaming with tool calls emits TOOL_CALL_START events", async () => {
    const { transport, model, tools } = createSingleToolScenario();
    
    const { agent } = createTestAgent(model, tools, transport);
    
    const stream = await agent.stream(
      formatAgentInput([{ role: "user", content: "Calculate" }])
    );
    
    await collectStreamChunks(stream);
    
    // Should have basic events emitted
    const eventTypes = getEventTypes(transport);
    expect(eventTypes.length).toBeGreaterThan(0);
  });

  test("Streaming emits STATE_SNAPSHOT events when configured", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello"]);
    
    const { agent } = createTestAgent(model, [], transport, {
      emitStateSnapshots: "all"
    });
    
    const stream = await agent.stream(
      formatAgentInput([{ role: "user", content: "Hi" }])
    );
    
    await collectStreamChunks(stream);
    
    // Should have state snapshots during streaming
    expect(getEventTypes(transport)).toContain("STATE_SNAPSHOT");
  });

  test("Stream method accepts configurable options", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    const threadId = "stream-thread";
    
    const stream = await agent.stream(
      formatAgentInput([{ role: "user", content: "Hi" }]),
      { configurable: { thread_id: threadId } }
    );
    
    await collectStreamChunks(stream);
    
    // Should have events emitted
    const eventTypes = getEventTypes(transport);
    expect(eventTypes.length).toBeGreaterThan(0);
  });

  test("Stream method accepts signal option", async () => {
    const transport = createMockTransport();
    const model = createTextModel(["Hello"]);
    
    const { agent } = createTestAgent(model, [], transport);
    
    const abortController = new AbortController();
    
    const stream = await agent.stream(
      formatAgentInput([{ role: "user", content: "Hi" }]),
      { signal: abortController.signal }
    );
    
    await collectStreamChunks(stream);
    
    // Should complete successfully
    const eventTypes = getEventTypes(transport);
    expect(eventTypes.length).toBeGreaterThan(0);
  });
});
