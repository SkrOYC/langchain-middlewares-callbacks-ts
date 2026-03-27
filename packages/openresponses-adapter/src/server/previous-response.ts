/**
 * Continuation persistence and replay helpers.
 */

import { contractSnapshotVersion } from "@/contract/snapshot.js";
import {
  agentExecutionFailed,
  internalError,
  invalidRequest,
  previousResponseNotFound,
  previousResponseUnusable,
} from "@/core/errors.js";
import type {
  ErrorObject,
  FunctionTool,
  InputItem,
  OpenResponsesRequest,
  OpenResponsesResponse,
  OutputItem,
  OutputTextPart,
  ToolChoice,
} from "@/core/schemas.js";
import {
  OpenResponsesRequestSchema,
  OutputItemSchema,
} from "@/core/schemas.js";
import { getEffectiveToolChoiceMode } from "@/core/tool-policy.js";
import type {
  LangChainMessageLike,
  NormalizedRequest,
  NormalizedToolPolicy,
  OpenResponsesRequestSnapshot,
  PreviousResponseStore,
  StoredResponseRecord,
} from "@/core/types.js";
import { materializeTerminalResponse } from "@/state/response-aggregate.js";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const getArrayProperty = (
  value: Record<string, unknown>,
  key: string
): unknown[] | undefined => {
  const property = value[key];
  return Array.isArray(property) ? property : undefined;
};

const getStringProperty = (
  value: Record<string, unknown>,
  key: string
): string | undefined => {
  const property = value[key];
  return typeof property === "string" ? property : undefined;
};

const safeStructuredClone = <T>(value: T): T => {
  return structuredClone(value);
};

interface ResolvedOpenResponsesRequest {
  model: string;
  input: unknown;
  previous_response_id: string | null;
  include: string[];
  tools: FunctionTool[];
  tool_choice: ToolChoice;
  metadata: Record<string, string>;
  text: OpenResponsesResponse["text"];
  temperature: number;
  top_p: number;
  presence_penalty: number;
  frequency_penalty: number;
  parallel_tool_calls: boolean;
  stream: boolean;
  stream_options: Record<string, unknown> | null;
  background: boolean;
  max_output_tokens: number | null;
  max_tool_calls: number | null;
  reasoning: OpenResponsesResponse["reasoning"];
  safety_identifier: string | null;
  prompt_cache_key: string | null;
  truncation: OpenResponsesResponse["truncation"];
  instructions: string | null;
  store: boolean;
  service_tier: OpenResponsesResponse["service_tier"];
  top_logprobs: number;
}

const DEFAULT_TEXT_RESPONSE = {
  format: {
    type: "text",
  },
  verbosity: "medium",
} as const satisfies OpenResponsesResponse["text"];

const DEFAULT_REQUEST_SETTINGS = {
  background: false,
  frequency_penalty: 0,
  include: [],
  instructions: null,
  max_output_tokens: null,
  max_tool_calls: null,
  metadata: {},
  parallel_tool_calls: true,
  presence_penalty: 0,
  prompt_cache_key: null,
  reasoning: null,
  safety_identifier: null,
  service_tier: "default",
  store: false,
  stream: false,
  stream_options: null,
  temperature: 1,
  text: DEFAULT_TEXT_RESPONSE,
  tool_choice: "auto",
  tools: [],
  top_logprobs: 0,
  top_p: 1,
  truncation: "disabled",
} as const;

const formatZodIssues = (
  issues: { message: string; path: PropertyKey[] }[]
): string => {
  return issues
    .map((issue) => {
      if (issue.path.length === 0) {
        return issue.message;
      }

      return `${issue.path.join(".")}: ${issue.message}`;
    })
    .join("; ");
};

const inputToItems = (input: unknown): InputItem[] => {
  if (typeof input === "string") {
    return [
      {
        type: "message",
        role: "user",
        content: input,
      },
    ];
  }

  if (input === undefined || input === null) {
    return [];
  }

  if (Array.isArray(input)) {
    return safeStructuredClone(input as InputItem[]);
  }

  return [];
};

const normalizeTextConfig = (
  text: OpenResponsesRequest["text"]
): OpenResponsesResponse["text"] => {
  if (text === undefined || text === null) {
    return safeStructuredClone(DEFAULT_REQUEST_SETTINGS.text);
  }

  return {
    format:
      text.format === undefined || text.format === null
        ? safeStructuredClone(DEFAULT_REQUEST_SETTINGS.text.format)
        : safeStructuredClone(text.format),
    verbosity:
      text.verbosity ??
      safeStructuredClone(DEFAULT_REQUEST_SETTINGS.text.verbosity),
  };
};

const normalizeReasoningConfig = (
  reasoning: OpenResponsesRequest["reasoning"]
): OpenResponsesResponse["reasoning"] => {
  if (reasoning === undefined || reasoning === null) {
    return null;
  }

  return {
    effort: reasoning.effort ?? null,
    summary: reasoning.summary ?? null,
  };
};

const normalizeMetadata = (
  metadata: OpenResponsesRequest["metadata"]
): Record<string, string> => {
  if (metadata === undefined || metadata === null) {
    return {};
  }

  return safeStructuredClone(metadata as Record<string, string>);
};

const arrayPropertyIfPresent = <T>(
  record: Record<string, unknown>,
  key: string
): T[] | undefined => {
  const value = record[key];
  return Array.isArray(value) ? safeStructuredClone(value as T[]) : undefined;
};

const booleanPropertyIfPresent = (
  record: Record<string, unknown>,
  key: string
): boolean | undefined => {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
};

