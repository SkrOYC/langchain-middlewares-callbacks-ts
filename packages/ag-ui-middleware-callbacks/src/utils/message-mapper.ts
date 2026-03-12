import type { Message, Role, ToolCall } from "@ag-ui/core";
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

interface AGUITextInputContent {
  type: "text";
  text: string;
}

interface AGUIBinaryInputContent {
  type: "binary";
  mimeType: string;
  id?: string;
  url?: string;
  data?: string;
  filename?: string;
}

type AGUIInputContent = AGUITextInputContent | AGUIBinaryInputContent;
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
  const serialized = safeStringify(value);
  if (typeof serialized === "string") {
    return serialized;
  }
  return UNSERIALIZABLE_CONTENT_FALLBACK;
}

function isAGUITextInputContent(value: unknown): value is AGUITextInputContent {
  if (!isRecord(value)) {
    return false;
  }
  return value.type === "text" && typeof value.text === "string";
}

function isAGUIBinaryInputContent(
  value: unknown
): value is AGUIBinaryInputContent {
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

function isAGUIInputContentArray(value: unknown): value is AGUIInputContent[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every(
    (item) => isAGUITextInputContent(item) || isAGUIBinaryInputContent(item)
  );
}

function toRole(value: unknown): Role | undefined {
  switch (value) {
    case "assistant":
    case "user":
    case "system":
    case "developer":
    case "tool":
    case "activity":
      return value;
    default:
      return undefined;
  }
}

function mapContentForRole(
  role: Role,
  content: unknown
): string | AGUIInputContent[] | undefined {
  if (typeof content === "string") {
    return content;
  }

  // AG-UI allows structured multimodal content on user messages only.
  if (role === "user" && isAGUIInputContentArray(content)) {
    return content;
  }

  return fallbackStringContent(content);
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
  let role: Role = "assistant";
  let toolCalls: ToolCall[] | undefined;
  let toolCallId: string | undefined;
  const messageType = messageLike._getType?.();
  const explicitRole = toRole(messageLike.role);

  if (
    message instanceof HumanMessage ||
    explicitRole === "user" ||
    messageType === "human"
  ) {
    role = "user";
  } else if (
    message instanceof AIMessage ||
    explicitRole === "assistant" ||
    messageType === "ai"
  ) {
    role = "assistant";
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
  } else if (
    message instanceof ToolMessage ||
    explicitRole === "tool" ||
    messageType === "tool"
  ) {
    role = "tool";
    toolCallId = messageLike.tool_call_id || messageLike.kwargs?.tool_call_id;
  } else if (
    message instanceof SystemMessage ||
    explicitRole === "system" ||
    messageType === "system"
  ) {
    role = "system";
  } else if (message instanceof ChatMessage) {
    role = toRole(message.role) ?? "assistant";
  } else if (explicitRole) {
    role = explicitRole;
  }

  const content = mapContentForRole(role, messageLike.content);

  return {
    id,
    role,
    content,
    toolCalls,
    toolCallId,
    name: messageLike.name,
  };
}
