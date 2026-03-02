import { describe, expect, test } from "bun:test";
import { Document } from "@langchain/core/documents";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { FakeToolCallingModel } from "langchain";
import {
  createOracleBaselineMiddleware,
  createRagMiddleware,
} from "@/evaluation/baselines";
import { createInMemoryVectorStore } from "@/tests/fixtures/in-memory-vector-store";
import { createMockEmbeddings } from "@/tests/helpers/mock-embeddings";

describe("baseline middleware", () => {
  test("RAG baseline retrieves memories in beforeModel", async () => {
    const embeddings = createMockEmbeddings(8);
    const vectorStore = createInMemoryVectorStore(embeddings);

    await vectorStore.addDocuments([
      new Document({
        pageContent: "session 0 memory",
        metadata: { sessionId: "session-0" },
      }),
      new Document({
        pageContent: "session 1 memory",
        metadata: { sessionId: "session-1" },
      }),
    ]);

    const middleware = createRagMiddleware({
      vectorStore,
      topK: 2,
      topM: 1,
    });

    const beforeModel = middleware.beforeModel;
    expect(beforeModel).toBeDefined();
    if (!beforeModel) {
      throw new Error("beforeModel hook missing");
    }

    const result =
      typeof beforeModel === "function"
        ? await beforeModel(
            { messages: [new HumanMessage("What do you remember?")] },
            { context: {} } as never
          )
        : await beforeModel.hook(
            { messages: [new HumanMessage("What do you remember?")] },
            { context: {} } as never
          );

    expect(result?._retrievedMemories?.length).toBe(2);
    expect(result?._retrievedMemories?.[0]?.sessionId).toBe("session-0");
  });

  test("RAG baseline wraps model call with memory context", async () => {
    const embeddings = createMockEmbeddings(8);
    const vectorStore = createInMemoryVectorStore(embeddings);

    const middleware = createRagMiddleware({
      vectorStore,
      topK: 2,
      topM: 1,
    });

    const wrapModelCall = middleware.wrapModelCall;
    expect(wrapModelCall).toBeDefined();
    if (!wrapModelCall) {
      throw new Error("wrapModelCall hook missing");
    }

    let seenMessageCount = 0;
    const response = await wrapModelCall(
      {
        model: new FakeToolCallingModel(),
        messages: [new HumanMessage("hello")],
        systemPrompt: "",
        systemMessage: new SystemMessage(""),
        tools: [],
        state: {
          messages: [new HumanMessage("hello")],
          _retrievedMemories: [
            {
              id: "m1",
              topicSummary: "User likes hiking",
              rawDialogue: "User likes hiking",
              timestamp: Date.now(),
              sessionId: "session-0",
              turnReferences: [],
              relevanceScore: 1,
            },
          ],
        },
        runtime: {
          context: {},
        },
      } as Parameters<typeof wrapModelCall>[0],
      (request) => {
        seenMessageCount = request.messages.length;
        return new AIMessage("ok");
      }
    );

    expect(seenMessageCount).toBe(2);
    if ("content" in response) {
      expect(response.content).toBe("ok");
    } else {
      throw new Error("Unexpected Command response from wrapModelCall");
    }
  });

  test("Oracle baseline middleware factory delegates to RAG baseline", () => {
    const embeddings = createMockEmbeddings(8);
    const vectorStore = createInMemoryVectorStore(embeddings);

    const middleware = createOracleBaselineMiddleware({
      vectorStore,
      topK: 20,
      topM: 5,
    });

    expect(middleware.beforeModel).toBeDefined();
    expect(middleware.wrapModelCall).toBeDefined();
  });
});