const numberPropertyIfPresent = (
  record: Record<string, unknown>,
  key: string
): number | undefined => {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
};

const nullableNumberPropertyIfPresent = (
  record: Record<string, unknown>,
  key: string
): number | null | undefined => {
  const value = record[key];
  if (typeof value === "number" || value === null) {
    return value;
  }

  return undefined;
};

const clonedPropertyIfPresent = <T>(
  record: Record<string, unknown>,
  key: string
): T | undefined => {
  if (!(key in record)) {
    return undefined;
  }

  return safeStructuredClone(record[key] as T);
};

const normalizeTools = (
  tools: OpenResponsesRequest["tools"]
): FunctionTool[] => {
  if (tools === undefined || tools === null) {
    return [];
  }

  return tools.map((tool) => {
    return {
      type: "function",
      name: tool.name,
      description: tool.description ?? "",
      parameters:
        tool.parameters === undefined
          ? null
          : safeStructuredClone(
              tool.parameters as Record<string, unknown> | null
            ),
      strict: tool.strict ?? true,
    };
  });
};

const normalizeToolChoice = (
  toolChoice: OpenResponsesRequest["tool_choice"]
): ToolChoice => {
  if (toolChoice === undefined || toolChoice === null) {
    return "auto";
  }

  if (
    typeof toolChoice === "object" &&
    toolChoice !== null &&
    "type" in toolChoice &&
    toolChoice.type === "allowed_tools"
  ) {
    return {
      ...safeStructuredClone(toolChoice),
      mode: toolChoice.mode ?? "auto",
    };
  }

  return safeStructuredClone(toolChoice);
};

const normalizePreviousResponseId = (
  previousResponseId: OpenResponsesRequest["previous_response_id"]
): string | null => {
  if (typeof previousResponseId !== "string") {
    return null;
  }

  return previousResponseId.length > 0 ? previousResponseId : null;
};

const assertUniqueToolNames = (tools: FunctionTool[]): void => {
  const seen = new Set<string>();

  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw invalidRequest(`Duplicate tool name '${tool.name}' is not allowed`);
    }
    seen.add(tool.name);
  }
};

const getAllowedToolNames = (toolChoice: ToolChoice, tools: FunctionTool[]) => {
  const declaredToolNames = new Set(tools.map((tool) => tool.name));

  if (
    typeof toolChoice === "object" &&
    toolChoice !== null &&
    "type" in toolChoice
  ) {
    if (toolChoice.type === "allowed_tools") {
      const allowedToolNames = new Set<string>();

      for (const tool of toolChoice.tools) {
        if (!declaredToolNames.has(tool.name)) {
          throw invalidRequest(
            `tool_choice references unknown tool '${tool.name}'`
          );
        }

        if (allowedToolNames.has(tool.name)) {
          throw invalidRequest(
            `tool_choice.allowed_tools contains duplicate tool '${tool.name}'`
          );
        }

        allowedToolNames.add(tool.name);
      }

      return allowedToolNames;
    }

    if (!declaredToolNames.has(toolChoice.name)) {
      throw invalidRequest(
        `tool_choice references unknown tool '${toolChoice.name}'`
      );
    }

    return new Set([toolChoice.name]);
  }

  return declaredToolNames;
};

const outputItemToInputItem = (item: OutputItem): InputItem => {
  if (item.type === "message") {
    return {
      type: "message",
      role: "assistant",
      content: safeStructuredClone(
        item.content.filter((part) => {
          return part.type === "output_text" || part.type === "refusal";
        })
      ),
    };
  }

  if (item.type === "reasoning") {
    return {
      type: "reasoning",
      id: item.id,
      summary: item.summary
        .map((part) => {
          return "text" in part
            ? ({ type: "summary_text", text: part.text } as const)
            : null;
        })
        .filter((part) => {
          return part !== null;
        }),
      ...(item.content ? { content: safeStructuredClone(item.content) } : {}),
      ...("encrypted_content" in item && item.encrypted_content !== undefined
        ? { encrypted_content: item.encrypted_content }
        : {}),
    };
  }

  if (item.type === "function_call_output") {
    return {
      type: "function_call_output",
      call_id: item.call_id,
      output: safeStructuredClone(item.output),
      status: item.status,
    };
  }

  return {
    type: "function_call",
    call_id: item.call_id,
    name: item.name,
    arguments: item.arguments,
    status: item.status,
  };
};

const normalizeOutputItemStatus = (
  status: unknown
): "in_progress" | "completed" | "incomplete" => {
  if (
    status === "in_progress" ||
    status === "completed" ||
    status === "incomplete"
  ) {
    return status;
  }

  return "completed";
};

const createOutputTextPart = (text: string): OutputTextPart => {
  return {
    type: "output_text",
    text,
    annotations: [],
    logprobs: [],
  };
};

