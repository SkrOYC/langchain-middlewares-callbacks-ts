/**
 * Test helper for creating LangChain-compatible messages
 *
 * Provides utilities for creating properly-typed messages
 * that satisfy LangChain's BaseMessage interface requirements.
 */

import type { BaseMessage } from "@langchain/core/messages";
import {
  AIMessage,
  HumanMessage,
  type StoredMessage,
  SystemMessage,
} from "@langchain/core/messages";

/**
 * Creates a SerializedMessage (plain object) for testing
 * Uses the new LangChain StoredMessage format: { data: {...}, type: string }
 */
export function createSerializedMessage(
  type: "human" | "ai" | "system" | "tool",
  content: string
): StoredMessage {
  return {
    data: {
      content,
      role: type,
      name: "",
      tool_call_id: undefined,
    },
    type,
  };
}

/**
 * Creates a HumanMessage for testing
 */
export function createHumanMessage(content: string): HumanMessage {
  return new HumanMessage({ content });
}

/**
 * Creates an AIMessage for testing
 */
export function createAIMessage(content: string): AIMessage {
  return new AIMessage({ content });
}

/**
 * Creates a SystemMessage for testing
 */
export function createSystemMessage(content: string): SystemMessage {
  return new SystemMessage({ content });
}

/**
 * Creates an array of messages for testing
 */
export function createTestMessages(
  messages: Array<{ type: "human" | "ai" | "system"; content: string }>
): BaseMessage[] {
  return messages.map((msg) => {
    switch (msg.type) {
      case "human":
        return createHumanMessage(msg.content);
      case "ai":
        return createAIMessage(msg.content);
      case "system":
        return createSystemMessage(msg.content);
      default:
        throw new Error(`Unknown message type: ${msg.type}`);
    }
  });
}

/**
 * Creates an array of SerializedMessages for testing
 */
export function createTestSerializedMessages(
  messages: Array<{ type: "human" | "ai" | "system" | "tool"; content: string }>
): StoredMessage[] {
  return messages.map((msg) => createSerializedMessage(msg.type, msg.content));
}
