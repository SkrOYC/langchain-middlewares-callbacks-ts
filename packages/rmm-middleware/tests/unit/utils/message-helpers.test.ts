import { describe, expect, test } from "bun:test";
import type { StoredMessage } from "@langchain/core/messages";
import {
  countHumanMessages,
  getLastHumanMessage,
  isHumanMessage,
} from "@/utils/message-helpers";
import { parseMessageBuffer } from "@/utils/validation";

/**
 * Tests for message helpers
 *
 * These tests verify that message helpers:
 * 1. Properly detect human messages in various formats
 * 2. Count human messages correctly
 * 3. Find the last human message in an array
 */

function createTestMessage(type: string, content: string): StoredMessage {
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

describe("Message Helpers", () => {
  describe("isHumanMessage", () => {
    test("detects human message with type property", () => {
      const message = createTestMessage("human", "Hello");
      expect(isHumanMessage(message)).toBe(true);
    });

    test("detects ai message", () => {
      const message = createTestMessage("ai", "I am AI");
      expect(isHumanMessage(message)).toBe(false);
    });

    test("detects system message", () => {
      const message = createTestMessage("system", "System prompt");
      expect(isHumanMessage(message)).toBe(false);
    });

    test("handles message with type property only", () => {
      const message = {
        data: {
          content: "Hello",
          role: "human",
          name: "",
          tool_call_id: undefined,
        },
        type: "human",
      } as unknown as StoredMessage;

      expect(isHumanMessage(message)).toBe(true);
    });

    test("handles message with data.role", () => {
      const message = {
        data: {
          content: "Hello",
          role: "human",
          name: "",
          tool_call_id: undefined,
        },
        type: "message",
      } as unknown as StoredMessage;

      expect(isHumanMessage(message)).toBe(true);
    });
  });

  describe("countHumanMessages", () => {
    test("counts human messages correctly", () => {
      const messages: StoredMessage[] = [
        createTestMessage("human", "Hello"),
        createTestMessage("ai", "Hi there!"),
        createTestMessage("human", "How are you?"),
        createTestMessage("system", "You are a helpful assistant"),
        createTestMessage("human", "Goodbye"),
      ];

      const count = countHumanMessages(messages);
      expect(count).toBe(3);
    });

    test("returns 0 for empty array", () => {
      const count = countHumanMessages([]);
      expect(count).toBe(0);
    });

    test("returns 0 for no human messages", () => {
      const messages: StoredMessage[] = [
        createTestMessage("ai", "I am AI"),
        createTestMessage("system", "System message"),
      ];

      const count = countHumanMessages(messages);
      expect(count).toBe(0);
    });

    test("handles single human message", () => {
      const messages: StoredMessage[] = [createTestMessage("human", "Hello")];

      const count = countHumanMessages(messages);
      expect(count).toBe(1);
    });
  });

  describe("getLastHumanMessage", () => {
    test("finds last human message", () => {
      const messages: StoredMessage[] = [
        createTestMessage("human", "First"),
        createTestMessage("ai", "AI response"),
        createTestMessage("human", "Last human"),
      ];

      const last = getLastHumanMessage(messages);
      expect(last).toBeDefined();
      expect(last?.data.content).toBe("Last human");
    });

    test("returns undefined for no human messages", () => {
      const messages: StoredMessage[] = [createTestMessage("ai", "I am AI")];

      const last = getLastHumanMessage(messages);
      expect(last).toBeUndefined();
    });

    test("returns undefined for empty array", () => {
      const last = getLastHumanMessage([]);
      expect(last).toBeUndefined();
    });
  });
});

describe("MessageBufferSchema - Validation", () => {
  test("validates message array with proper structure", () => {
    const validBuffer = {
      messages: [
        createTestMessage("human", "Hello"),
        createTestMessage("ai", "Hi there!"),
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    expect(() => parseMessageBuffer(validBuffer)).not.toThrow();
  });

  test("rejects invalid message structure", () => {
    const invalidBuffer = {
      messages: [
        {
          // Missing required type field
          data: { content: "Hello", role: "human" },
        },
      ],
      humanMessageCount: 0,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    expect(() => parseMessageBuffer(invalidBuffer)).toThrow();
  });

  test("accepts content block messages (LangChain v1)", () => {
    const contentBlockBuffer = {
      messages: [
        {
          type: "ai",
          data: {
            content: [{ type: "text", text: "Hello from blocks" }],
            role: "ai",
            tool_calls: [],
            invalid_tool_calls: [],
          },
        },
      ],
      humanMessageCount: 0,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const parsed = parseMessageBuffer(contentBlockBuffer);
    expect(parsed.messages).toHaveLength(1);
    const firstContent = parsed.messages[0]?.data.content;
    expect(Array.isArray(firstContent)).toBe(true);
  });
});
