/**
 * Test Helper Module for AG-UI Middleware
 *
 * Provides realistic mock models and utilities for integration testing.
 * Uses a custom MockChatModel that extends BaseChatModel.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { tool } from "langchain";
import type { AGUICallbackHandlerOptions } from "../../src/callbacks/agui-callback-handler";
import type { BaseEvent } from "../../src/events";
import type { AGUIMiddlewareOptions } from "../../src/middleware/types";

type MockEvent = BaseEvent & Record<string, unknown>;
type EventType = BaseEvent["type"];
type ToolLike = ReturnType<typeof tool>;
interface AgentRunOptions {
  context?: Record<string, unknown>;
  configurable?: Record<string, unknown>;
  [key: string]: unknown;
}
type AgentMethod = (
  input: unknown,
  options?: AgentRunOptions
) => Promise<unknown>;
type StreamMethod = (
  input: unknown,
  options?: AgentRunOptions
) => Promise<AsyncIterable<unknown>>;
interface GeneratedResponse {
  generations: Array<{
    text: unknown;
    message: AIMessage;
    generationInfo: Record<string, unknown>;
  }>;
  llmOutput: Record<string, unknown>;
}

const ARITHMETIC_EXPRESSION_REGEX =
  /^\s*(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)\s*$/;

// ============================================================================
// Mock Event Callback Factory
// ============================================================================

export interface MockCallback {
  emit: ReturnType<typeof import("bun:test").mock>;
  events: MockEvent[];
}

function evaluateArithmeticExpression(expression: string): string {
  const match = expression.match(ARITHMETIC_EXPRESSION_REGEX);
  if (!match) {
    throw new Error(`Unsupported test expression: ${expression}`);
  }

  const left = Number(match[1]);
  const operator = match[2];
  const right = Number(match[3]);

  switch (operator) {
    case "+":
      return String(left + right);
    case "-":
      return String(left - right);
    case "*":
      return String(left * right);
    case "/":
      return String(left / right);
    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
}

export function createMockCallback(): MockCallback {
  const events: MockEvent[] = [];

  return {
    events,
    emit: (event: BaseEvent) => {
      events.push(event);
    },
  };
}

// ============================================================================
// Mock Chat Model - Extends BaseChatModel
// ============================================================================

/**
 * Mock chat model that extends BaseChatModel for proper createAgent integration
 */
class MockChatModel extends BaseChatModel {
  private readonly responses: AIMessage[];
  private responseIndex = 0;
  private boundTools: unknown[] = [];

  constructor(responses: Array<string | AIMessage>) {
    super({
      temperature: 0,
      callbacks: undefined,
      tags: undefined,
      metadata: undefined,
    });

    this.responses = responses.map((response) => {
      if (response instanceof AIMessage) {
        return response;
      }
      return new AIMessage({
        content: response,
        additional_kwargs: {},
        response_metadata: {},
      });
    });
  }

  bindTools(tools: unknown[]) {
    this.boundTools = tools;
    const bound = new MockChatModel(this.responses);
    bound.responseIndex = this.responseIndex;
    bound.boundTools = tools;
    return Promise.resolve(bound);
  }

  protected _generate(
    _messages: BaseMessage[],
    _options: Record<string, unknown>,
    _runManager?: unknown
  ): Promise<GeneratedResponse> {
    const response = this.responses[this.responseIndex % this.responses.length];
    this.responseIndex++;

    return Promise.resolve({
      generations: [
        {
          text: response.content,
          message: response,
          generationInfo: {},
        },
      ],
      llmOutput: {},
    });
  }

  override async *_streamResponseChunks(
    _messages: BaseMessage[],
    _options: Record<string, unknown>,
    _runManager?: unknown
  ): AsyncGenerator<{
    message: AIMessageChunk;
    generationInfo: Record<string, unknown>;
  }> {
    const response = this.responses[this.responseIndex % this.responses.length];
    this.responseIndex++;

    await Promise.resolve();

    const content = response.content || "";
    const chunks =
      typeof content === "string" ? [...content].filter(Boolean) : [];

    for (const chunk of chunks) {
      yield {
        message: new AIMessageChunk({
          content: chunk,
          additional_kwargs: {},
          response_metadata: {},
        }),
        generationInfo: {},
      };
    }
  }

