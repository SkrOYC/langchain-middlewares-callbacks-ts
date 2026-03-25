import type { OpenResponsesCompatibleAgent } from "../src/core/types.ts";

type BridgeHandler = Record<string, (...args: unknown[]) => void>;

const TOOL_CALL_ARGUMENTS = JSON.stringify({
  location: "San Francisco, CA",
});

const extractBridge = (config: Record<string, unknown>): BridgeHandler => {
  const callbacks = (config.callbacks ?? []) as Record<string, unknown>[];
  return (callbacks[0] ?? {}) as BridgeHandler;
};

const extractRunId = (config: Record<string, unknown>): string => {
  const configurable = config.configurable as
    | Record<string, unknown>
    | undefined;
  return (configurable?.run_id as string | undefined) ?? "run-1";
};

const createInvokeResult = (
  input: { messages: unknown[] },
  config?: Record<string, unknown>
) => {
  const configurable = config?.configurable as
    | Record<string, unknown>
    | undefined;
  const serializedToolPolicy = (configurable?.openresponses_tool_policy ??
    {}) as {
    tools?: Array<{ name?: string }>;
  };

  if ((serializedToolPolicy.tools?.length ?? 0) > 0) {
    return {
      messages: [
        ...input.messages,
        {
          type: "assistant",
          id: "assistant-tool-1",
          content: "",
          tool_calls: [
            {
              id: "call-weather-1",
              type: "function_call",
              name: serializedToolPolicy.tools?.[0]?.name ?? "get_weather",
              arguments: TOOL_CALL_ARGUMENTS,
            },
          ],
        },
      ],
    };
  }

  return {
    messages: [
      ...input.messages,
      {
        type: "assistant",
        id: "assistant-msg-1",
        content: "Hello from the compliance fixture.",
      },
    ],
  };
};

export const createOfficialComplianceFixtureAgent =
  (): OpenResponsesCompatibleAgent => ({
    invoke(
      input: { messages: unknown[] },
      config?: Record<string, unknown>
    ): Promise<unknown> {
      return Promise.resolve(createInvokeResult(input, config));
    },

    async *stream(
      _input: { messages: unknown[] },
      config?: Record<string, unknown>
    ): AsyncIterable<unknown> {
      await Promise.resolve();
      const bridge = extractBridge(config ?? {});
      const runId = extractRunId(config ?? {});

      bridge.handleChatModelStart?.({}, [[]], runId, undefined);
      yield { type: "chunk", content: "" };

      bridge.handleLLMNewToken?.("Hello", undefined, runId);
      yield { type: "chunk", content: "Hello" };

      bridge.handleLLMNewToken?.(" world", undefined, runId);
      yield { type: "chunk", content: " world" };

      bridge.handleLLMEnd?.({ generations: [] }, runId);
      yield { type: "chunk", content: "" };

      bridge.handleAgentEnd?.({}, runId);
    },
  });
