import { describe, expect, test } from "bun:test";
import type { AgentAction, AgentFinish } from "@langchain/core/agents";
import type { NewTokenIndices } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { LLMResult } from "@langchain/core/outputs";

import { createOpenResponsesCallbackBridge } from "@/callbacks/openresponses-callback-bridge.js";
import type { InternalSemanticEvent } from "@/core/events.js";
import { createSequentialIdGenerator } from "@/testing/deterministic-id.js";

const callHandler = async <Args extends unknown[]>(
  handler: ((...args: Args) => Promise<void> | void) | undefined,
  ...args: Args
): Promise<void> => {
  if (!handler) {
    throw new Error("Expected callback handler to be defined");
  }

  await handler(...args);
};

type AgentActionWithBridgeFields = AgentAction & {
  toolCallId?: string;
  argumentsDelta?: string;
};

const serializedFixture: Serialized = {
  lc: 1,
  type: "constructor",
  id: ["test"],
  kwargs: {},
};

const tokenIndicesFixture: NewTokenIndices = {
  prompt: 0,
  completion: 0,
};

const llmResultFixture: LLMResult = {
  generations: [[]],
};

const agentFinishFixture: AgentFinish = {
  returnValues: {},
  log: "done",
};

const createEmitter = () => {
  const events: InternalSemanticEvent[] = [];

  return {
    events,
    emitter: {
      emit(event: InternalSemanticEvent) {
        events.push(event);
      },
    },
  };
};

