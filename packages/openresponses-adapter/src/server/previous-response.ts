/**
 * Continuation persistence and replay helpers.
 */

import {
  agentExecutionFailed,
  internalError,
  invalidRequest,
  previousResponseNotFound,
  previousResponseUnusable,
} from "@/core/errors.js";
import {
  type ErrorObject,
  type FunctionTool,
  type InputItem,
  type OpenResponsesRequest,
  OpenResponsesRequestSchema,
  type OpenResponsesResponse,
  OpenResponsesResponseSchema,
  type OutputItem,
  type OutputTextPart,
  StoredResponseRecordSchema,
  type ToolChoice,
} from "@/core/schemas.js";
import { getEffectiveToolChoiceMode } from "@/core/tool-policy.js";
import type {
  LangChainMessageLike,
  NormalizedRequest,
  NormalizedToolPolicy,
  PreviousResponseStore,
  StoredResponseRecord,
} from "@/core/types.js";

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

const inputToItems = (input: OpenResponsesRequest["input"]): InputItem[] => {
  if (typeof input === "string") {
    return [
      {
        type: "message",
        role: "user",
        content: input,
      },
    ];
  }

  return safeStructuredClone(input);
};

const normalizeToolChoice = (
  toolChoice: OpenResponsesRequest["tool_choice"]
): ToolChoice => {
  if (toolChoice === undefined) {
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
      content: safeStructuredClone(item.content),
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

  if (Array.isArray(value) && value.every(isRecord)) {
    return safeStructuredClone(value);
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
  return [
    {
      type: "function_call_output",
      call_id: callId,
      output: toFunctionCallOutputValue(value.content),
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

  return {
    type: "tool",
    role: "tool",
    tool_call_id: item.call_id,
    content: stringifyToolMessageContent(item.output),
  };
};

const normalizeToolPolicy = (
  request: OpenResponsesRequest
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

const parseRequest = (request: OpenResponsesRequest): OpenResponsesRequest => {
  const result = OpenResponsesRequestSchema.safeParse(request);

  if (!result.success) {
    throw invalidRequest(formatZodIssues(result.error.issues));
  }

  return result.data;
};

export const parseStoredResponseRecord = (
  value: unknown,
  responseId: string
): StoredResponseRecord => {
  const result = StoredResponseRecordSchema.safeParse(value);

  if (!result.success) {
    throw previousResponseUnusable(
      responseId,
      formatZodIssues(result.error.issues)
    );
  }

  return safeStructuredClone(result.data);
};

export const synchronizeStoredResponseRecord = (
  record: StoredResponseRecord
): StoredResponseRecord => {
  const synchronizedRequest: StoredResponseRecord["request"] = {
    model: record.response.model,
    input: inputToItems(record.request.input),
    metadata: safeStructuredClone(record.request.metadata),
    tools: safeStructuredClone(record.request.tools),
    parallel_tool_calls: record.request.parallel_tool_calls,
  };

  if (record.request.tool_choice !== undefined) {
    synchronizedRequest.tool_choice = safeStructuredClone(
      record.request.tool_choice
    );
  }

  const synchronizedRecord: StoredResponseRecord = {
    ...record,
    response_id: record.response.id,
    created_at: record.response.created_at,
    completed_at: record.response.completed_at,
    model: record.response.model,
    request: synchronizedRequest,
    response: safeStructuredClone(record.response),
    status: toStoredTerminalStatus(record.response.status),
    error: record.response.error,
  };

  return parseStoredResponseRecord(
    synchronizedRecord,
    synchronizedRecord.response_id
  );
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
    const priorResponseItems = validatedRecord.response.output.map(
      outputItemToInputItem
    );

    replayedInputItems = [
      ...priorRequestItems,
      ...priorResponseItems,
      ...currentInputItems,
    ];
  }

  return {
    inputItems: replayedInputItems,
    messages: replayedInputItems.map(inputItemToMessage),
    original: parsedRequest,
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
  request: OpenResponsesRequest;
  responseId: string;
  result: unknown;
  inputMessageCount: number;
  createdAt: number;
  completedAt: number;
  generateId: () => string;
}): OpenResponsesResponse => {
  const response = {
    id: params.responseId,
    object: "response",
    created_at: params.createdAt,
    completed_at: params.completedAt,
    status: "completed",
    model: params.request.model,
    previous_response_id: params.request.previous_response_id ?? null,
    output: asOutputItems({
      inputMessageCount: params.inputMessageCount,
      result: params.result,
      generateId: params.generateId,
    }),
    error: null,
    metadata: safeStructuredClone(params.request.metadata),
  } satisfies OpenResponsesResponse;

  return OpenResponsesResponseSchema.parse(response);
};

export const materializeStreamResponse = (params: {
  request: OpenResponsesRequest;
  responseId: string;
  createdAt: number;
  completedAt: number | null;
  status: OpenResponsesResponse["status"];
  output: OutputItem[];
  error: ErrorObject | null;
}): OpenResponsesResponse => {
  const response = {
    id: params.responseId,
    object: "response",
    created_at: params.createdAt,
    completed_at: params.completedAt,
    status: params.status,
    model: params.request.model,
    previous_response_id: params.request.previous_response_id ?? null,
    output: safeStructuredClone(params.output),
    error: params.error ? safeStructuredClone(params.error) : null,
    metadata: safeStructuredClone(params.request.metadata),
  } satisfies OpenResponsesResponse;

  return OpenResponsesResponseSchema.parse(response);
};

export const createStoredResponseRecord = (params: {
  request: OpenResponsesRequest;
  normalizedInputItems: InputItem[];
  response: OpenResponsesResponse;
}): StoredResponseRecord => {
  const requestRecord: StoredResponseRecord["request"] = {
    model: params.request.model,
    input: safeStructuredClone(params.normalizedInputItems),
    metadata: safeStructuredClone(params.request.metadata),
    tools: safeStructuredClone(params.request.tools),
    parallel_tool_calls: params.request.parallel_tool_calls,
  };

  if (params.request.tool_choice !== undefined) {
    requestRecord.tool_choice = safeStructuredClone(params.request.tool_choice);
  }

  return synchronizeStoredResponseRecord({
    response_id: params.response.id,
    created_at: params.response.created_at,
    completed_at: params.response.completed_at,
    model: params.response.model,
    request: requestRecord,
    response: safeStructuredClone(params.response),
    status: toStoredTerminalStatus(params.response.status),
    error: params.response.error,
  });
};

export const toPublicErrorBody = (
  error: ErrorObject
): { error: ErrorObject } => {
  return { error };
};