  get index() {
    return this.responseIndex;
  }

  get _boundTools() {
    return this.boundTools;
  }

  // Required by BaseChatModel
  _llmType(): string {
    return "mock_chat_model";
  }

  _call(
    _messages: BaseMessage[],
    _options: Record<string, unknown>,
    _runManager?: unknown
  ): Promise<string> {
    const response = this.responses[this.responseIndex % this.responses.length];
    this.responseIndex++;
    return Promise.resolve(response.content);
  }
}

// ============================================================================
// Model Factory Functions
// ============================================================================

/**
 * Creates a mock model for simple text responses (no tools)
 */
export function createTextModel(
  textResponses: Array<string | AIMessage>
): MockChatModel {
  return new MockChatModel(textResponses);
}

/**
 * Creates a mock model with tool call simulation
 */
export function createToolCallingModel(
  responses: Array<
    Array<{
      name: string;
      args: Record<string, unknown>;
      id: string;
    }>
  >,
  _toolStyle: "openai" | "anthropic" = "openai"
): MockChatModel {
  // Convert tool call sequences to response messages
  const textResponses = responses.map((toolCalls) => {
    if (toolCalls.length === 0) {
      return "I've completed the task."; // Final response
    }
    // For tool calls, create an AIMessage with tool_calls
    const aiMessage = new AIMessage({
      content: `I'll use the ${toolCalls.map((t) => t.name).join(", ")} tool(s).`,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
        type: "tool_call" as const,
      })),
      additional_kwargs: {},
      response_metadata: {},
    });
    return aiMessage;
  });

  return new MockChatModel(textResponses);
}

/**
 * Creates a tool for testing
 */
export function createTestTool<T extends Record<string, unknown>>(
  name: string,
  func: (args: T) => Promise<string>,
  schema: Record<string, unknown>
) {
  return tool(func as unknown as Parameters<typeof tool>[0], {
    name,
    description: `Test tool: ${name}`,
    schema,
  });
}

// ============================================================================
// Input Formatting Helpers
// ============================================================================

/**
 * Formats input for createAgent - converts plain objects to HumanMessage
 */
export function formatAgentInput(
  messages: Array<{ role: string; content: string }>
) {
  return {
    messages: messages.map((msg) => {
      if (msg.role === "user") {
        return new HumanMessage(msg.content);
      }
      return new HumanMessage(msg.content);
    }),
  };
}

// ============================================================================
// Pre-configured Test Scenarios
// ============================================================================

/**
 * Scenario 1: Simple text response (no tools)
 */
export function createSimpleTextScenario() {
  const callback = createMockCallback();
  const model = createTextModel(["Hello! How can I help you today?"]);

  return {
    callback,
    model,
    tools: [],
    expectedText: "Hello! How can I help you today?",
  };
}

/**
 * Scenario 2: Single tool call followed by response
 */
export function createSingleToolScenario() {
  const callback = createMockCallback();

  // First response: tool call, second: final text
  const model = createToolCallingModel([
    [{ name: "calculator", args: { a: 5, b: 3 }, id: "call_1" }],
    [], // Final response with no tool calls
  ]);

  const calculatorTool = createTestTool(
    "calculator",
    async ({ a, b }) => (a + b).toString(),
    { a: { type: "number" }, b: { type: "number" } }
  );

  return {
    callback,
    model,
    tools: [calculatorTool],
    expectedToolName: "calculator",
    expectedToolArgs: { a: 5, b: 3 },
    expectedResult: "8",
  };
}

/**
 * Scenario 3: Multiple sequential tool calls
 */
