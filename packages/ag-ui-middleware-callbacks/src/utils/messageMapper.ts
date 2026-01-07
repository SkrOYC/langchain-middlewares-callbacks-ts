import { 
  BaseMessage, 
  HumanMessage, 
  AIMessage, 
  ToolMessage, 
  SystemMessage,
  ChatMessage
} from "@langchain/core/messages";
import { generateId } from "./idGenerator";
import type { Message, ToolCall } from "../events";

/**
 * Maps a LangChain BaseMessage to an AG-UI Protocol Message.
 * 
 * @param message - The LangChain message to map
 * @returns An AG-UI Protocol compliant Message object
 */
export function mapLangChainMessageToAGUI(message: BaseMessage): Message {
  const id = (message as any).id || generateId();
  let role: Message["role"] = "assistant";
  let toolCalls: ToolCall[] | undefined;
  let toolCallId: string | undefined;
  let content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);

  if (message instanceof HumanMessage || (message as any).role === "user" || (message as any)._getType?.() === "human") {
    role = "user";
  } else if (message instanceof AIMessage || (message as any).role === "assistant" || (message as any)._getType?.() === "ai") {
    role = "assistant";
    const toolCallsFromLLM = (message as any).tool_calls || (message as any).kwargs?.tool_calls;
    if (toolCallsFromLLM && toolCallsFromLLM.length > 0) {
      toolCalls = toolCallsFromLLM.map((tc: any) => ({
        id: tc.id!,
        type: "function",
        function: {
          name: tc.name,
          arguments: typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args)
        }
      }));
    }
  } else if (message instanceof ToolMessage || (message as any).role === "tool" || (message as any)._getType?.() === "tool") {
    role = "tool";
    toolCallId = (message as any).tool_call_id || (message as any).kwargs?.tool_call_id;
  } else if (message instanceof SystemMessage || (message as any).role === "system" || (message as any)._getType?.() === "system") {
    role = "system";
  } else if (message instanceof ChatMessage) {
    role = message.role as any;
  } else if ((message as any).role) {
    role = (message as any).role;
  }

  return {
    id,
    role,
    content,
    toolCalls,
    toolCallId,
    name: (message as any).name
  };
}
