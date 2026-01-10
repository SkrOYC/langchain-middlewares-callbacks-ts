/**
 * Test Helper Module for AG-UI Middleware
 * 
 * Provides realistic mock models and utilities for integration testing.
 * Uses a custom MockChatModel that extends BaseChatModel.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { tool } from "langchain";
import { AIMessage, HumanMessage, AIMessageChunk } from "@langchain/core/messages";
import { expect } from "bun:test";
import type { AGUITransport } from "../../src/transports/types";
import type { EventType } from "../../src/events";

// ============================================================================
// Mock Transport Factory
// ============================================================================

export interface MockTransport extends AGUITransport {
  emit: ReturnType<typeof import("bun:test").mock>;
  events: any[];
}

export function createMockTransport(): MockTransport {
  const events: any[] = [];
  
  return {
    events,
    emit: function(event: any) {
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
  private responses: AIMessage[];
  private responseIndex = 0;
  private boundTools: any[] = [];
  
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
        response_metadata: {}
      });
    });
  }
  
  async bindTools(tools: any[]) {
    this.boundTools = tools;
    const bound = new MockChatModel(this.responses);
    bound.responseIndex = this.responseIndex;
    bound.boundTools = tools;
    return bound;
  }
  
  protected async _generate(
    _messages: any[],
    _options: any,
    _runManager?: any
  ): Promise<any> {
    const lastMessage = _messages[_messages.length - 1];
    const response = this.responses[this.responseIndex % this.responses.length];
    this.responseIndex++;
    
    return {
      generations: [
        {
          text: response.content,
          message: response,
          generationInfo: {},
        },
      ],
      llmOutput: {},
    };
  }
  
  override async *_streamResponseChunks(
    _messages: any[],
    _options: any,
    _runManager?: any
  ): AsyncGenerator<any> {
    const response = this.responses[this.responseIndex % this.responses.length];
    this.responseIndex++;
    
    const content = response.content || "";
    const chunks = typeof content === "string" ? content.split(/(?=.)/).filter(c => c) : [];
    
    for (const chunk of chunks) {
      yield {
        message: new AIMessageChunk({
          content: chunk,
          additional_kwargs: {},
          response_metadata: {}
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
  
  async _call(
    _messages: any[],
    _options: any,
    _runManager?: any
  ): Promise<string> {
    const lastMessage = _messages[_messages.length - 1];
    const response = this.responses[this.responseIndex % this.responses.length];
    this.responseIndex++;
    return response.content;
  }
}

// ============================================================================
// Model Factory Functions
// ============================================================================

/**
 * Creates a mock model for simple text responses (no tools)
 */
export function createTextModel(textResponses: string[]): MockChatModel {
  return new MockChatModel(textResponses);
}

/**
 * Creates a mock model with tool call simulation
 */