const contentPartFromUnknown = (value: unknown): OutputTextPart | null => {
  if (typeof value === "string") {
    return value.length > 0 ? createOutputTextPart(value) : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const partType = getStringProperty(value, "type");
  const partText = getStringProperty(value, "text");
  if (
    (partType === "output_text" || partType === "text") &&
    partText !== undefined
  ) {
    return createOutputTextPart(partText);
  }

  return null;
};

const contentArrayToOutputTextParts = (
  content: unknown[]
): OutputTextPart[] => {
  const textParts: OutputTextPart[] = [];

  for (const part of content) {
    const textPart = contentPartFromUnknown(part);
    if (textPart) {
      textParts.push(textPart);
    }
  }

  if (textParts.length > 0 || content.length === 0) {
    return textParts;
  }

  return [createOutputTextPart(JSON.stringify(content))];
};

const contentToOutputTextParts = (content: unknown): OutputTextPart[] => {
  if (typeof content === "string") {
    return content.length > 0 ? [createOutputTextPart(content)] : [];
  }

  if (Array.isArray(content)) {
    return contentArrayToOutputTextParts(content);
  }

  if (content === undefined || content === null) {
    return [];
  }

  return [createOutputTextPart(String(content))];
};

const getToolCalls = (
  message: Record<string, unknown>
): Record<string, unknown>[] => {
  const directToolCalls = getArrayProperty(message, "tool_calls");
  if (directToolCalls) {
    return directToolCalls.filter(isRecord);
  }

  const additionalKwargs = message.additional_kwargs;
  if (!isRecord(additionalKwargs)) {
    return [];
  }

  const nestedToolCalls = getArrayProperty(additionalKwargs, "tool_calls");
  return nestedToolCalls ? nestedToolCalls.filter(isRecord) : [];
};

const stringifyFunctionCallArguments = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "";
  }

  return JSON.stringify(value);
};

const parseToolCallArguments = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const stringifyToolMessageContent = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "";
  }

  return JSON.stringify(value);
};

const createAssistantOutputItem = (params: {
  content: unknown;
  id?: string | undefined;
  status?: unknown;
  generateId: () => string;
}): OutputItem | null => {
  const content = contentToOutputTextParts(params.content);
  if (content.length === 0) {
    return null;
  }

  return {
    id: params.id ?? params.generateId(),
    type: "message",
    role: "assistant",
    status: normalizeOutputItemStatus(params.status),
    content,
  };
};

const createFunctionCallOutputItem = (params: {
  item: Record<string, unknown>;
  generateId: () => string;
}): OutputItem => {
  const callId =
    getStringProperty(params.item, "call_id") ??
    getStringProperty(params.item, "id") ??
    params.generateId();
  const rawArguments = params.item.arguments ?? params.item.args;
  const argumentsText = stringifyFunctionCallArguments(rawArguments);

  return {
    id: getStringProperty(params.item, "id") ?? params.generateId(),
    type: "function_call",
    status: normalizeOutputItemStatus(params.item.status),
    name: getStringProperty(params.item, "name") ?? "function_call",
    call_id: callId,
    arguments: argumentsText,
  };
};

const toOptionalInputStatus = (
  status: unknown
): "in_progress" | "completed" | "incomplete" | undefined => {
  if (
    status === "in_progress" ||
    status === "completed" ||
    status === "incomplete"
  ) {
    return status;
  }

  return undefined;
};

const toAssistantInputContent = (
  content: unknown
): string | OutputTextPart[] | null => {
  if (typeof content === "string") {
    return content.length > 0 ? content : null;
  }

  const outputTextParts = contentToOutputTextParts(content);
  return outputTextParts.length > 0 ? outputTextParts : null;
};

const createAssistantInputItem = (content: unknown): InputItem | null => {
  const normalizedContent = toAssistantInputContent(content);
  if (normalizedContent === null) {
    return null;
  }

  return {
    type: "message",
    role: "assistant",
    content: normalizedContent,
  };
};

const toFunctionCallOutputValue = (
  value: unknown
): string | Record<string, unknown>[] => {
  if (typeof value === "string") {
    return value;
  }

  if (
    Array.isArray(value) &&
    value.every((candidate) => {
      return (
        isRecord(candidate) &&
        typeof candidate.type === "string" &&
        (candidate.type === "input_text" ||
          candidate.type === "input_image" ||
          candidate.type === "input_file")
      );
    })
  ) {
    return safeStructuredClone(value) as Record<string, unknown>[];
  }

  if (value === undefined) {
    return "";
  }

  return JSON.stringify(value);
};

const createToolResultInputItems = (
  value: Record<string, unknown>
): InputItem[] => {
  const callId =
    getStringProperty(value, "tool_call_id") ??
    getStringProperty(value, "call_id");
  if (!callId) {
    return [];
  }

  const status = toOptionalInputStatus(value.status);
  const output = toFunctionCallOutputValue(value.content) as Extract<
    InputItem,
    { type: "function_call_output" }
  >["output"];
  return [
    {
      type: "function_call_output",
      call_id: callId,
      output,
      ...(status === undefined ? {} : { status }),
    },
  ];
};

const createStandaloneFunctionCallInputItems = (
  value: Record<string, unknown>
): InputItem[] => {
  const callId =
    getStringProperty(value, "call_id") ?? getStringProperty(value, "id");
  if (!callId) {
    return [];
  }

  const status = toOptionalInputStatus(value.status);
  return [
    {
      type: "function_call",
      call_id: callId,
      name: getStringProperty(value, "name") ?? "function_call",
      arguments: stringifyFunctionCallArguments(
        value.arguments ?? value.args ?? ""
      ),
      ...(status === undefined ? {} : { status }),
    },
  ];
};

const createAssistantHistoryInputItems = (
  value: Record<string, unknown>
): InputItem[] => {
  const inputItems: InputItem[] = [];
  const assistantItem = createAssistantInputItem(value.content);
  if (assistantItem) {
    inputItems.push(assistantItem);
  }

  for (const toolCall of getToolCalls(value)) {
    inputItems.push(...createStandaloneFunctionCallInputItems(toolCall));
  }

  return inputItems;
};

