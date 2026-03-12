import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { AGUICallbackHandler } from "../../src/callbacks/agui-callback-handler";
import { createAGUIAgent } from "../../src/create-agui-agent";
import {
  createMockCallback,
  createSingleToolScenario,
  createTextModel,
  formatAgentInput,
  getEventTypes,
} from "../helpers/test-utils";

describe("createAGUIAgent option wiring", () => {
  test("callbackOptions are consumed by runtime callback handler", async () => {
    const callback = createMockCallback();
    const model = createTextModel(["Hello"]);

    const agent = createAGUIAgent({
      model,
      tools: [],
      onEvent: callback.emit,
      callbackOptions: {
        emitTextMessages: false,
      },
    });

    const eventStream = await (agent as any).streamEvents(
      formatAgentInput([{ role: "user", content: "Hi" }]),
      {
        version: "v2",
        context: { run_id: "callback-options-run" },
      }
    );
    for await (const _ of eventStream) {
      // consume stream
    }

    const eventTypes = getEventTypes(callback);
    expect(eventTypes).toContain("RUN_STARTED");
    expect(eventTypes).not.toContain("TEXT_MESSAGE_START");
    expect(eventTypes).not.toContain("TEXT_MESSAGE_CONTENT");
    expect(eventTypes).not.toContain("TEXT_MESSAGE_END");
  });

  test("middlewareOptions.emitToolResults=false suppresses TOOL_CALL_RESULT via compatibility mapping", async () => {
    const { callback, model, tools } = createSingleToolScenario();

    const agent = createAGUIAgent({
      model,
      tools,
      onEvent: callback.emit,
      middlewareOptions: { emitToolResults: false },
    });

    await agent.invoke(
      formatAgentInput([{ role: "user", content: "Calculate 5+3" }]),
      {
        context: { run_id: "legacy-tool-result-run" },
      }
    );

    const eventTypes = getEventTypes(callback);
    expect(eventTypes).toContain("TOOL_CALL_END");
    expect(eventTypes).not.toContain("TOOL_CALL_RESULT");
  });

  test("callbackOptions.emitToolResults takes precedence over middlewareOptions.emitToolResults", async () => {
    const { callback, model, tools } = createSingleToolScenario();

    const agent = createAGUIAgent({
      model,
      tools,
      onEvent: callback.emit,
      middlewareOptions: { emitToolResults: false },
      callbackOptions: { emitToolResults: true },
    });

    await agent.invoke(
      formatAgentInput([{ role: "user", content: "Calculate 5+3" }]),
      {
        context: { run_id: "callback-precedence-run" },
      }
    );

    const eventTypes = getEventTypes(callback);
    expect(eventTypes).toContain("TOOL_CALL_END");
    expect(eventTypes).toContain("TOOL_CALL_RESULT");
  });

  test("callbackOptions.reasoningEventMode is consumed by runtime callback handler", async () => {
    const callback = createMockCallback();
    const model = createTextModel([
      new AIMessage({
        content: [
          {
            type: "reasoning",
            reasoning: "Check assumptions first.",
            index: 0,
          },
          { type: "text", text: "Done." },
        ] as any,
      }),
    ]);

    const agent = createAGUIAgent({
      model,
      tools: [],
      onEvent: callback.emit,
      callbackOptions: {
        reasoningEventMode: "reasoning",
      },
    });

    await agent.invoke(formatAgentInput([{ role: "user", content: "Hi" }]), {
      context: { run_id: "reasoning-mode-run" },
    });

    const eventTypes = getEventTypes(callback);
    expect(eventTypes).toContain("REASONING_START");
    expect(eventTypes).toContain("REASONING_MESSAGE_START");
    expect(eventTypes).toContain("REASONING_MESSAGE_END");
    expect(eventTypes).toContain("REASONING_END");
    expect(eventTypes).not.toContain("THINKING_START");
  });

  test("runtime AGUI callback does not duplicate events", async () => {
    const callback = createMockCallback();
    const model = createTextModel(["Hello"]);

    const agent = createAGUIAgent({
      model,
      tools: [],
      onEvent: callback.emit,
    });

    const runtimeHandler = new AGUICallbackHandler({
      onEvent: callback.emit,
    });
    const eventStream = await (agent as any).streamEvents(
      formatAgentInput([{ role: "user", content: "Hi" }]),
      {
        version: "v2",
        context: { run_id: "runtime-handler-run" },
        callbacks: [runtimeHandler],
      }
    );
    for await (const _ of eventStream) {
      // consume stream
    }

    const textStartEvents = callback.events.filter(
      (event: any) => event.type === "TEXT_MESSAGE_START"
    );
    expect(textStartEvents).toHaveLength(1);
  });

  test("per-run callback injection resets turn index across executions", async () => {
    const callback = createMockCallback();
    const model = createTextModel(["Hello"]);

    const agent = createAGUIAgent({
      model,
      tools: [],
      onEvent: callback.emit,
    });

    const runOptions = { context: { run_id: "stable-run-id" }, version: "v2" };

    const stream1 = await (agent as any).streamEvents(
      formatAgentInput([{ role: "user", content: "Hi" }]),
      runOptions
    );
    for await (const _ of stream1) {
      // consume stream
    }
    const firstRunMessageId = callback.events.find(
      (event: any) => event.type === "TEXT_MESSAGE_START"
    )?.messageId;
    expect(typeof firstRunMessageId).toBe("string");

    callback.events.length = 0;

    const stream2 = await (agent as any).streamEvents(
      formatAgentInput([{ role: "user", content: "Hi again" }]),
      runOptions
    );
    for await (const _ of stream2) {
      // consume stream
    }
    const secondRunMessageId = callback.events.find(
      (event: any) => event.type === "TEXT_MESSAGE_START"
    )?.messageId;
    expect(typeof secondRunMessageId).toBe("string");

    // Same run_id should start again at turn 0 with a fresh per-run handler.
    expect(secondRunMessageId).toBe(firstRunMessageId);
  });
});
