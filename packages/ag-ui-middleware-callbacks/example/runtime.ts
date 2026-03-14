import {
  type BaseEvent,
  type RunAgentInput,
  RunAgentInputSchema,
} from "@ag-ui/core";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  type BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "langchain";
import { z } from "zod";
import {
  CALCULATOR_TOOL_PARAMETERS,
  type ExampleAgentConfig,
  type ExampleProvider,
  DEFAULT_AGENT_CONFIG,
} from "./config";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

const ARITHMETIC_EXPRESSION_REGEX =
  /(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)/;

interface GeneratedResponse {
  generations: Array<{
    text: unknown;
    message: AIMessage;
    generationInfo: Record<string, unknown>;
  }>;
  llmOutput: Record<string, unknown>;
}

interface ArithmeticOperation {
  a: number;
  b: number;
  operation: "add" | "subtract" | "multiply" | "divide";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunAgentInput(value: unknown): value is RunAgentInput {
  const result = RunAgentInputSchema.safeParse(value);
  return result.success;
}

function mapOperatorToOperation(operator: string): ArithmeticOperation["operation"] {
  switch (operator) {
    case "+":
      return "add";
    case "-":
      return "subtract";
    case "*":
      return "multiply";
    case "/":
      return "divide";
    default:
      return "add";
  }
}

function parseArithmeticOperation(input: string): ArithmeticOperation | null {
  const match = input.match(ARITHMETIC_EXPRESSION_REGEX);
  if (!match) {
    return null;
  }

  return {
    a: Number(match[1]),
    b: Number(match[3]),
    operation: mapOperatorToOperation(match[2]),
  };
}

function getLastUserMessage(messages: BaseMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof HumanMessage && typeof message.content === "string") {
      return message.content;
    }
  }

  return "";
}

class ExampleMockModel extends BaseChatModel {
  private boundTools: unknown[] = [];

  constructor() {
    super({
      temperature: 0,
      callbacks: undefined,
      tags: undefined,
      metadata: undefined,
    });
  }

  override bindTools(tools: unknown[]): ExampleMockModel {
    const bound = new ExampleMockModel();
    bound.boundTools = tools;
    return bound;
  }

