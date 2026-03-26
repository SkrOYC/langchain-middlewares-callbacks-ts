import type { OpenResponsesEvent } from "@/core/schemas.js";
import type {
  LangChainMessageLike,
  OpenResponsesCompatibleAgent,
} from "@/core/types.js";

type StreamCallback = (
  input: { messages: LangChainMessageLike[] },
  config: Record<string, unknown>
) => Iterable<unknown>;

type BridgeHandler = Record<string, (...args: unknown[]) => void>;

const toAsyncIterable = (
  iterable: Iterable<unknown>
): AsyncIterable<unknown> => {
  const iterator = iterable[Symbol.iterator]();
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return Promise.resolve(iterator.next());
        },
      };
    },
  };
};

export const createCallbackDrivenAgent = (params: {
  onStream: StreamCallback;
}): OpenResponsesCompatibleAgent => ({
  invoke(input) {
    return Promise.resolve({ messages: [...input.messages] });
  },
  stream(input, config) {
    return toAsyncIterable(params.onStream(input, config ?? {}));
  },
});

const extractBridge = (config: Record<string, unknown>): BridgeHandler => {
  const callbacks = (config.callbacks ?? []) as Record<string, unknown>[];
  return callbacks[0] as BridgeHandler;
};

const extractRunId = (config: Record<string, unknown>): string => {
  return (
    ((config.configurable as Record<string, unknown>)?.run_id as string) ??
    "run-1"
  );
};

export function* simulateTextStream(
  _input: { messages: LangChainMessageLike[] },
  config: Record<string, unknown>
): Iterable<unknown> {
  const bridge = extractBridge(config);
  const runId = extractRunId(config);

  bridge.handleChatModelStart?.({}, [[]], runId, undefined);
  yield { type: "chunk", content: "" };

  bridge.handleLLMNewToken?.("Hello", undefined, runId);
  yield { type: "chunk", content: "Hello" };

  bridge.handleLLMNewToken?.(" world", undefined, runId);
  yield { type: "chunk", content: " world" };

  bridge.handleLLMEnd?.({ generations: [] }, runId);
  yield { type: "chunk", content: "" };

  bridge.handleAgentEnd?.({}, runId);
}

export function* simulateFailureStream(
  _input: { messages: LangChainMessageLike[] },
  config: Record<string, unknown>
): Iterable<unknown> {
  const bridge = extractBridge(config);
  const runId = extractRunId(config);

  bridge.handleChatModelStart?.({}, [[]], runId, undefined);
  yield { type: "chunk", content: "" };

  bridge.handleLLMNewToken?.("Hi", undefined, runId);
  yield { type: "chunk", content: "Hi" };

  throw new Error("model crashed");
}

export function* simulateToolCallStream(
  _input: { messages: LangChainMessageLike[] },
  config: Record<string, unknown>
): Iterable<unknown> {
  const bridge = extractBridge(config);
  const runId = extractRunId(config);

  bridge.handleChatModelStart?.({}, [[]], runId, undefined);
  yield { type: "chunk", content: "" };

  bridge.handleAgentAction?.(
    {
      tool: "get_weather",
      toolInput: { city: "Boston" },
      toolCallId: "call-1",
    },
    runId
  );
  yield { type: "chunk", content: "" };

  bridge.handleToolStart?.(
    {},
    '{"city":"Boston"}',
    "tool-run-1",
    runId,
    undefined,
    undefined,
    "get_weather",
    "call-1"
  );
  yield { type: "chunk", content: "" };

  bridge.handleToolEnd?.({ temperature: "55F" }, "tool-run-1", runId);
  yield { type: "chunk", content: "" };

  bridge.handleAgentEnd?.({}, runId);
}

export const collectStream = async (
  stream: AsyncIterable<OpenResponsesEvent | "[DONE]">
): Promise<(OpenResponsesEvent | "[DONE]")[]> => {
  const events: (OpenResponsesEvent | "[DONE]")[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

export const createBaseRequest = () => ({
  model: "test-model",
  input: "Hello",
  tools: [],
  parallel_tool_calls: true,
  stream: true,
  metadata: {},
});
