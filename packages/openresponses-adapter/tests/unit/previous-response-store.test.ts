import { describe, expect, test } from "bun:test";

import type { StoredResponseRecord } from "@/core/types.js";
import { createInMemoryPreviousResponseStore } from "@/testing/index.js";

const createRecord = (): StoredResponseRecord => {
  return {
    response_id: "outer-id",
    created_at: 1,
    completed_at: 2,
    model: "outer-model",
    request: {
      model: "outer-model",
      input: [
        {
          type: "message",
          role: "user",
          content: "Hello",
        },
      ],
      metadata: { source: "test" },
      tools: [],
      parallel_tool_calls: true,
    },
    response: {
      id: "resp-1",
      object: "response",
      created_at: 1000,
      completed_at: 2000,
      status: "completed",
      model: "gpt-4.1-mini",
      previous_response_id: null,
      output: [
        {
          id: "msg-1",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "World",
              annotations: [],
            },
          ],
        },
      ],
      error: null,
      metadata: { source: "test" },
    },
    status: "incomplete",
    error: {
      code: "wrong",
      message: "wrong",
      type: "server_error",
    },
  };
};

describe("InMemoryPreviousResponseStore", () => {
  test("synchronizes projected top-level fields from nested response on save", async () => {
    const store = createInMemoryPreviousResponseStore();
    const record = createRecord();

    await store.save(record);
    const loaded = await store.load("resp-1");

    expect(loaded).not.toBeNull();
    expect(loaded?.response_id).toBe("resp-1");
    expect(loaded?.created_at).toBe(1000);
    expect(loaded?.completed_at).toBe(2000);
    expect(loaded?.model).toBe("gpt-4.1-mini");
    expect(loaded?.status).toBe("completed");
    expect(loaded?.error).toBeNull();
    expect(loaded?.request.model).toBe("gpt-4.1-mini");
    expect(loaded?.response.id).toBe("resp-1");
  });

  test("provides immediate read-after-write consistency for saved records", async () => {
    const store = createInMemoryPreviousResponseStore();
    const record = createRecord();

    await store.save(record);

    const loaded = await store.load("resp-1");
    expect(loaded?.response.output[0]?.type).toBe("message");
    expect(store.__has("resp-1")).toBe(true);
    expect(store.__size()).toBe(1);
  });

  test("returns defensive copies when loading records", async () => {
    const store = createInMemoryPreviousResponseStore();
    const record = createRecord();

    await store.save(record);
    const firstLoad = await store.load("resp-1");
    const secondLoad = await store.load("resp-1");

    expect(firstLoad).not.toBeNull();
    expect(secondLoad).not.toBeNull();
    expect(firstLoad).not.toBe(secondLoad);

    if (firstLoad) {
      firstLoad.request.metadata.source = "mutated";
    }

    expect(secondLoad?.request.metadata.source).toBe("test");
  });
});