const resultValueToInputItems = (value: unknown): InputItem[] => {
  if (!isRecord(value)) {
    const assistantItem = createAssistantInputItem(value);
    return assistantItem ? [assistantItem] : [];
  }

  const directType = getStringProperty(value, "type");
  if (directType === "tool") {
    return createToolResultInputItems(value);
  }

  if (directType === "function_call") {
    return createStandaloneFunctionCallInputItems(value);
  }

  const shouldTreatAsAssistantMessage =
    directType === "ai" ||
    directType === "assistant" ||
    (directType === "message" &&
      getStringProperty(value, "role") === "assistant");

  if (shouldTreatAsAssistantMessage) {
    return createAssistantHistoryInputItems(value);
  }

  const fallbackAssistantItem = createAssistantInputItem(
    value.content ?? value
  );
  return fallbackAssistantItem ? [fallbackAssistantItem] : [];
};

const resultValueToOutputItems = (
  value: unknown,
  generateId: () => string
): OutputItem[] => {
  if (!isRecord(value)) {
    const assistantItem = createAssistantOutputItem({
      content: value,
      generateId,
    });
    return assistantItem ? [assistantItem] : [];
  }

  const directType = getStringProperty(value, "type");
  if (directType === "function_call") {
    return [createFunctionCallOutputItem({ item: value, generateId })];
  }

  if (directType === "tool") {
    return [];
  }

  const outputItems: OutputItem[] = [];
  const shouldTreatAsAssistantMessage =
    directType === "ai" ||
    directType === "assistant" ||
    (directType === "message" &&
      getStringProperty(value, "role") === "assistant");

  if (shouldTreatAsAssistantMessage) {
    const assistantItem = createAssistantOutputItem({
      content: value.content,
      id: getStringProperty(value, "id"),
      status: value.status,
      generateId,
    });
    if (assistantItem) {
      outputItems.push(assistantItem);
    }

    for (const toolCall of getToolCalls(value)) {
      outputItems.push(
        createFunctionCallOutputItem({ item: toolCall, generateId })
      );
    }

    return outputItems;
  }

  const fallbackAssistantItem = createAssistantOutputItem({
    content: value.content ?? value,
    id: getStringProperty(value, "id"),
    status: value.status,
    generateId,
  });

  return fallbackAssistantItem ? [fallbackAssistantItem] : [];
};

const getResultMessages = (
  result: unknown,
  inputMessageCount: number
): unknown[] | null => {
  if (!isRecord(result)) {
    return null;
  }

  const messages = getArrayProperty(result, "messages");
  if (!messages) {
    return null;
  }

  return messages.slice(inputMessageCount);
};

const splitResultMessagesForPersistence = (
  messages: unknown[]
): { replayValues: unknown[]; responseValues: unknown[] } => {
  let lastToolIndex = -1;

  for (const [index, value] of messages.entries()) {
    if (!isRecord(value)) {
      continue;
    }

    if (
      getStringProperty(value, "type") === "tool" ||
      getStringProperty(value, "role") === "tool"
    ) {
      lastToolIndex = index;
    }
  }

  if (lastToolIndex < 0) {
    return {
      replayValues: [],
      responseValues: messages,
    };
  }

  return {
    replayValues: messages.slice(0, lastToolIndex + 1),
    responseValues: messages.slice(lastToolIndex + 1),
  };
};

const toStoredTerminalStatus = (
  status: OpenResponsesResponse["status"]
): StoredResponseRecord["status"] => {
  if (
    status === "completed" ||
    status === "failed" ||
    status === "incomplete"
  ) {
    return status;
  }

  throw new Error(
    "Stored responses must reference a terminal response resource"
  );
};

const inputItemToMessage = (item: InputItem): LangChainMessageLike => {
  if (item.type === "message") {
    let type: string = item.role;

    if (item.role === "user") {
      type = "human";
    }

    if (item.role === "assistant") {
      type = "ai";
    }

    return {
      type,
      role: item.role,
      content: safeStructuredClone(item.content),
    };
  }

  if (item.type === "function_call") {
    return {
      type: "ai",
      role: "assistant",
      content: [],
      tool_calls: [
        {
          id: item.call_id,
          type: "tool_call",
          name: item.name,
          args: parseToolCallArguments(item.arguments),
        },
      ],
    };
  }

  if (item.type !== "function_call_output") {
    throw new Error(`Unsupported input item type '${item.type}'`);
  }

  return {
    type: "tool",
    role: "tool",
    tool_call_id: item.call_id,
    content: stringifyToolMessageContent(item.output),
  };
};

const reasoningSummaryPartToText = (part: unknown): string => {
  if (!isRecord(part)) {
    return "";
  }

  if (typeof part.text === "string") {
    return part.text;
  }

  if (typeof part.refusal === "string") {
    return part.refusal;
  }

  return "";
};

const inputItemToMessages = (item: InputItem): LangChainMessageLike[] => {
  if (item.type === "item_reference") {
    // The adapter preserves item references in the request snapshot, but the
    // LangChain runtime does not expose an equivalent message primitive.
    return [];
  }

  if (item.type === "reasoning") {
    const summaryText = item.summary
      .map(reasoningSummaryPartToText)
      .filter((part) => part.length > 0)
      .join(" ");

    return [
      {
        type: "ai",
        role: "assistant",
        content: summaryText.length > 0 ? summaryText : [],
        additional_kwargs: {
          reasoning: safeStructuredClone(item),
        },
      },
    ];
  }

  return [inputItemToMessage(item)];
};

