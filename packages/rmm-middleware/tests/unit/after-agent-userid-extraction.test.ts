import { describe, expect, test } from "bun:test";
import { createMockBaseStore } from "../fixtures/mock-base-store";

/**
 * Tests for afterAgent userId extraction from runtime
 *
 * These tests verify that afterAgent correctly extracts userId from:
 * - runtime.configurable.sessionId
 * - runtime.context.sessionId
 *
 * Bug: The factory's afterAgent callback was not extracting userId,
 * causing the hook to always return early at line 139: if (!(userId && store)) return {}
 */

describe("afterAgent - UserId Extraction", () => {
  test("extracts userId from runtime.configurable.sessionId", async () => {
    const { rmmMiddleware } = await import("@/index");

    const mockStore = createMockBaseStore();
    const middleware = rmmMiddleware({
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {
          return await Promise.resolve();
        },
      },
      enabled: true,
    });

    // Runtime with sessionId in configurable
    const runtime = {
      configurable: { sessionId: "configurable-user-123" },
      context: {
        store: mockStore,
        sessionId: "context-user-456",
      },
    };

    const state = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Test message" },
          lc_id: ["human"],
          content: "Test message",
          additional_kwargs: {},
        },
      ],
    };

    await middleware.afterAgent(state as any, runtime as any);

    // Should persist to "configurable-user-123" (configurable takes precedence)
    const buffer = await mockStore.get(
      ["rmm", "configurable-user-123", "buffer"],
      "message-buffer"
    );
    expect(buffer).not.toBeNull();
    expect(buffer?.value.messages).toHaveLength(1);
  });

  test("extracts userId from runtime.context.sessionId when configurable is missing", async () => {
    const { rmmMiddleware } = await import("@/index");

    const mockStore = createMockBaseStore();
    const middleware = rmmMiddleware({
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {
          return await Promise.resolve();
        },
      },
      enabled: true,
    });

    // Runtime with only sessionId in context
    const runtime = {
      context: {
        store: mockStore,
        sessionId: "context-only-user-789",
      },
    };

    const state = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Test message" },
          lc_id: ["human"],
          content: "Test message",
          additional_kwargs: {},
        },
      ],
    };

    await middleware.afterAgent(state as any, runtime as any);

    // Should persist to "context-only-user-789"
    const buffer = await mockStore.get(
      ["rmm", "context-only-user-789", "buffer"],
      "message-buffer"
    );
    expect(buffer).not.toBeNull();
    expect(buffer?.value.messages).toHaveLength(1);
  });

  test("handles missing userId gracefully", async () => {
    const { rmmMiddleware } = await import("@/index");

    const mockStore = createMockBaseStore();
    const middleware = rmmMiddleware({
      vectorStore: {
        similaritySearch: async () => [],
        addDocuments: async () => {
          return await Promise.resolve();
        },
      },
      enabled: true,
    });

    // Runtime without any sessionId
    const runtime = {
      configurable: {},
      context: {
        store: mockStore,
      },
    };

    const state = {
      messages: [
        {
          lc_serialized: { type: "human" },
          lc_kwargs: { content: "Test message" },
          lc_id: ["human"],
          content: "Test message",
          additional_kwargs: {},
        },
      ],
    };

    // Should not throw, should return early gracefully
    const result = await middleware.afterAgent(state as any, runtime as any);
    expect(result).toEqual({});
  });
});
