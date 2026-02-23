import { describe, expect, test } from "bun:test";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createMockEmbeddings } from "@/tests/helpers/mock-embeddings";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createSessionHistory() {
  return [
    new HumanMessage("Hello, I went hiking this weekend"),
    new AIMessage("That sounds great!"),
    new HumanMessage("I also like coffee shops"),
    new AIMessage("Good to know."),
  ];
}

const promptBuilder = (dialogue: string) => `Dialogue:\n${dialogue}`;

describe("extractMemories", () => {
  test("exports extractMemories", async () => {
    const { extractMemories } = await import("@/algorithms/memory-extraction");
    expect(typeof extractMemories).toBe("function");
  });

  test("returns extracted memories with embeddings", async () => {
    const { extractMemories } = await import("@/algorithms/memory-extraction");

    const llm = {
      invoke: async () => ({
        text: JSON.stringify({
          extracted_memories: [
            { summary: "User likes hiking", reference: [0] },
            { summary: "User likes coffee", reference: [1] },
          ],
        }),
      }),
    };

    const result = await extractMemories(
      createSessionHistory(),
      llm as never,
      createMockEmbeddings(),
      promptBuilder,
      "session-1"
    );

    expect(result).not.toBeNull();
    expect(result?.length).toBe(2);
    const first = result?.[0];
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    expect(first.topicSummary).toBe("User likes hiking");
    expect(first.embedding.length).toBe(1536);
    expect(first.sessionId).toBe("session-1");
    expect(first.id).toMatch(UUID_REGEX);
  });

  test("returns empty array for NO_TRAIT", async () => {
    const { extractMemories } = await import("@/algorithms/memory-extraction");

    const llm = {
      invoke: async () => ({ text: "NO_TRAIT" }),
    };

    const result = await extractMemories(
      createSessionHistory(),
      llm as never,
      createMockEmbeddings(),
      promptBuilder
    );

    expect(result).toEqual([]);
  });

  test("returns null for invalid JSON", async () => {
    const { extractMemories } = await import("@/algorithms/memory-extraction");

    const llm = {
      invoke: async () => ({ text: "not-json" }),
    };

    const result = await extractMemories(
      createSessionHistory(),
      llm as never,
      createMockEmbeddings(),
      promptBuilder
    );

    expect(result).toBeNull();
  });

  test("parses fenced JSON output", async () => {
    const { extractMemories } = await import("@/algorithms/memory-extraction");

    const llm = {
      invoke: async () => ({
        text: [
          "```json",
          JSON.stringify(
            {
              extracted_memories: [
                { summary: "User likes hiking", reference: [0] },
              ],
            },
            null,
            2
          ),
          "```",
        ].join("\n"),
      }),
    };

    const result = await extractMemories(
      createSessionHistory(),
      llm as never,
      createMockEmbeddings(),
      promptBuilder
    );

    expect(result).not.toBeNull();
    expect(result?.length).toBe(1);
    expect(result?.[0]?.topicSummary).toBe("User likes hiking");
  });

  test("handles object-style NO_TRAIT payload", async () => {
    const { extractMemories } = await import("@/algorithms/memory-extraction");

    const llm = {
      invoke: async () => ({
        text: JSON.stringify({
          extracted_memories: "NO_TRAIT",
        }),
      }),
    };

    const result = await extractMemories(
      createSessionHistory(),
      llm as never,
      createMockEmbeddings(),
      promptBuilder
    );

    expect(result).toEqual([]);
  });

  test("falls back to response.content when response.text is empty", async () => {
    const { extractMemories } = await import("@/algorithms/memory-extraction");

    const llm = {
      invoke: async () => ({
        text: "",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              extracted_memories: [
                { summary: "User tracks sleep quality", reference: [1] },
              ],
            }),
          },
        ],
      }),
    };

    const result = await extractMemories(
      createSessionHistory(),
      llm as never,
      createMockEmbeddings(),
      promptBuilder
    );

    expect(result).not.toBeNull();
    expect(result?.length).toBe(1);
    expect(result?.[0]?.topicSummary).toBe("User tracks sleep quality");
  });

  test("returns null when llm invoke throws", async () => {
    const { extractMemories } = await import("@/algorithms/memory-extraction");

    const llm = {
      invoke: async () => {
        return await Promise.reject(new Error("LLM failed"));
      },
    };

    const result = await extractMemories(
      createSessionHistory(),
      llm as never,
      createMockEmbeddings(),
      promptBuilder
    );

    expect(result).toBeNull();
  });

  test("returns empty array for empty session", async () => {
    const { extractMemories } = await import("@/algorithms/memory-extraction");

    const result = await extractMemories(
      [],
      { invoke: async () => ({ text: "NO_TRAIT" }) } as never,
      createMockEmbeddings(),
      promptBuilder
    );

    expect(result).toEqual([]);
  });

  test("passes formatted turn markers to prompt builder", async () => {
    const { extractMemories } = await import("@/algorithms/memory-extraction");

    let captured = "";
    const llm = {
      invoke: async () => ({
        text: JSON.stringify({
          extracted_memories: [{ summary: "x", reference: [0] }],
        }),
      }),
    };

    await extractMemories(
      createSessionHistory(),
      llm as never,
      createMockEmbeddings(),
      (dialogue) => {
        captured = dialogue;
        return dialogue;
      }
    );

    expect(captured).toContain("Turn 0");
    expect(captured).toContain("SPEAKER_1");
    expect(captured).toContain("SPEAKER_2");
  });
});