export function createMultiToolScenario() {
  const callback = createMockCallback();

  const model = createToolCallingModel([
    [{ name: "search", args: { query: "weather" }, id: "call_search_1" }],
    [{ name: "calculator", args: { expression: "2+2" }, id: "call_calc_1" }],
    [], // Final response
  ]);

  const searchTool = createTestTool(
    "search",
    async ({ query }) => `Results for: ${query}`,
    { query: { type: "string" } }
  );

  const calculatorTool = createTestTool(
    "calculator",
    async ({ expression }) => evaluateArithmeticExpression(expression),
    { expression: { type: "string" } }
  );

  return {
    callback,
    model,
    tools: [searchTool, calculatorTool],
    expectedTools: [
      { name: "search", args: { query: "weather" } },
      { name: "calculator", args: { expression: "2+2" } },
    ],
  };
}

/**
 * Scenario 3: Error handling - Tool that throws an error
 */
export function createErrorScenario(errorMessage: string) {
  const callback = createMockCallback();

  // Create a model that will call the failing tool
  const model = createToolCallingModel([
    [{ name: "failing_tool", args: {}, id: "call_1" }], // Tool call
    [], // Final response (won't be reached if tool errors)
  ]);

  const failingTool = createTestTool(
    "failing_tool",
    () => Promise.reject(new Error(errorMessage)),
    {}
  );

  return {
    callback,
    model,
    tools: [failingTool],
    expectedError: errorMessage,
  };
}

/**
 * Scenario 5: Multi-turn conversation
 */
export function createMultiTurnScenario() {
  const callback = createMockCallback();

  const model = createToolCallingModel([
    [{ name: "search", args: { query: "first" }, id: "call_1" }],
    [{ name: "search", args: { query: "second" }, id: "call_2" }],
    [], // Third response
  ]);

  const searchTool = createTestTool(
    "search",
    async ({ query }) => `Result: ${query}`,
    { query: { type: "string" } }
  );

  return {
    callback,
    model,
    tools: [searchTool],
    turns: 3,
    threadId: "test-thread-123",
  };
}

// ============================================================================
// Test Agent Factory
// ============================================================================

export interface TestAgent {
  agent: {
    invoke: AgentMethod;
    stream: StreamMethod;
    streamEvents: StreamMethod;
  };
  callback: MockCallback;
  model: MockChatModel;
  tools: ToolLike[];
}

/**
 * Creates a test agent with pre-configured model and callback
 */
