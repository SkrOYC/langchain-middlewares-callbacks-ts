import type { Message, Role, ToolCall } from "@ag-ui/core";
import {
	AIMessage,
	type BaseMessage,
	ChatMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
} from "@langchain/core/messages";
import { generateId } from "./idGenerator";

const UNSERIALIZABLE_CONTENT_FALLBACK = "[unserializable content]";
const UNSERIALIZABLE_TOOL_ARGS_FALLBACK = "{}";

type AGUITextInputContent = {
	type: "text";
	text: string;
};

type AGUIBinaryInputContent = {
	type: "binary";
	mimeType: string;
	id?: string;
	url?: string;
	data?: string;
	filename?: string;
};

type AGUIInputContent = AGUITextInputContent | AGUIBinaryInputContent;

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
	if (!isRecord(value)) return false;
	return value.type === "text" && typeof value.text === "string";
}

function isAGUIBinaryInputContent(
	value: unknown,
): value is AGUIBinaryInputContent {
	if (!isRecord(value)) return false;
	if (value.type !== "binary" || typeof value.mimeType !== "string") {
		return false;
	}
	return (
		typeof value.id === "string" ||
		typeof value.url === "string" ||
		typeof value.data === "string"
	);
}

function isAGUIInputContentArray(value: unknown): value is AGUIInputContent[] {
	if (!Array.isArray(value)) return false;
	return value.every(
		(item) => isAGUITextInputContent(item) || isAGUIBinaryInputContent(item),
	);
}

function mapContentForRole(
	role: Role,
	content: unknown,
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
	const id = (message as any).id || generateId();
	let role: Role = "assistant";
	let toolCalls: ToolCall[] | undefined;
	let toolCallId: string | undefined;

	if (
		message instanceof HumanMessage ||
		(message as any).role === "user" ||
		(message as any)._getType?.() === "human"
	) {
		role = "user";
	} else if (
		message instanceof AIMessage ||
		(message as any).role === "assistant" ||
		(message as any)._getType?.() === "ai"
	) {
		role = "assistant";
		const toolCallsFromLLM =
			(message as any).tool_calls || (message as any).kwargs?.tool_calls;
		if (toolCallsFromLLM && toolCallsFromLLM.length > 0) {
			toolCalls = toolCallsFromLLM.map((tc: any) => ({
				id: tc.id || generateId(),
				type: "function",
				function: {
					name: String(tc.name ?? "unknown_tool"),
					arguments:
						typeof tc.args === "string"
							? tc.args
							: safeStringify(tc.args) ?? UNSERIALIZABLE_TOOL_ARGS_FALLBACK,
				},
			}));
		}
	} else if (
		message instanceof ToolMessage ||
		(message as any).role === "tool" ||
		(message as any)._getType?.() === "tool"
	) {
		role = "tool";
		toolCallId =
			(message as any).tool_call_id || (message as any).kwargs?.tool_call_id;
	} else if (
		message instanceof SystemMessage ||
		(message as any).role === "system" ||
		(message as any)._getType?.() === "system"
	) {
		role = "system";
	} else if (message instanceof ChatMessage) {
		role = message.role as any;
	} else if ((message as any).role) {
		role = (message as any).role;
	}

	const content = mapContentForRole(role, (message as any).content);

	return {
		id,
		role,
		content,
		toolCalls,
		toolCallId,
		name: (message as any).name,
	};
}