  protected _generate(
    messages: BaseMessage[]
  ): Promise<GeneratedResponse> {
    const response = this.createResponse(messages);
    return Promise.resolve({
      generations: [
        {
          text: typeof response.content === "string" ? response.content : "",
          message: response,
          generationInfo: {},
        },
      ],
      llmOutput: {},
    });
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[]
  ): AsyncGenerator<{
    message: AIMessageChunk;
    generationInfo: Record<string, unknown>;
  }> {
    const response = this.createResponse(messages);
    await Promise.resolve();

    if (Array.isArray(response.tool_calls) && response.tool_calls.length > 0) {
      yield {
        message: new AIMessageChunk({
          content: "",
          tool_call_chunks: response.tool_calls.map((toolCall, index) => ({
            id: toolCall.id,
            name: toolCall.name,
            args: JSON.stringify(toolCall.args),
            index,
            type: "tool_call",
          })),
          additional_kwargs: {},
          response_metadata: {},
        } as ConstructorParameters<typeof AIMessageChunk>[0]),
        generationInfo: {},
      };
      return;
    }

    const content = typeof response.content === "string" ? response.content : "";
    for (const chunk of content) {
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

  _llmType(): string {
    return "example_mock_model";
  }

  _call(messages: BaseMessage[]): Promise<string> {
    const response = this.createResponse(messages);
    return Promise.resolve(
      typeof response.content === "string" ? response.content : ""
    );
  }

  private createResponse(messages: BaseMessage[]): AIMessage {
    const lastMessage = messages.at(-1);
    if (lastMessage instanceof ToolMessage) {
      return new AIMessage({
        content: `The calculator returned ${lastMessage.content}.`,
        additional_kwargs: {},
        response_metadata: {},
      });
    }

    const prompt = getLastUserMessage(messages);
    const arithmeticOperation = parseArithmeticOperation(prompt);
    if (arithmeticOperation) {
      return new AIMessage({
        content: "I'll calculate that for you.",
        tool_calls: [
          {
            id: `tool_${crypto.randomUUID()}`,
            name: "calculator",
            args: arithmeticOperation,
            type: "tool_call",
          },
        ],
        additional_kwargs: {},
        response_metadata: {},
      });
    }

    return new AIMessage({
      content: `Mock assistant heard: ${prompt || "Hello from AG-UI."}`,
      additional_kwargs: {},
      response_metadata: {},
    });
  }
}

export function resolveAgentConfig(forwardedProps: unknown): ExampleAgentConfig {
  if (!isRecord(forwardedProps)) {
    return DEFAULT_AGENT_CONFIG;
  }

  const provider =
    forwardedProps.provider === "openai-compatible"
      ? "openai-compatible"
      : ("mock" as ExampleProvider);

  return {
    provider,
    baseUrl:
      typeof forwardedProps.baseUrl === "string"
        ? forwardedProps.baseUrl
        : DEFAULT_AGENT_CONFIG.baseUrl,
    apiKey:
      typeof forwardedProps.apiKey === "string"
        ? forwardedProps.apiKey
        : DEFAULT_AGENT_CONFIG.apiKey,
    model:
      typeof forwardedProps.model === "string"
        ? forwardedProps.model
        : DEFAULT_AGENT_CONFIG.model,
    useResponsesApi:
      typeof forwardedProps.useResponsesApi === "boolean"
        ? forwardedProps.useResponsesApi
        : DEFAULT_AGENT_CONFIG.useResponsesApi,
    outputVersion:
      forwardedProps.outputVersion === "v1" ? "v1" : DEFAULT_AGENT_CONFIG.outputVersion,
  };
}

function usesResponsesApiOutput(model: string): boolean {
  const normalizedModel = model.trim().toLowerCase();
  const providerQualifiedModel = normalizedModel.split("/").at(-1) ?? normalizedModel;
  return providerQualifiedModel.startsWith("gpt-5");
}

export function createExampleModel(config: ExampleAgentConfig): BaseChatModel {
  if (config.provider === "mock") {
    return new ExampleMockModel();
  }

  const useResponsesApi =
    config.useResponsesApi || usesResponsesApiOutput(config.model);
  const sharedConfig = {
    model: config.model,
    apiKey: config.apiKey,
    streaming: true,
    streamUsage: false,
    useResponsesApi,
    outputVersion: useResponsesApi ? config.outputVersion : "v0",
    configuration: {
      baseURL: config.baseUrl,
    },
  } as const;

  if (useResponsesApi) {
    return new ChatOpenAI(sharedConfig);
  }

  return new ChatOpenAI({
    ...sharedConfig,
    temperature: 0,
  });
}

export function createCalculatorTool() {
  return tool(
    async ({
      a,
      b,
      operation,
    }: {
      a: number;
      b: number;
      operation: ArithmeticOperation["operation"];
    }) => {
      switch (operation) {
        case "add":
          return String(a + b);
        case "subtract":
          return String(a - b);
        case "multiply":
          return String(a * b);
        case "divide":
          return String(a / b);
      }
    },
    {
      name: "calculator",
      description: "Perform arithmetic operations.",
      schema: z.object({
        a: z.number(),
        b: z.number(),
        operation: z.enum(["add", "subtract", "multiply", "divide"]),
      }),
    }
  );
}

export function createAGUIToolDefinition() {
  return {
    name: "calculator",
    description: "Perform arithmetic operations.",
    parameters: CALCULATOR_TOOL_PARAMETERS,
  };
}

export function acceptsJson(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return contentType?.toLowerCase().includes("application/json") ?? false;
}

export function jsonError(
  status: number,
  error: string,
  headers?: HeadersInit
): Response {
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has("Content-Type")) {
    responseHeaders.set("Content-Type", "application/json");
  }

  return new Response(JSON.stringify({ error }), {
    status,
    headers: responseHeaders,
  });
}

export async function readRunInput(request: Request): Promise<RunAgentInput> {
  const payload = await request.json();
  return RunAgentInputSchema.parse(payload);
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function toAgentInput(input: RunAgentInput): Record<string, unknown> {
  if (isRecord(input.state)) {
    return {
      ...input.state,
      messages: input.messages,
    };
  }

  return {
    messages: input.messages,
    state: input.state,
  };
}

export async function consumeAgentStream(
  stream: AsyncIterable<unknown>
): Promise<unknown> {
  let lastChunk: unknown;

  for await (const chunk of stream) {
    lastChunk = chunk;
  }

  return lastChunk;
}

export function createSSEHeaders(): Headers {
  return new Headers(SSE_HEADERS);
}

export function buildRunAgentInput(
  prompt: string,
  config: Partial<ExampleAgentConfig> = {}
): RunAgentInput {
  const forwardedProps = {
    ...DEFAULT_AGENT_CONFIG,
    ...config,
  };

  return {
    threadId: `thread_${crypto.randomUUID()}`,
    runId: `run_${crypto.randomUUID()}`,
    state: {},
    messages: [
      {
        id: `message_${crypto.randomUUID()}`,
        role: "user",
        content: prompt,
      },
    ],
    tools: [createAGUIToolDefinition()],
    context: [],
    forwardedProps,
  };
}

export async function readSSEFrames(response: Response): Promise<string[]> {
  const body = response.body;
  if (!body) {
    return [];
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: string[] = [];

  const drainFrames = () => {
    let delimiterIndex = buffer.indexOf("\n\n");
    while (delimiterIndex >= 0) {
      frames.push(buffer.slice(0, delimiterIndex));
      buffer = buffer.slice(delimiterIndex + 2);
      delimiterIndex = buffer.indexOf("\n\n");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    drainFrames();
  }

  buffer += decoder.decode();
  drainFrames();

  if (buffer.length > 0) {
    frames.push(buffer);
  }

  return frames;
}

export function parseSSEEvents(frames: string[]): BaseEvent[] {
  return frames
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice(6)) as BaseEvent);
}

export function assertCanonicalEventSequence(events: BaseEvent[]): void {
  if (events.length === 0) {
    throw new Error("No AG-UI events were emitted.");
  }

  if (events[0]?.type !== "RUN_STARTED") {
    throw new Error(
      `Expected RUN_STARTED first, received ${String(events[0]?.type)}.`
    );
  }

  const terminal = events.at(-1)?.type;
  if (terminal !== "RUN_FINISHED" && terminal !== "RUN_ERROR") {
    throw new Error(
      `Expected RUN_FINISHED or RUN_ERROR last, received ${String(terminal)}.`
    );
  }
}

export function summarizeEvent(event: BaseEvent): string {
  if (isRunAgentInput(event)) {
    return "RunAgentInput";
  }

  const eventRecord = event as Record<string, unknown>;
  if (event.type === "RUN_ERROR" && typeof eventRecord.message === "string") {
    return `${event.type} message=${eventRecord.message}`;
  }

  if (typeof eventRecord.messageId === "string") {
    return `${event.type} messageId=${eventRecord.messageId}`;
  }

  if (typeof eventRecord.toolCallId === "string") {
    return `${event.type} toolCallId=${eventRecord.toolCallId}`;
  }

  return event.type;
}
