import type {
  SystemMessage as AGUISystemMessage,
  ToolMessage as AGUIToolMessage,
  AssistantMessage,
  DeveloperMessage,
  InputContent,
  Message,
  ReasoningMessage,
  Role,
  ToolCall,
  UserMessage,
} from "@ag-ui/core";
import {
  AIMessage,
  type BaseMessage,
  ChatMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { generateId } from "./id-generator";

const UNSERIALIZABLE_CONTENT_FALLBACK = "[unserializable content]";
const UNSERIALIZABLE_TOOL_ARGS_FALLBACK = "{}";

interface ToolCallSource {
  id?: string;
  name?: unknown;
  args?: unknown;
}
type MessageLike = BaseMessage & {
  id?: string;
  role?: string;
  name?: string;
  content?: unknown;
  tool_calls?: ToolCallSource[];
  tool_call_id?: string;
  kwargs?: {
    tool_calls?: ToolCallSource[];
    tool_call_id?: string;
  };
  _getType?: () => string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function fallbackStringContent(value: unknown): string {
  if (typeof value === "undefined") {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  const serialized = safeStringify(value);
  if (typeof serialized === "string") {
    return serialized;
  }
  return UNSERIALIZABLE_CONTENT_FALLBACK;
}

function isAGUITextInputContent(
  value: unknown
): value is Extract<InputContent, { type: "text" }> {
  if (!isRecord(value)) {
    return false;
  }
  return value.type === "text" && typeof value.text === "string";
}

function isAGUIBinaryInputContent(
  value: unknown
): value is Extract<InputContent, { type: "binary" }> {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type !== "binary" || typeof value.mimeType !== "string") {
    return false;
  }

  if (
    (value.id !== undefined && typeof value.id !== "string") ||
    (value.url !== undefined && typeof value.url !== "string") ||
    (value.data !== undefined && typeof value.data !== "string") ||
    (value.filename !== undefined && typeof value.filename !== "string")
  ) {
    return false;
  }

  return (
    typeof value.id === "string" ||
    typeof value.url === "string" ||
    typeof value.data === "string"
  );
}

function isAGUIInputContentArray(value: unknown): value is InputContent[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every(
    (item) => isAGUITextInputContent(item) || isAGUIBinaryInputContent(item)
  );
}

function toRole(value: unknown): Exclude<Role, "activity"> | undefined {
  switch (value) {
    case "assistant":
    case "user":
    case "system":
    case "developer":
    case "tool":
    case "reasoning":
      return value;
    default:
      return undefined;
  }
}

function mapContentForRole(
  role: Role,
  content: unknown
): string | InputContent[] {
  if (typeof content === "string") {
    return content;
  }

  // AG-UI allows structured multimodal content on user messages only.
  if (role === "user" && isAGUIInputContentArray(content)) {
    return content;
  }

  return fallbackStringContent(content);
}

function resolveRoleAndToolState(
  message: BaseMessage,
  messageLike: MessageLike
): {
  role: Exclude<Role, "activity">;
  toolCallId?: string;
  toolCalls?: ToolCall[];
} {
  const messageType = messageLike._getType?.();
  const explicitRole = toRole(messageLike.role);
  let role: Exclude<Role, "activity"> = "assistant";
  let toolCalls: ToolCall[] | undefined;
  let toolCallId: string | undefined;

  if (
    message instanceof HumanMessage ||
    explicitRole === "user" ||
    messageType === "human"
  ) {
    return { role: "user" };
  }

  if (
    message instanceof AIMessage ||
    explicitRole === "assistant" ||
    messageType === "ai"
  ) {
    const toolCallsFromLLM =
      messageLike.tool_calls || messageLike.kwargs?.tool_calls;
    if (toolCallsFromLLM && toolCallsFromLLM.length > 0) {
      toolCalls = toolCallsFromLLM.map((tc) => ({
        id: tc.id || generateId(),
        type: "function",
        function: {
          name: String(tc.name ?? "unknown_tool"),
          arguments:
            typeof tc.args === "string"
              ? tc.args
              : (safeStringify(tc.args) ?? UNSERIALIZABLE_TOOL_ARGS_FALLBACK),
        },
      }));
    }

    return {
      role: "assistant",
      toolCalls,
    };
  }

  if (
    message instanceof ToolMessage ||
    explicitRole === "tool" ||
    messageType === "tool"
  ) {
    toolCallId = messageLike.tool_call_id || messageLike.kwargs?.tool_call_id;
    return {
      role: "tool",
      toolCallId,
    };
  }

  if (
    message instanceof SystemMessage ||
    explicitRole === "system" ||
    messageType === "system"
  ) {
    return { role: "system" };
  }

  if (message instanceof ChatMessage) {
    role = toRole(message.role) ?? "assistant";
    return { role };
  }

  if (explicitRole) {
    return { role: explicitRole };
  }

  return { role };
}

/**
 * Maps a LangChain BaseMessage to an AG-UI Protocol Message.
 *
 * @param message - The LangChain message to map
 * @returns An AG-UI Protocol compliant Message object
 */
export function mapLangChainMessageToAGUI(message: BaseMessage): Message {
  const messageLike = message as MessageLike;
  const id = messageLike.id || generateId();
  const { role, toolCalls, toolCallId } = resolveRoleAndToolState(
    message,
    messageLike
  );

  if (role === "assistant") {
    const assistantMessage: AssistantMessage = {
      id,
      role,
      content: fallbackStringContent(messageLike.content),
      toolCalls,
      name: messageLike.name,
    };
    return assistantMessage;
  }

  if (role === "tool") {
    const toolMessage: AGUIToolMessage = {
      id,
      role,
      content: fallbackStringContent(messageLike.content),
      toolCallId: toolCallId ?? generateId(),
    };
    return toolMessage;
  }

  if (role === "user") {
    const userMessage: UserMessage = {
      id,
      role,
      content: mapContentForRole(role, messageLike.content),
      name: messageLike.name,
    };
    return userMessage;
  }

  if (role === "system") {
    const systemMessage: AGUISystemMessage = {
      id,
      role,
      content: fallbackStringContent(messageLike.content),
      name: messageLike.name,
    };
    return systemMessage;
  }

  if (role === "developer") {
    const developerMessage: DeveloperMessage = {
      id,
      role,
      content: fallbackStringContent(messageLike.content),
      name: messageLike.name,
    };
    return developerMessage;
  }

  const reasoningMessage: ReasoningMessage = {
    id,
    role,
    content: fallbackStringContent(messageLike.content),
  };
  return reasoningMessage;
}