export function createToolCallingModel(
  responses: Array<Array<{
    name: string;
    args: Record<string, unknown>;
    id: string;
  }>>,
  _toolStyle: "openai" | "anthropic" = "openai"
): MockChatModel {
  // Convert tool call sequences to response messages
  const textResponses = responses.map((toolCalls) => {
    if (toolCalls.length === 0) {
      return "I've completed the task."; // Final response
    }
    // For tool calls, create an AIMessage with tool_calls
    const aiMessage = new AIMessage({
      content: `I'll use the ${toolCalls.map(t => t.name).join(", ")} tool(s).`,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
        type: "tool_call" as const
      })),
      additional_kwargs: {},
      response_metadata: {}
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
  return tool(func as any, {
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
export function formatAgentInput(messages: Array<{ role: string; content: string }>) {
  return {
    messages: messages.map(msg => {
      if (msg.role === "user") {
        return new HumanMessage(msg.content);
      }
      return new HumanMessage(msg.content);
    })
  };
}

// ============================================================================
// Pre-configured Test Scenarios
// ============================================================================

/**
 * Scenario 1: Simple text response (no tools)
 */
export function createSimpleTextScenario() {
  const transport = createMockTransport();
  const model = createTextModel(["Hello! How can I help you today?"]);
  
  return {
    transport,
    model,
    tools: [],
    expectedText: "Hello! How can I help you today?",
  };
}

/**
 * Scenario 2: Single tool call followed by response
 */
export function createSingleToolScenario() {
  const transport = createMockTransport();
  
  // First response: tool call, second: final text
  const model = createToolCallingModel([
    [{ name: "calculator", args: { a: 5, b: 3 }, id: "call_1" }],
    [] // Final response with no tool calls
  ]);
  
  const calculatorTool = createTestTool(
    "calculator",
    async ({ a, b }) => (a + b).toString(),
    { a: { type: "number" }, b: { type: "number" } }
  );
  
  return {
    transport,
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
  const transport = createMockTransport();
  
  const model = createToolCallingModel([
    [{ name: "search", args: { query: "weather" }, id: "call_search_1" }],
    [{ name: "calculator", args: { expression: "2+2" }, id: "call_calc_1" }],
    [] // Final response
  ]);
  
  const searchTool = createTestTool(
    "search",
    async ({ query }) => `Results for: ${query}`,
    { query: { type: "string" } }
  );
  
  const calculatorTool = createTestTool(
    "calculator",
    async ({ expression }) => eval(expression).toString(),
    { expression: { type: "string" } }
  );
  
  return {
    transport,
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
  const transport = createMockTransport();
  
  // Create a model that will call the failing tool
  const model = createToolCallingModel([
    [{ name: "failing_tool", args: {}, id: "call_1" }], // Tool call
    [], // Final response (won't be reached if tool errors)
  ]);
  
  const failingTool = createTestTool(
    "failing_tool",
    async () => { throw new Error(errorMessage); },
    {}
  );
  
  return {
    transport,
    model,
    tools: [failingTool],
    expectedError: errorMessage,
  };
}

/**
 * Scenario 5: Multi-turn conversation
 */
export function createMultiTurnScenario() {
  const transport = createMockTransport();
  
  const model = createToolCallingModel([
    [{ name: "search", args: { query: "first" }, id: "call_1" }],
    [{ name: "search", args: { query: "second" }, id: "call_2" }],
    [] // Third response
  ]);
  
  const searchTool = createTestTool(
    "search",
    async ({ query }) => `Result: ${query}`,
    { query: { type: "string" } }
  );
  
  return {
    transport,
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
  agent: { invoke: Function; stream: Function; streamEvents: Function };
  transport: MockTransport;
  model: MockChatModel;
  tools: ReturnType<typeof tool>[];
}

/**
 * Creates a test agent with pre-configured model and transport
 */
export function createTestAgent(
  model: MockChatModel,
  tools: ReturnType<typeof tool>[],
  transport: MockTransport,
  middlewareOptions?: Record<string, any>
): TestAgent {
  let createAGUIAgentModule: typeof import("../../src/createAGUIAgent");
  let AGUICallbackHandler: typeof import("../../src/callbacks/AGUICallbackHandler").AGUICallbackHandler;

  async function getCreateAGUIAgent() {
    if (!createAGUIAgentModule) {
      createAGUIAgentModule = await import("../../src/createAGUIAgent");
    }
    return createAGUIAgentModule;
  }

  async function getAGUICallbackHandler() {
    if (!AGUICallbackHandler) {
      const module = await import("../../src/callbacks/AGUICallbackHandler");
      AGUICallbackHandler = module.AGUICallbackHandler;
    }
    return AGUICallbackHandler;
  }

  const agent = {
    invoke: async (input: any, options?: any) => {
      const { createAGUIAgent } = await getCreateAGUIAgent();
      const aguiAgent = createAGUIAgent({
        model,
        tools,
        transport,
        middlewareOptions,
      });
      // Ensure a run_id is present for Middleware to satisfy ID coordination
      const config = {
        ...options,
        context: {
          run_id: options?.configurable?.run_id || options?.context?.run_id || `test-run-${Date.now()}`,
          ...options?.context,
        },
        configurable: {
          run_id: options?.configurable?.run_id || options?.context?.run_id || `test-run-${Date.now()}`,
          ...options?.configurable,
        }
      };
      return aguiAgent.invoke(input, config);
    },
    stream: async (input: any, options?: any) => {
      const { createAGUIAgent } = await getCreateAGUIAgent();
      const aguiAgent = createAGUIAgent({
        model,
        tools,
        transport,
        middlewareOptions,
      });
      // Ensure a run_id is present for Middleware to satisfy ID coordination
      const config = {
        ...options,
        context: {
          run_id: options?.configurable?.run_id || options?.context?.run_id || `test-run-${Date.now()}`,
          ...options?.context,
        },
        configurable: {
          run_id: options?.configurable?.run_id || options?.context?.run_id || `test-run-${Date.now()}`,
          ...options?.configurable,
        }
      };
      return aguiAgent.stream(input, config);
    },
    streamEvents: async (input: any, options?: any) => {
      const { createAGUIAgent } = await getCreateAGUIAgent();
      const CallbackHandler = await getAGUICallbackHandler();
      const aguiAgent = createAGUIAgent({
        model,
        tools,
        transport,
        middlewareOptions,
      });
      // Ensure a run_id is present for Middleware to satisfy ID coordination
      const config = {
        ...options,
        context: {
          run_id: options?.configurable?.run_id || options?.context?.run_id || `test-run-${Date.now()}`,
          ...options?.context,
        },
        configurable: {
          run_id: options?.configurable?.run_id || options?.context?.run_id || `test-run-${Date.now()}`,
          ...options?.configurable,
        }
      };
      // Create callback handler for streaming events
      const handler = new CallbackHandler(transport);
      // Add callbacks to options if not present
      const streamOptions = {
        ...config,
        callbacks: [...(options?.callbacks || []), handler],
      };
      const stream = await (aguiAgent as any).streamEvents(input, streamOptions);
      return stream;
    },
  };

  return { agent, transport, model, tools };
}

// ============================================================================
// Event Verification Helpers
// ============================================================================

/**
 * Extract event types from transport emissions
 */
export function getEventTypes(transport: MockTransport): EventType[] {
  return transport.events.map((event: any) => event.type);
}

/**
 * Get events of a specific type
 */
export function getEventsByType(transport: MockTransport, type: EventType | string): any[] {
  return transport.events.filter((event: any) => event.type === type);
}

/**
 * Verify event count is exact
 */
export function expectEventCount(
  transport: MockTransport,
  type: EventType | string,
  expectedCount: number
): void {
  const actualCount = getEventsByType(transport, type).length;
  expect(actualCount).toBe(expectedCount);
}

/**
 * Verify event exists
 */
export function expectEvent(
  transport: MockTransport,
  type: EventType | string,
  validator?: (event: any) => void
): any {
  const events = getEventsByType(transport, type);
  expect(events.length).toBeGreaterThan(0);
  if (validator) {
    events.forEach(validator);
  }
  return events[0];
}

/**
 * Verify events are in correct order
 */
export function expectEventOrder(
  transport: MockTransport,
  expectedOrder: (EventType | string)[]
): void {
  const actualOrder = getEventTypes(transport);
  
  let currentIndex = 0;
  for (const expectedType of expectedOrder) {
    const foundIndex = actualOrder.indexOf(expectedType, currentIndex);
    expect(foundIndex).toBeGreaterThanOrEqual(currentIndex);
    currentIndex = foundIndex + 1;
  }
}

/**
 * Get the index of a specific event type
 */
export function getEventIndex(transport: MockTransport, type: EventType | string): number {
  return getEventTypes(transport).indexOf(type);
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
  stream: AsyncIterable<any>
): Promise<any[]> {
  const chunks: any[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}