const normalizeToolPolicy = (
  request: ResolvedOpenResponsesRequest
): NormalizedToolPolicy => {
  const tools = safeStructuredClone(request.tools);
  assertUniqueToolNames(tools);

  const toolChoice = normalizeToolChoice(request.tool_choice);
  const allowedToolNames = getAllowedToolNames(toolChoice, tools);

  return {
    tools,
    allowedToolNames,
    toolChoice,
    parallelToolCalls: request.parallel_tool_calls,
  };
};

const assertRequiredRequestFields: (
  request: OpenResponsesRequest
) => asserts request is OpenResponsesRequest & {
  model: string;
  input: unknown;
} = (request: OpenResponsesRequest): void => {
  if (!request.model) {
    throw invalidRequest("model is required");
  }

  if (request.input === undefined || request.input === null) {
    throw invalidRequest("input is required");
  }
};

const buildResolvedRequest = (
  parsedRequest: OpenResponsesRequest & {
    model: string;
    input: unknown;
  }
): ResolvedOpenResponsesRequest => {
  return {
    model: parsedRequest.model,
    input: parsedRequest.input,
    previous_response_id: normalizePreviousResponseId(
      parsedRequest.previous_response_id
    ),
    include: parsedRequest.include
      ? safeStructuredClone(parsedRequest.include)
      : [...DEFAULT_REQUEST_SETTINGS.include],
    tools: normalizeTools(parsedRequest.tools),
    tool_choice: normalizeToolChoice(parsedRequest.tool_choice),
    metadata: normalizeMetadata(parsedRequest.metadata),
    text: normalizeTextConfig(parsedRequest.text),
    temperature:
      parsedRequest.temperature ?? DEFAULT_REQUEST_SETTINGS.temperature,
    top_p: parsedRequest.top_p ?? DEFAULT_REQUEST_SETTINGS.top_p,
    presence_penalty:
      parsedRequest.presence_penalty ??
      DEFAULT_REQUEST_SETTINGS.presence_penalty,
    frequency_penalty:
      parsedRequest.frequency_penalty ??
      DEFAULT_REQUEST_SETTINGS.frequency_penalty,
    parallel_tool_calls:
      parsedRequest.parallel_tool_calls ??
      DEFAULT_REQUEST_SETTINGS.parallel_tool_calls,
    stream: parsedRequest.stream ?? DEFAULT_REQUEST_SETTINGS.stream,
    stream_options: parsedRequest.stream_options
      ? safeStructuredClone(
          parsedRequest.stream_options as Record<string, unknown>
        )
      : DEFAULT_REQUEST_SETTINGS.stream_options,
    background: parsedRequest.background ?? DEFAULT_REQUEST_SETTINGS.background,
    max_output_tokens:
      parsedRequest.max_output_tokens ??
      DEFAULT_REQUEST_SETTINGS.max_output_tokens,
    max_tool_calls:
      parsedRequest.max_tool_calls ?? DEFAULT_REQUEST_SETTINGS.max_tool_calls,
    reasoning: normalizeReasoningConfig(parsedRequest.reasoning),
    safety_identifier:
      parsedRequest.safety_identifier ??
      DEFAULT_REQUEST_SETTINGS.safety_identifier,
    prompt_cache_key:
      parsedRequest.prompt_cache_key ??
      DEFAULT_REQUEST_SETTINGS.prompt_cache_key,
    truncation: parsedRequest.truncation ?? DEFAULT_REQUEST_SETTINGS.truncation,
    instructions:
      parsedRequest.instructions ?? DEFAULT_REQUEST_SETTINGS.instructions,
    store: parsedRequest.store ?? DEFAULT_REQUEST_SETTINGS.store,
    service_tier:
      parsedRequest.service_tier ?? DEFAULT_REQUEST_SETTINGS.service_tier,
    top_logprobs:
      parsedRequest.top_logprobs ?? DEFAULT_REQUEST_SETTINGS.top_logprobs,
  };
};

const parseRequest = (
  request: OpenResponsesRequest
): ResolvedOpenResponsesRequest => {
  const result = OpenResponsesRequestSchema.safeParse(request);

  if (!result.success) {
    throw invalidRequest(formatZodIssues(result.error.issues));
  }

  const parsedRequest = result.data;
  assertRequiredRequestFields(parsedRequest);
  return buildResolvedRequest(parsedRequest);
};

const buildRequestSnapshot = (params: {
  request: ResolvedOpenResponsesRequest;
  inputItems: InputItem[];
}): OpenResponsesRequestSnapshot => {
  return {
    model: params.request.model,
    input: safeStructuredClone(params.inputItems),
    previous_response_id: params.request.previous_response_id,
    include: safeStructuredClone(params.request.include),
    tools: safeStructuredClone(params.request.tools),
    tool_choice: safeStructuredClone(params.request.tool_choice),
    parallel_tool_calls: params.request.parallel_tool_calls,
    instructions: params.request.instructions,
    store: params.request.store,
    background: params.request.background,
    truncation: params.request.truncation,
    text: safeStructuredClone(params.request.text),
    reasoning: params.request.reasoning
      ? safeStructuredClone(params.request.reasoning)
      : null,
    top_p: params.request.top_p,
    presence_penalty: params.request.presence_penalty,
    frequency_penalty: params.request.frequency_penalty,
    top_logprobs: params.request.top_logprobs,
    temperature: params.request.temperature,
    max_output_tokens: params.request.max_output_tokens,
    max_tool_calls: params.request.max_tool_calls,
    service_tier: params.request.service_tier,
    safety_identifier: params.request.safety_identifier,
    prompt_cache_key: params.request.prompt_cache_key,
    metadata: safeStructuredClone(params.request.metadata),
    stream_options: params.request.stream_options
      ? safeStructuredClone(params.request.stream_options)
      : null,
  };
};

