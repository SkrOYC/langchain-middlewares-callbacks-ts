import { describe, expect, test } from "bun:test";
import type { BaseMessage } from "@langchain/core/messages";
import { MessageBufferSchema } from "@/schemas";
import {
  countHumanMessages,
  getLastHumanMessage,
  isHumanMessage,
} from "@/utils/message-helpers";

/**
 * Tests for message helpers
 *
 * These tests verify that message helpers:
 * 1. Properly detect human messages in various formats
 * 2. Count human messages correctly
 * 3. Find the last human message in an array
 */

interface TestMessage {
  lc_serialized?: { type: string };
  lc_id?: string[];
  type?: string;
  content: string;
  additional_kwargs?: Record<string, unknown>;
}

function createTestMessage(
  type: string,
  content: string
): TestMessage & BaseMessage {
  return {
    lc_serialized: { type },
    lc_id: [type],
    type,
    content,
    additional_kwargs: {},
  };
}

describe("Message Helpers", () => {
  describe("isHumanMessage", () => {
    test("detects human message with lc_serialized", () => {
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
        type: "human",
        content: "Hello",
      } as unknown as BaseMessage;

      expect(isHumanMessage(message)).toBe(true);
    });

    test("handles message with lc_id only", () => {
      const message = {
        lc_id: ["human"],
        content: "Hello",
      } as unknown as BaseMessage;

      expect(isHumanMessage(message)).toBe(true);
    });
  });

  describe("countHumanMessages", () => {
    test("counts human messages correctly", () => {
      const messages: BaseMessage[] = [
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
      const messages: BaseMessage[] = [
        createTestMessage("ai", "I am AI"),
        createTestMessage("system", "System message"),
      ];

      const count = countHumanMessages(messages);
      expect(count).toBe(0);
    });

    test("handles single human message", () => {
      const messages: BaseMessage[] = [createTestMessage("human", "Hello")];

      const count = countHumanMessages(messages);
      expect(count).toBe(1);
    });
  });

  describe("getLastHumanMessage", () => {
    test("finds last human message", () => {
      const messages: BaseMessage[] = [
        createTestMessage("human", "First"),
        createTestMessage("ai", "AI response"),
        createTestMessage("human", "Last human"),
      ];

      const last = getLastHumanMessage(messages);
      expect(last).toBeDefined();
      expect((last as TestMessage).content).toBe("Last human");
    });

    test("returns undefined for no human messages", () => {
      const messages: BaseMessage[] = [createTestMessage("ai", "I am AI")];

      const last = getLastHumanMessage(messages);
      expect(last).toBeUndefined();
    });

    test("returns undefined for empty array", () => {
      const last = getLastHumanMessage([]);
      expect(last).toBeUndefined();
    });
  });
});

describe("MessageBufferSchema - BaseMessage Validation", () => {
  test("validates BaseMessage array with proper structure", () => {
    const validBuffer = {
      messages: [
        createTestMessage("human", "Hello"),
        createTestMessage("ai", "Hi there!"),
      ],
      humanMessageCount: 1,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const result = MessageBufferSchema.safeParse(validBuffer);
    expect(result.success).toBe(true);
  });

  test("rejects invalid message structure", () => {
    const invalidBuffer = {
      messages: [
        {
          // Missing required BaseMessage fields
          content: "Invalid message",
        },
      ],
      humanMessageCount: 0,
      lastMessageTimestamp: Date.now(),
      createdAt: Date.now(),
    };

    const result = MessageBufferSchema.safeParse(invalidBuffer);
    expect(result.success).toBe(false);
  });
});