export function createTestAgent(
  model: MockChatModel,
  tools: ToolLike[],
  callback: MockCallback,
  middlewareOptions?: Partial<AGUIMiddlewareOptions>,
  callbackOptions?: Partial<Omit<AGUICallbackHandlerOptions, "onEvent">>
): TestAgent {
  let createAGUIAgentModule: typeof import("../../src/create-agui-agent");

  async function getCreateAGUIAgent() {
    if (!createAGUIAgentModule) {
      createAGUIAgentModule = await import("../../src/create-agui-agent");
    }
    return createAGUIAgentModule;
  }

  const agent = {
    invoke: async (input: unknown, options?: AgentRunOptions) => {
      const { createAGUIAgent } = await getCreateAGUIAgent();
      const aguiAgent = createAGUIAgent({
        model,
        tools,
        onEvent: callback.emit,
        middlewareOptions,
        callbackOptions,
      });
      // Ensure a run_id is present for Middleware to satisfy ID coordination
      const config = {
        ...options,
        context: {
          run_id:
            options?.configurable?.run_id ||
            options?.context?.run_id ||
            `test-run-${Date.now()}`,
          ...options?.context,
        },
        configurable: {
          run_id:
            options?.configurable?.run_id ||
            options?.context?.run_id ||
            `test-run-${Date.now()}`,
          ...options?.configurable,
        },
      };
      return aguiAgent.invoke(input, config);
    },
    stream: async (input: unknown, options?: AgentRunOptions) => {
      const { createAGUIAgent } = await getCreateAGUIAgent();
      const aguiAgent = createAGUIAgent({
        model,
        tools,
        onEvent: callback.emit,
        middlewareOptions,
        callbackOptions,
      });
      // Ensure a run_id is present for Middleware to satisfy ID coordination
      const config = {
        ...options,
        context: {
          run_id:
            options?.configurable?.run_id ||
            options?.context?.run_id ||
            `test-run-${Date.now()}`,
          ...options?.context,
        },
        configurable: {
          run_id:
            options?.configurable?.run_id ||
            options?.context?.run_id ||
            `test-run-${Date.now()}`,
          ...options?.configurable,
        },
      };
      return aguiAgent.stream(input, config);
    },
    streamEvents: async (input: unknown, options?: AgentRunOptions) => {
      const { createAGUIAgent } = await getCreateAGUIAgent();
      const aguiAgent = createAGUIAgent({
        model,
        tools,
        onEvent: callback.emit,
        middlewareOptions,
        callbackOptions,
      });
      // Ensure a run_id is present for Middleware to satisfy ID coordination
      const config = {
        ...options,
        context: {
          run_id:
            options?.configurable?.run_id ||
            options?.context?.run_id ||
            `test-run-${Date.now()}`,
          ...options?.context,
        },
        configurable: {
          run_id:
            options?.configurable?.run_id ||
            options?.context?.run_id ||
            `test-run-${Date.now()}`,
          ...options?.configurable,
        },
      };
      const stream = await (
        aguiAgent as { streamEvents: StreamMethod }
      ).streamEvents(input, config);
      return stream;
    },
  };

  return { agent, callback, model, tools };
}

// ============================================================================
// Event Verification Helpers
// ============================================================================

/**
 * Extract event types from callback emissions
 */
export function getEventTypes(callback: MockCallback): EventType[] {
  return callback.events.map((event) => event.type);
}

/**
 * Get events of a specific type
 */
export function getEventsByType(
  callback: MockCallback,
  type: EventType | string
): MockEvent[] {
  return callback.events.filter((event) => event.type === type);
}

/**
 * Verify event count is exact
 */
export function expectEventCount(
  callback: MockCallback,
  type: EventType | string,
  expectedCount: number
): void {
  const actualCount = getEventsByType(callback, type).length;
  if (actualCount !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} "${type}" event(s), received ${actualCount}.`
    );
  }
}

/**
 * Verify event exists
 */
export function expectEvent(
  callback: MockCallback,
  type: EventType | string,
  validator?: (event: MockEvent) => void
): MockEvent {
  const events = getEventsByType(callback, type);
  if (events.length === 0) {
    throw new Error(`Expected at least one "${type}" event, but found none.`);
  }
  if (validator) {
    events.forEach(validator);
  }
  return events[0];
}

/**
 * Verify events are in correct order
 */
export function expectEventOrder(
  callback: MockCallback,
  expectedOrder: (EventType | string)[]
): void {
  const actualOrder = getEventTypes(callback);

  let currentIndex = 0;
  for (const expectedType of expectedOrder) {
    const foundIndex = actualOrder.indexOf(expectedType, currentIndex);
    if (foundIndex < currentIndex) {
      throw new Error(
        `Expected event "${expectedType}" after index ${currentIndex - 1}, but actual order was ${actualOrder.join(", ")}.`
      );
    }
    currentIndex = foundIndex + 1;
  }
}

/**
 * Get the index of a specific event type
 */
export function getEventIndex(
  callback: MockCallback,
  type: EventType | string
): number {
  return getEventTypes(callback).indexOf(type);
}

// ============================================================================
// Async Test Helpers
// ============================================================================

/**
 * Wait for all pending async operations
 */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 10));
}

/**
 * Consume a stream and collect all chunks
 */
export async function collectStreamChunks(
  stream: AsyncIterable<unknown>
): Promise<unknown[]> {
  const chunks: unknown[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}