export const parseStoredResponseRecord = (
  value: unknown,
  responseId: string
): StoredResponseRecord => {
  try {
    return synchronizeStoredResponseRecord(value as StoredResponseRecord);
  } catch (error) {
    throw previousResponseUnusable(
      responseId,
      error instanceof Error ? error.message : "stored record is invalid"
    );
  }
};

const normalizeStoredOutputTextPart = (
  value: unknown
): OutputTextPart | null => {
  if (typeof value === "string") {
    return {
      type: "output_text",
      text: value,
      annotations: [],
      logprobs: [],
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const partType = getStringProperty(value, "type");
  if (partType === "output_text" || partType === "text") {
    const text = getStringProperty(value, "text") ?? "";
    const annotations = Array.isArray(value.annotations)
      ? safeStructuredClone(value.annotations)
      : [];

    return {
      type: "output_text",
      text,
      annotations,
      logprobs: [],
    };
  }

  return null;
};

const normalizeStoredResponseOutput = (
  output: unknown,
  generateId: () => string
): OutputItem[] => {
  if (!Array.isArray(output)) {
    return [];
  }

  const normalizedOutput: OutputItem[] = [];

  for (const candidate of output) {
    const currentShapeResult = OutputItemSchema.safeParse(candidate);
    if (currentShapeResult.success) {
      normalizedOutput.push(
        safeStructuredClone(currentShapeResult.data as OutputItem)
      );
      continue;
    }

    if (
      isRecord(candidate) &&
      getStringProperty(candidate, "type") === "message"
    ) {
      const content = Array.isArray(candidate.content)
        ? candidate.content
        : [candidate.content];
      normalizedOutput.push({
        id: getStringProperty(candidate, "id") ?? generateId(),
        type: "message",
        role: "assistant",
        status: normalizeOutputItemStatus(candidate.status),
        content: content
          .map(normalizeStoredOutputTextPart)
          .filter((part): part is OutputTextPart => part !== null),
      });
      continue;
    }

    if (
      isRecord(candidate) &&
      getStringProperty(candidate, "type") === "function_call"
    ) {
      normalizedOutput.push({
        id: getStringProperty(candidate, "id") ?? generateId(),
        type: "function_call",
        status: normalizeOutputItemStatus(candidate.status),
        name: getStringProperty(candidate, "name") ?? "unknown_tool",
        call_id: getStringProperty(candidate, "call_id") ?? generateId(),
        arguments: getStringProperty(candidate, "arguments") ?? "",
      });
    }
  }

  return normalizedOutput;
};

const repairRequestSnapshot = (params: {
  request: unknown;
  response: unknown;
}): OpenResponsesRequestSnapshot => {
  const requestRecord = isRecord(params.request) ? params.request : {};
  const responseRecord = isRecord(params.response) ? params.response : {};
  const repairedRequest = parseRequest({
    model:
      getStringProperty(responseRecord, "model") ??
      getStringProperty(requestRecord, "model") ??
      "unknown-model",
    input:
      ("input" in requestRecord
        ? (requestRecord.input as OpenResponsesRequest["input"])
        : []) ?? [],
    previous_response_id:
      getStringProperty(requestRecord, "previous_response_id") ??
      (responseRecord.previous_response_id as string | null | undefined) ??
      null,
    include: arrayPropertyIfPresent<
      "reasoning.encrypted_content" | "message.output_text.logprobs"
    >(requestRecord, "include"),
    tools: arrayPropertyIfPresent<FunctionTool>(requestRecord, "tools"),
    tool_choice: clonedPropertyIfPresent<OpenResponsesRequest["tool_choice"]>(
      requestRecord,
      "tool_choice"
    ),
    metadata: normalizeMetadata(
      ("metadata" in requestRecord
        ? requestRecord.metadata
        : responseRecord.metadata) as OpenResponsesRequest["metadata"]
    ),
    text: clonedPropertyIfPresent<OpenResponsesRequest["text"]>(
      requestRecord,
      "text"
    ),
    temperature: numberPropertyIfPresent(requestRecord, "temperature"),
    top_p: numberPropertyIfPresent(requestRecord, "top_p"),
    presence_penalty: numberPropertyIfPresent(
      requestRecord,
      "presence_penalty"
    ),
    frequency_penalty: numberPropertyIfPresent(
      requestRecord,
      "frequency_penalty"
    ),
    parallel_tool_calls: booleanPropertyIfPresent(
      requestRecord,
      "parallel_tool_calls"
    ),
    background: booleanPropertyIfPresent(requestRecord, "background"),
    max_output_tokens: nullableNumberPropertyIfPresent(
      requestRecord,
      "max_output_tokens"
    ),
    max_tool_calls: nullableNumberPropertyIfPresent(
      requestRecord,
      "max_tool_calls"
    ),
    reasoning: clonedPropertyIfPresent<OpenResponsesRequest["reasoning"]>(
      requestRecord,
      "reasoning"
    ),
    safety_identifier:
      getStringProperty(requestRecord, "safety_identifier") ??
      (typeof responseRecord.safety_identifier === "string"
        ? responseRecord.safety_identifier
        : null),
    prompt_cache_key:
      getStringProperty(requestRecord, "prompt_cache_key") ??
      (typeof responseRecord.prompt_cache_key === "string"
        ? responseRecord.prompt_cache_key
        : null),
    truncation:
      (getStringProperty(requestRecord, "truncation") as
        | OpenResponsesRequest["truncation"]
        | undefined) ?? undefined,
    instructions:
      getStringProperty(requestRecord, "instructions") ??
      (typeof responseRecord.instructions === "string"
        ? responseRecord.instructions
        : null),
    store: booleanPropertyIfPresent(requestRecord, "store"),
    service_tier:
      (getStringProperty(requestRecord, "service_tier") as
        | OpenResponsesRequest["service_tier"]
        | undefined) ?? undefined,
    top_logprobs: numberPropertyIfPresent(requestRecord, "top_logprobs"),
    stream_options: clonedPropertyIfPresent<
      OpenResponsesRequest["stream_options"]
    >(requestRecord, "stream_options"),
  });

  return buildRequestSnapshot({
    request: repairedRequest,
    inputItems: inputToItems(repairedRequest.input),
  });
};

const repairStoredResponseResource = (params: {
  response: unknown;
  responseId: string;
  requestSnapshot: OpenResponsesRequestSnapshot;
}): OpenResponsesResponse => {
  if (!isRecord(params.response)) {
    throw new Error("stored response must be an object");
  }

  const status = getStringProperty(params.response, "status");
  if (
    status !== "completed" &&
    status !== "failed" &&
    status !== "incomplete"
  ) {
    throw new Error(
      "stored response must reference a terminal response resource"
    );
  }

  const createdAt =
    typeof params.response.created_at === "number"
      ? params.response.created_at
      : 0;

  let completedAt: number | null;
  if (typeof params.response.completed_at === "number") {
    completedAt = params.response.completed_at;
  } else if (params.response.completed_at === null) {
    completedAt = null;
  } else if (status === "completed" || status === "failed") {
    completedAt = createdAt;
  } else {
    completedAt = null;
  }

  const error =
    isRecord(params.response.error) &&
    typeof params.response.error.code === "string" &&
    typeof params.response.error.message === "string"
      ? ({
          code: params.response.error.code,
          message: params.response.error.message,
          type: "server_error",
        } satisfies ErrorObject)
      : null;

  const incompleteDetails =
    status === "incomplete" && isRecord(params.response.incomplete_details)
      ? (safeStructuredClone(
          params.response.incomplete_details
        ) as OpenResponsesResponse["incomplete_details"])
      : null;

  const usage =
    isRecord(params.response.usage) || params.response.usage === null
      ? (safeStructuredClone(
          params.response.usage
        ) as OpenResponsesResponse["usage"])
      : null;

  return materializeTerminalResponse({
    request: params.requestSnapshot,
    responseId: getStringProperty(params.response, "id") ?? params.responseId,
    createdAt,
    completedAt,
    status,
    output: normalizeStoredResponseOutput(params.response.output, () =>
      crypto.randomUUID()
    ),
    error,
    incompleteDetails,
    usage,
  });
};

export const synchronizeStoredResponseRecord = (
  record: StoredResponseRecord
): StoredResponseRecord => {
  if (!isRecord(record)) {
    throw new Error("stored record must be an object");
  }

  const rawResponse = record.response;
  const requestSnapshot = repairRequestSnapshot({
    request: record.request,
    response: rawResponse,
  });

  const response = repairStoredResponseResource({
    response: rawResponse,
    responseId:
      typeof record.response_id === "string"
        ? record.response_id
        : "stored-response",
    requestSnapshot,
  });

  return {
    response_id: response.id,
    request: requestSnapshot,
    response,
    status: toStoredTerminalStatus(response.status),
    created_at: response.created_at,
    completed_at: response.completed_at,
    contract_snapshot_version: contractSnapshotVersion,
  };
};

export const normalizeRequest = async (
  request: OpenResponsesRequest,
  deps: {
    previousResponseStore?: PreviousResponseStore;
    signal?: AbortSignal;
  }
): Promise<NormalizedRequest> => {
  const parsedRequest = parseRequest(request);
  const currentInputItems = inputToItems(parsedRequest.input);
  let replayedInputItems = currentInputItems;

  if (parsedRequest.previous_response_id) {
    if (!deps.previousResponseStore) {
      throw invalidRequest(
        "previous_response_id requires previousResponseStore to be configured"
      );
    }

    let storedRecord: StoredResponseRecord | null;
    try {
      storedRecord = await deps.previousResponseStore.load(
        parsedRequest.previous_response_id,
        deps.signal
      );
    } catch (error) {
      throw internalError("Failed to load previous response", error);
    }

    if (storedRecord === null) {
      throw previousResponseNotFound(parsedRequest.previous_response_id);
    }

    const validatedRecord = parseStoredResponseRecord(
      storedRecord,
      parsedRequest.previous_response_id
    );

    const priorRequestItems = inputToItems(validatedRecord.request.input);
    const priorResponseItems = validatedRecord.response.output.map((item) => {
      return outputItemToInputItem(item as unknown as OutputItem);
    });

    replayedInputItems = [
      ...priorRequestItems,
      ...priorResponseItems,
      ...currentInputItems,
    ];
  }

  return {
    inputItems: replayedInputItems,
    messages: replayedInputItems.flatMap(inputItemToMessages),
    requestSnapshot: buildRequestSnapshot({
      request: parsedRequest,
      inputItems: replayedInputItems,
    }),
    toolPolicy: normalizeToolPolicy(parsedRequest),
  };
};

const resultContainsToolCall = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }

  const directType = getStringProperty(value, "type");
  if (directType === "function_call") {
    return true;
  }

  return getToolCalls(value).length > 0;
};

