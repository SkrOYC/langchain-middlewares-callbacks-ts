import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Document } from "@langchain/core/documents";
import { FakeToolCallingModel } from "langchain";
import {
  type AgentEvalMethod,
  AgentLongMemEvalEvaluator,
} from "@/evaluation/agent-longmemeval-evaluator";
import { createMockJudge } from "@/evaluation/judges";
import { PersistentSimpleVectorStore } from "@/evaluation/persistent-simple-vector-store";
import type { LongMemEvalInstance } from "@/retrievers/oracle-retriever";
import { createMockEmbeddings } from "@/tests/helpers/mock-embeddings";

function createDataset(): LongMemEvalInstance[] {
  return [
    {
      question_id: "q1",
      question_type: "single-session-user",
      question: "What sport does the user like?",
      answer: "Hiking",
      answer_session_ids: ["session-0"],
      haystack_sessions: [
        [
          { role: "user", content: "I love hiking" },
          { role: "assistant", content: "Great choice" },
        ],
        [{ role: "user", content: "I also enjoy chess" }],
      ],
    },
    {
      question_id: "q2_abs",
      question_type: "multi-session",
      question: "What is unknown?",
      answer: "Unknown",
      answer_session_ids: [],
      haystack_sessions: [],
    },
  ];
}

describe("AgentLongMemEvalEvaluator", () => {
  test("runs RMM, RAG, and Oracle methods through createAgent", async () => {
    const dataset = createDataset();
    const methods: AgentEvalMethod[] = ["rmm", "rag", "oracle"];

    const evaluator = new AgentLongMemEvalEvaluator({
      dataset,
      methods,
      judge: createMockJudge(() => true),
      embeddings: createMockEmbeddings(1536),
      embeddingDimension: 1536,
      topK: 1,
      topM: 1,
      modelFactory: () => new FakeToolCallingModel(),
    });

    const output = await evaluator.evaluate();

    expect(output.results).toHaveLength(3);
    expect(output.records).toHaveLength(3);

    for (const result of output.results) {
      expect(result.totalQuestions).toBe(1);
      expect(result.skippedAbstentions).toBe(1);
      expect(result.accuracy).toBe(1);
      expect(result.recallAt5).toBeGreaterThanOrEqual(0);
      expect(result.recallAt5).toBeLessThanOrEqual(1);
      expect(result.ndcgAt5).toBeGreaterThanOrEqual(0);
      expect(result.ndcgAt5).toBeLessThanOrEqual(1);
    }
  });

  test("prebuilds topic memory bank before retrieval when enabled", async () => {
    const dataset: LongMemEvalInstance[] = [
      {
        question_id: "q-prebuild",
        question_type: "single-session-user",
        question: "What does the user like?",
        answer: "Hiking",
        answer_session_ids: ["answer-session"],
        haystack_session_ids: ["answer-session"],
        haystack_sessions: [
          [
            { role: "user", content: "I love hiking on weekends." },
            { role: "assistant", content: "Nice hobby." },
          ],
        ],
      },
    ];

    let extractInvocations = 0;
    const reflectionModel = {
      invoke: () => {
        extractInvocations += 1;
        return Promise.resolve({
          text: JSON.stringify({
            extracted_memories: [
              {
                summary: "SPEAKER_1 loves hiking on weekends.",
                reference: [0],
              },
            ],
          }),
        });
      },
    };

    const evaluator = new AgentLongMemEvalEvaluator({
      dataset,
      methods: ["rmm"],
      judge: createMockJudge(() => true),
      embeddings: createMockEmbeddings(1536),
      embeddingDimension: 1536,
      topK: 1,
      topM: 1,
      modelFactory: () => new FakeToolCallingModel(),
      reflectionModelFactory: () => reflectionModel as never,
      prebuildTopicMemoryBank: true,
      prebuildMethods: ["rmm"],
      includeSpeaker2InPrebuild: false,
    });

    const output = await evaluator.evaluate();

    expect(extractInvocations).toBeGreaterThan(0);
    expect(output.records).toHaveLength(1);
    expect(output.records[0]?.retrievedSessionIds).toEqual(["answer-session"]);
  });

  test("runs full prebuild phase before evaluation when enabled", async () => {
    const dataset: LongMemEvalInstance[] = [
      {
        question_id: "q-prebuild-1",
        question_type: "single-session-user",
        question: "What does the user like?",
        answer: "Hiking",
        answer_session_ids: ["session-a"],
        haystack_session_ids: ["session-a"],
        haystack_sessions: [
          [
            { role: "user", content: "I love hiking." },
            { role: "assistant", content: "Great." },
          ],
        ],
      },
      {
        question_id: "q-prebuild-2",
        question_type: "single-session-user",
        question: "What meal did they mention?",
        answer: "Pasta",
        answer_session_ids: ["session-b"],
        haystack_session_ids: ["session-b"],
        haystack_sessions: [
          [
            { role: "user", content: "I made pasta yesterday." },
            { role: "assistant", content: "Nice." },
          ],
        ],
      },
    ];

    const callOrder: string[] = [];

    const evaluator = new AgentLongMemEvalEvaluator({
      dataset,
      methods: ["rmm"],
      judge: createMockJudge(() => true),
      embeddings: createMockEmbeddings(128),
      embeddingDimension: 128,
      topK: 1,
      topM: 1,
      modelFactory: () => new FakeToolCallingModel(),
      reflectionModelFactory: () =>
        ({
          invoke: () =>
            Promise.resolve({
              text: "NO_TRAIT",
              content: "NO_TRAIT",
            }),
        }) as never,
      vectorStoreFactory: (_method, instance, embeddings, options) => {
        callOrder.push(
          `${instance.question_id}:${
            options?.prebuildTopicMemoryBank ? "prebuild" : "eval"
          }`
        );
        const sessionId = instance.answer_session_ids[0] ?? "session-0";
        const store = {
          embeddings,
          addDocuments: () => Promise.resolve([]),
          similaritySearch: () =>
            Promise.resolve([
              new Document({
                pageContent: "memory",
                metadata: {
                  id: `${instance.question_id}-${sessionId}`,
                  sessionId,
                  topicSummary: "memory",
                  rawDialogue: "memory",
                  timestamp: Date.now(),
                  turnReferences: [],
                  relevanceScore: 1,
                },
              }),
            ]),
        } as never;
        return Promise.resolve(store);
      },
      prebuildTopicMemoryBank: true,
      prebuildMethods: ["rmm"],
      includeSpeaker2InPrebuild: false,
      onRecord: (record) => {
        callOrder.push(`record:${record.questionId}`);
      },
    });

    await evaluator.evaluate();

    expect(callOrder).toEqual([
      "q-prebuild-1:prebuild",
      "q-prebuild-2:prebuild",
      "record:q-prebuild-1",
      "record:q-prebuild-2",
    ]);
  });

  test("fails strict eval when prebuild coverage is incomplete", async () => {
    const dataset: LongMemEvalInstance[] = [
      {
        question_id: "q-coverage",
        question_type: "single-session-user",
        question: "What does the user like?",
        answer: "Hiking",
        answer_session_ids: ["session-a"],
        haystack_session_ids: ["session-a"],
        haystack_sessions: [
          [
            { role: "user", content: "I like hiking." },
            { role: "assistant", content: "Great." },
          ],
        ],
      },
    ];

    const embeddings = createMockEmbeddings(128);
    const cacheDir = await mkdtemp(resolve(tmpdir(), "rmm-prebuild-coverage-"));
    const firstInstance = dataset[0];
    if (!firstInstance) {
      throw new Error("Expected at least one dataset row");
    }

    try {
      const basePath = resolve(
        cacheDir,
        "rmm",
        `${sanitizePathComponent(firstInstance.question_id)}-${hashQuestionId(
          firstInstance.question_id
        )}`
      );

      const store = await PersistentSimpleVectorStore.create({
        embeddings,
        basePath,
      });
      await store.addDocuments([
        new Document({
          pageContent: "raw fallback memory",
          metadata: {
            id: "doc-fallback",
            sessionId: "session-a",
            topicSummary: "fallback",
            rawDialogue: "fallback",
            timestamp: Date.now(),
            turnReferences: [],
            relevanceScore: 1,
          },
        }),
      ]);

      const evaluator = new AgentLongMemEvalEvaluator({
        dataset,
        methods: ["rmm"],
        judge: createMockJudge(() => true),
        embeddings,
        embeddingDimension: 128,
        topK: 1,
        topM: 1,
        modelFactory: () => new FakeToolCallingModel(),
        prebuildTopicMemoryBank: false,
        vectorStoreCacheDir: cacheDir,
        evaluationEnabled: false,
        requirePrebuildCompletion: true,
        strictPrebuildCoverage: 1,
      });

      await expect(evaluator.evaluate()).rejects.toThrow("prebuild coverage");
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test("uses Top-M retrieval IDs for metrics", async () => {
    const dataset: LongMemEvalInstance[] = [
      {
        question_id: "q-topm",
        question_type: "single-session-user",
        question: "What does the user prefer?",
        answer: "Session B",
        answer_session_ids: ["session-b"],
        haystack_session_ids: ["session-a", "session-b"],
        haystack_sessions: [
          [{ role: "user", content: "Session A detail." }],
          [{ role: "user", content: "Session B detail." }],
        ],
      },
    ];

    const makeVectorStore = () =>
      ({
        embeddings: createMockEmbeddings(128),
        addDocuments: () => Promise.resolve([]),
        similaritySearch: (_query: string, k = 4) => {
          const docs = [
            new Document({
              pageContent: "Memory A",
              metadata: {
                id: "m1",
                sessionId: "session-a",
                topicSummary: "A",
                rawDialogue: "A",
                timestamp: Date.now(),
                turnReferences: [],
                relevanceScore: 0.9,
              },
            }),
            new Document({
              pageContent: "Memory B",
              metadata: {
                id: "m2",
                sessionId: "session-b",
                topicSummary: "B",
                rawDialogue: "B",
                timestamp: Date.now(),
                turnReferences: [],
                relevanceScore: 0.8,
              },
            }),
          ];
          return Promise.resolve(docs.slice(0, k));
        },
      }) as never;

    const evaluatorTopM = new AgentLongMemEvalEvaluator({
      dataset,
      methods: ["rag"],
      judge: createMockJudge(() => true),
      embeddings: createMockEmbeddings(128),
      embeddingDimension: 128,
      topK: 2,
      topM: 1,
      modelFactory: () => new FakeToolCallingModel(),
      vectorStoreFactory: () => Promise.resolve(makeVectorStore()),
      prebuildTopicMemoryBank: false,
    });

    const outputTopM = await evaluatorTopM.evaluate();
    expect(outputTopM.records).toHaveLength(1);
    const recordTopM = outputTopM.records[0];
    if (!recordTopM) {
      throw new Error("Expected one Top-M record");
    }
    expect(recordTopM.topKRetrievedSessionIds).toEqual([
      "session-a",
      "session-b",
    ]);
    expect(recordTopM.topMRetrievedSessionIds).toEqual(["session-a"]);
    expect(recordTopM.retrievedSessionIds).toEqual(["session-a"]);
    expect(recordTopM.retrievalSource).toBe("topm");
    expect(recordTopM.recallAt5).toBe(0);
  });
});

function sanitizePathComponent(value: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized.length === 0) {
    return "question";
  }
  return normalized.slice(0, 64);
}

function hashQuestionId(questionId: string): string {
  return createHash("sha256").update(questionId).digest("hex").slice(0, 12);
}