describe("OpenResponsesCallbackBridge", () => {
  test("bridges text callbacks into semantic events without transport writes", async () => {
    const { events, emitter } = createEmitter();
    const bridge = createOpenResponsesCallbackBridge({
      emitter,
      generateId: createSequentialIdGenerator(["msg-1"]),
    });

    await callHandler(
      bridge.handleChatModelStart,
      serializedFixture,
      [],
      "run-1"
    );
    await callHandler(
      bridge.handleLLMNewToken,
      "Hello",
      tokenIndicesFixture,
      "run-1"
    );
    await callHandler(
      bridge.handleLLMNewToken,
      " world",
      tokenIndicesFixture,
      "run-1"
    );
    await callHandler(bridge.handleLLMEnd, llmResultFixture, "run-1");
    await callHandler(bridge.handleAgentEnd, agentFinishFixture, "run-1");

    expect(events).toEqual([
      { type: "run.started", runId: "run-1" },
      { type: "message.started", itemId: "msg-1", runId: "run-1" },
      { type: "text.delta", itemId: "msg-1", delta: "Hello" },
      { type: "text.delta", itemId: "msg-1", delta: " world" },
      { type: "text.completed", itemId: "msg-1" },
      { type: "run.completed", runId: "run-1" },
    ]);
  });

  test("bridges tool callbacks with strong argument granularity", async () => {
    const { events, emitter } = createEmitter();
    const bridge = createOpenResponsesCallbackBridge({
      emitter,
      generateId: createSequentialIdGenerator(["fc-1"]),
    });

    const actionWithDelta: AgentActionWithBridgeFields = {
      tool: "get_weather",
      toolInput: { city: "Boston" },
      log: "tool selected",
      toolCallId: "call-1",
      argumentsDelta: '{"city":"Bos',
    };

    await callHandler(bridge.handleAgentAction, actionWithDelta, "agent-run-1");
    await callHandler(
      bridge.handleToolStart,
      serializedFixture,
      '{"city":"Boston"}',
      "tool-run-1",
      "agent-run-1",
      undefined,
      undefined,
      "get_weather"
    );
    await callHandler(
      bridge.handleToolEnd,
      { temperature: "55F" },
      "tool-run-1",
      "agent-run-1"
    );
    await callHandler(bridge.handleAgentEnd, agentFinishFixture, "agent-run-1");

    expect(events).toEqual([
      { type: "run.started", runId: "agent-run-1" },
      {
        type: "function_call.started",
        itemId: "fc-1",
        name: "get_weather",
        callId: "call-1",
      },
      {
        type: "function_call_arguments.delta",
        itemId: "fc-1",
        delta: '{"city":"Bos',
      },
      {
        type: "tool.started",
        runId: "tool-run-1",
        toolName: "get_weather",
        input: '{"city":"Boston"}',
      },
      {
        type: "tool.completed",
        runId: "tool-run-1",
        output: { temperature: "55F" },
      },
      { type: "function_call.completed", itemId: "fc-1" },
      { type: "run.completed", runId: "agent-run-1" },
    ]);
  });

  test("degrades to done-only function call behavior when only full arguments are observed", async () => {
    const { events, emitter } = createEmitter();
    const bridge = createOpenResponsesCallbackBridge({
      emitter,
      generateId: createSequentialIdGenerator(["fc-2"]),
    });

    const actionWithoutDeltas: AgentActionWithBridgeFields = {
      tool: "lookup_user",
      toolInput: { id: "user-123" },
      log: "tool selected",
      toolCallId: "call-2",
    };

    await callHandler(
      bridge.handleAgentAction,
      actionWithoutDeltas,
      "agent-run-2"
    );
    await callHandler(bridge.handleToolEnd, "ok", "tool-run-2", "agent-run-2");

    expect(events).toEqual([
      { type: "run.started", runId: "agent-run-2" },
      {
        type: "function_call.started",
        itemId: "fc-2",
        name: "lookup_user",
        callId: "call-2",
        arguments: '{"id":"user-123"}',
      },
      { type: "tool.completed", runId: "tool-run-2", output: "ok" },
      { type: "function_call.completed", itemId: "fc-2" },
    ]);

    expect(
      events.some((event) => event.type === "function_call_arguments.delta")
    ).toBe(false);
  });

  test("tracks multiple in-flight tool calls for a single agent run", async () => {
    const { events, emitter } = createEmitter();
    const bridge = createOpenResponsesCallbackBridge({
      emitter,
      generateId: createSequentialIdGenerator(["fc-1", "fc-2"]),
    });

    const firstAction: AgentActionWithBridgeFields = {
      tool: "get_weather",
      toolInput: { city: "Boston" },
      log: "first tool selected",
      toolCallId: "call-1",
    };
    const secondAction: AgentActionWithBridgeFields = {
      tool: "get_time",
      toolInput: { timezone: "UTC" },
      log: "second tool selected",
      toolCallId: "call-2",
    };

    await callHandler(bridge.handleAgentAction, firstAction, "agent-run-4");
    await callHandler(bridge.handleAgentAction, secondAction, "agent-run-4");
    await callHandler(
      bridge.handleToolStart,
      serializedFixture,
      '{"timezone":"UTC"}',
      "tool-run-2",
      "agent-run-4",
      undefined,
      undefined,
      "get_time",
      "call-2"
    );
    await callHandler(
      bridge.handleToolEnd,
      { now: "10:00" },
      "tool-run-2",
      "agent-run-4"
    );
    await callHandler(
      bridge.handleToolStart,
      serializedFixture,
      '{"city":"Boston"}',
      "tool-run-1",
      "agent-run-4",
      undefined,
      undefined,
      "get_weather",
      "call-1"
    );
    await callHandler(
      bridge.handleToolEnd,
      { temperature: "55F" },
      "tool-run-1",
      "agent-run-4"
    );

    expect(events).toEqual([
      { type: "run.started", runId: "agent-run-4" },
      {
        type: "function_call.started",
        itemId: "fc-1",
        name: "get_weather",
        callId: "call-1",
        arguments: '{"city":"Boston"}',
      },
      {
        type: "function_call.started",
        itemId: "fc-2",
        name: "get_time",
        callId: "call-2",
        arguments: '{"timezone":"UTC"}',
      },
      {
        type: "tool.started",
        runId: "tool-run-2",
        toolName: "get_time",
        input: '{"timezone":"UTC"}',
      },
      {
        type: "tool.completed",
        runId: "tool-run-2",
        output: { now: "10:00" },
      },
      { type: "function_call.completed", itemId: "fc-2" },
      {
        type: "tool.started",
        runId: "tool-run-1",
        toolName: "get_weather",
        input: '{"city":"Boston"}',
      },
      {
        type: "tool.completed",
        runId: "tool-run-1",
        output: { temperature: "55F" },
      },
      { type: "function_call.completed", itemId: "fc-1" },
    ]);
  });

  test("uses handleToolStart toolCallId when agent actions do not provide one", async () => {
    const { events, emitter } = createEmitter();
    const bridge = createOpenResponsesCallbackBridge({
      emitter,
      generateId: createSequentialIdGenerator(["fc-3"]),
    });

    const actionWithoutCallId: AgentAction = {
      tool: "lookup_user",
      toolInput: { id: "user-456" },
      log: "tool selected",
    };

    await callHandler(
      bridge.handleAgentAction,
      actionWithoutCallId,
      "agent-run-5"
    );
    await callHandler(
      bridge.handleToolStart,
      serializedFixture,
      '{"id":"user-456"}',
      "tool-run-5",
      "agent-run-5",
      undefined,
      undefined,
      "lookup_user",
      "real-call-5"
    );
    await callHandler(bridge.handleToolEnd, "ok", "tool-run-5", "agent-run-5");

    expect(events).toEqual([
      { type: "run.started", runId: "agent-run-5" },
      {
        type: "function_call.started",
        itemId: "fc-3",
        name: "lookup_user",
        callId: "real-call-5",
        arguments: '{"id":"user-456"}',
      },
      {
        type: "tool.started",
        runId: "tool-run-5",
        toolName: "lookup_user",
        input: '{"id":"user-456"}',
      },
      { type: "tool.completed", runId: "tool-run-5", output: "ok" },
      { type: "function_call.completed", itemId: "fc-3" },
    ]);
  });

  test("maps runtime failures into a single run.failed event", async () => {
    const { events, emitter } = createEmitter();
    const bridge = createOpenResponsesCallbackBridge({
      emitter,
      generateId: createSequentialIdGenerator(["msg-1"]),
    });

    await callHandler(
      bridge.handleChatModelStart,
      serializedFixture,
      [],
      "run-3"
    );
    await callHandler(
      bridge.handleLLMError,
      new Error("post-start failure"),
      "run-3"
    );
    await callHandler(
      bridge.handleChainError,
      new Error("should be ignored"),
      "run-3"
    );

    expect(events).toHaveLength(3);
    expect(events[2]?.type).toBe("run.failed");
    expect(events[2]).toMatchObject({
      type: "run.failed",
      runId: "run-3",
    });
  });
});