const getCalledToolNames = (value: unknown): string[] => {
  if (!isRecord(value)) {
    return [];
  }

  const directType = getStringProperty(value, "type");
  if (directType === "function_call") {
    const name = getStringProperty(value, "name");
    return name ? [name] : [];
  }

  if (directType === "tool") {
    return [];
  }

  const names: string[] = [];
  for (const toolCall of getToolCalls(value)) {
    const name = getStringProperty(toolCall, "name");
    if (name) {
      names.push(name);
    }
  }

  return names;
};

export const validateRequiredToolCallResult = (params: {
  result: unknown;
  inputMessageCount: number;
  toolPolicy: NormalizedToolPolicy;
}): void => {
  const effectiveMode = getEffectiveToolChoiceMode(
    params.toolPolicy.toolChoice
  );
  if (effectiveMode !== "required") {
    return;
  }

  const resultMessages = getResultMessages(
    params.result,
    params.inputMessageCount
  );
  if (!resultMessages) {
    throw agentExecutionFailed(
      "tool_choice requires a tool call, but the agent result did not include message history"
    );
  }

  const toolCallObserved = resultMessages.some(resultContainsToolCall);
  if (!toolCallObserved) {
    throw agentExecutionFailed(
      "tool_choice requires a tool call, but the agent completed without calling a tool"
    );
  }

  const calledToolNames = new Set(
    resultMessages.flatMap((message) => getCalledToolNames(message))
  );

  if (
    typeof params.toolPolicy.toolChoice === "object" &&
    params.toolPolicy.toolChoice.type === "function" &&
    !calledToolNames.has(params.toolPolicy.toolChoice.name)
  ) {
    throw agentExecutionFailed(
      `tool_choice requires tool '${params.toolPolicy.toolChoice.name}', but the agent called a different tool`
    );
  }

  if (
    typeof params.toolPolicy.toolChoice === "object" &&
    params.toolPolicy.toolChoice.type === "allowed_tools"
  ) {
    const allowedCallObserved = [...calledToolNames].some((name) =>
      params.toolPolicy.allowedToolNames.has(name)
    );

    if (!allowedCallObserved) {
      throw agentExecutionFailed(
        "tool_choice requires a tool from the allowed set, but the agent completed without calling one"
      );
    }
  }
};

