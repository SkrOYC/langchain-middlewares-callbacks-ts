import type { ErrorObject, OpenResponsesResponse } from "@/core/schemas.js";
import { OpenResponsesResponseSchema } from "@/core/schemas.js";
import type { OpenResponsesRequestSnapshot } from "@/core/types.js";

const clone = <T>(value: T): T => {
  return structuredClone(value);
};

const normalizeTimestamp = (value: number | null): number | null => {
  if (value === null) {
    return null;
  }

  // Default clocks still commonly provide Date.now() millisecond values.
  if (value >= 1_000_000_000_000) {
    return Math.floor(value / 1000);
  }

  return value;
};

const normalizeRequiredTimestamp = (value: number): number => {
  return normalizeTimestamp(value) ?? 0;
};

const normalizeError = (
  error: ErrorObject | null
): OpenResponsesResponse["error"] => {
  if (error === null) {
    return null;
  }

  return {
    code: error.code,
    message: error.message,
  };
};

const normalizeOutput = (output: unknown[]): unknown[] => {
  return output.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("type" in item) ||
      item.type !== "message"
    ) {
      return clone(item);
    }

    const messageItem = item as Record<string, unknown>;
    const content = Array.isArray(messageItem.content)
      ? messageItem.content
      : [];

    return {
      ...clone(messageItem),
      content: content.map((part) => {
        if (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "output_text"
        ) {
          return {
            ...clone(part),
            annotations: Array.isArray(part.annotations)
              ? clone(part.annotations)
              : [],
            logprobs: Array.isArray(part.logprobs) ? clone(part.logprobs) : [],
          };
        }

        return clone(part);
      }),
    };
  });
};

export interface TerminalResponseMaterializationParams {
  request: OpenResponsesRequestSnapshot;
  responseId: string;
  createdAt: number;
  completedAt: number | null;
  status: OpenResponsesResponse["status"];
  output: unknown[];
  error: ErrorObject | null;
  incompleteDetails?: unknown;
  usage?: unknown;
}

export const materializeTerminalResponse = (
  params: TerminalResponseMaterializationParams
): OpenResponsesResponse => {
  const response = {
    id: params.responseId,
    object: "response",
    created_at: normalizeRequiredTimestamp(params.createdAt),
    completed_at: normalizeTimestamp(params.completedAt),
    status: params.status,
    incomplete_details:
      params.status === "incomplete"
        ? (params.incompleteDetails ?? { reason: "max_output_tokens" })
        : null,
    model: params.request.model,
    previous_response_id: params.request.previous_response_id,
    instructions: params.request.instructions,
    output: normalizeOutput(params.output),
    error: normalizeError(params.error),
    tools: clone(params.request.tools),
    tool_choice: clone(params.request.tool_choice),
    truncation: params.request.truncation,
    parallel_tool_calls: params.request.parallel_tool_calls,
    text: clone(params.request.text),
    top_p: params.request.top_p,
    presence_penalty: params.request.presence_penalty,
    frequency_penalty: params.request.frequency_penalty,
    top_logprobs: params.request.top_logprobs,
    temperature: params.request.temperature,
    reasoning: params.request.reasoning
      ? clone(params.request.reasoning)
      : null,
    usage: params.usage ? clone(params.usage) : null,
    max_output_tokens: params.request.max_output_tokens,
    max_tool_calls: params.request.max_tool_calls,
    store: params.request.store,
    background: params.request.background,
    service_tier: params.request.service_tier,
    metadata: clone(params.request.metadata),
    safety_identifier: params.request.safety_identifier,
    prompt_cache_key: params.request.prompt_cache_key,
  };

  return OpenResponsesResponseSchema.parse(response);
};