const asOutputItems = (params: {
  inputMessageCount: number;
  result: unknown;
  generateId: () => string;
}): OutputItem[] => {
  const resultMessages = getResultMessages(
    params.result,
    params.inputMessageCount
  );
  let values: unknown[];
  if (resultMessages) {
    values = splitResultMessagesForPersistence(resultMessages).responseValues;
  } else if (Array.isArray(params.result)) {
    values = params.result;
  } else {
    values = [params.result];
  }

  const outputItems: OutputItem[] = [];
  for (const value of values) {
    outputItems.push(...resultValueToOutputItems(value, params.generateId));
  }

  return outputItems;
};

export const buildStoredRequestInputItems = (params: {
  normalizedInputItems: InputItem[];
  result: unknown;
  inputMessageCount: number;
}): InputItem[] => {
  const resultMessages = getResultMessages(
    params.result,
    params.inputMessageCount
  );
  if (!resultMessages) {
    return safeStructuredClone(params.normalizedInputItems);
  }

  const replayInputItems: InputItem[] = [];
  for (const value of splitResultMessagesForPersistence(resultMessages)
    .replayValues) {
    replayInputItems.push(...resultValueToInputItems(value));
  }

  return [
    ...safeStructuredClone(params.normalizedInputItems),
    ...replayInputItems,
  ];
};

export const materializeInvokeResponse = (params: {
  request: OpenResponsesRequestSnapshot;
  responseId: string;
  result: unknown;
  inputMessageCount: number;
  createdAt: number;
  completedAt: number;
  generateId: () => string;
}): OpenResponsesResponse => {
  return materializeTerminalResponse({
    request: params.request,
    responseId: params.responseId,
    createdAt: params.createdAt,
    completedAt: params.completedAt,
    status: "completed",
    output: asOutputItems({
      inputMessageCount: params.inputMessageCount,
      result: params.result,
      generateId: params.generateId,
    }),
    error: null,
  });
};

export const materializeStreamResponse = (params: {
  request: OpenResponsesRequestSnapshot;
  responseId: string;
  createdAt: number;
  completedAt: number | null;
  status: OpenResponsesResponse["status"];
  output: unknown[];
  error: unknown;
}): OpenResponsesResponse => {
  return materializeTerminalResponse({
    request: params.request,
    responseId: params.responseId,
    createdAt: params.createdAt,
    completedAt: params.completedAt,
    status: params.status,
    output: safeStructuredClone(params.output),
    error: (params.error as ErrorObject | null) ?? null,
  });
};

export const createStoredResponseRecord = (params: {
  request: OpenResponsesRequestSnapshot;
  normalizedInputItems: InputItem[];
  response: OpenResponsesResponse;
}): StoredResponseRecord => {
  return synchronizeStoredResponseRecord({
    response_id: params.response.id,
    request: {
      ...safeStructuredClone(params.request),
      input: safeStructuredClone(params.normalizedInputItems),
    },
    response: safeStructuredClone(params.response),
    status: toStoredTerminalStatus(params.response.status),
    created_at: params.response.created_at,
    completed_at: params.response.completed_at,
    contract_snapshot_version: contractSnapshotVersion,
  });
};

export const toPublicErrorBody = (
  error: ErrorObject
): { error: ErrorObject } => {
  return { error };
};
