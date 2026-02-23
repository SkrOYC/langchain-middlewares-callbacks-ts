/**
 * Agent-in-the-loop LongMemEval evaluator.
 */

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Document } from "@langchain/core/documents";
import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import { type BaseStore, InMemoryStore } from "@langchain/langgraph-checkpoint";
import { createAgent } from "langchain";
import { extractMemories } from "@/algorithms/memory-extraction";
import { processMemoryUpdate } from "@/algorithms/memory-update";
import {
  createOracleBaselineMiddleware,
  createRagMiddleware,
} from "@/evaluation/baselines";
import {
  createEvalProbeMiddleware,
  type EvalProbeEvent,
} from "@/evaluation/eval-probe-middleware";
import type { AnswerJudge } from "@/evaluation/judges";
import {
  computeMeanReciprocalRank,
  computeRecallAtK,
  computeSessionAccuracy,
} from "@/evaluation/metrics";
import { PersistentSimpleVectorStore } from "@/evaluation/persistent-simple-vector-store";
import { rmmMiddleware } from "@/index";
import { extractSpeaker1 } from "@/middleware/prompts/extract-speaker1";
import { extractSpeaker2 } from "@/middleware/prompts/extract-speaker2";
import { updateMemory } from "@/middleware/prompts/update-memory";
import type { LongMemEvalInstance } from "@/retrievers/oracle-retriever";
import { OracleVectorStore } from "@/retrievers/oracle-retriever";

export type AgentEvalMethod = "rmm" | "rag" | "oracle";
export type RetrievalMetricSource = "topm" | "topk";
type PrebuildFinalStage = "complete" | "fallback_raw" | "skipped" | "missing";

export interface AgentRunRecord {
  method: AgentEvalMethod;
  questionId: string;
  questionType: string;
  question: string;
  referenceAnswer: string;
  predictedAnswer: string;
  judgedCorrect: boolean;
  retrievedSessionIds: string[];
  retrievalSource?: RetrievalMetricSource;
  topKRetrievedSessionIds?: string[];
  topMRetrievedSessionIds?: string[];
  selectedMemoryIds?: string[];
  answerSessionIds: string[];
  recallAt5: number;
  sessionAccuracy?: number;
  mrr?: number;
  timestamp: string;
}

export interface AgentLongMemEvalResult {
  method: AgentEvalMethod;
  totalQuestions: number;
  skippedAbstentions: number;
  recallAt5: number;
  accuracy: number;
  sessionAccuracy: number;
  mrr: number;
}

export interface AgentLongMemEvalOutput {
  generatedAt: string;
  results: AgentLongMemEvalResult[];
  records: AgentRunRecord[];
  prebuildSummary?: AgentPrebuildSummary;
}

export interface AgentPrebuildSummary {
  required: boolean;
  totalTargets: number;
  complete: number;
  fallbackRaw: number;
  skipped: number;
  missing: number;
  coverage: number;
}

export interface AgentPrebuildEvent {
  timestamp: string;
  method: AgentEvalMethod;
  questionId: string;
  questionType: string;
  stage: "start" | "session" | "fallback_raw" | "complete" | "skipped";
  sessionsProcessed?: number;
  totalSessions?: number;
  extractedMemories?: number;
  storedMemories?: number;
  reason?: string;
}

interface VectorStoreFactoryOptions {
  prebuildTopicMemoryBank: boolean;
  includeSpeaker2: boolean;
  allowRawFallback?: boolean;
  maxPrebuildSessions?: number;
  reflectionModel?: BaseChatModel;
  onPrebuildEvent?: (event: AgentPrebuildEvent) => Promise<void> | void;
  method: AgentEvalMethod;
  persistentStoreBasePath?: string;
}

export interface AgentLongMemEvalEvaluatorConfig {
  dataset: LongMemEvalInstance[];
  judge: AnswerJudge;
  embeddings: Embeddings;
  modelFactory: (
    method: AgentEvalMethod,
    instance: LongMemEvalInstance
  ) => BaseChatModel;
  methods?: AgentEvalMethod[];
  topK?: number;
  topM?: number;
  embeddingDimension?: number;
  existingRecords?: AgentRunRecord[];
  onRecord?: (record: AgentRunRecord) => Promise<void> | void;
  onProgress?: (progress: AgentEvalProgress) => Promise<void> | void;
  storeFactory?: (method: AgentEvalMethod) => BaseStore;
  vectorStoreFactory?: (
    method: AgentEvalMethod,
    instance: LongMemEvalInstance,
    embeddings: Embeddings,
    options?: VectorStoreFactoryOptions
  ) => Promise<VectorStoreInterface>;
  onTraceEvent?: (event: EvalProbeEvent) => Promise<void> | void;
  prebuildTopicMemoryBank?: boolean;
  prebuildMethods?: AgentEvalMethod[];
  includeSpeaker2InPrebuild?: boolean;
  maxPrebuildSessions?: number;
  reflectionModelFactory?: (
    method: AgentEvalMethod,
    instance: LongMemEvalInstance
  ) => BaseChatModel;
  onPrebuildEvent?: (event: AgentPrebuildEvent) => Promise<void> | void;
  prebuildAllBeforeEvaluation?: boolean;
  vectorStoreCacheDir?: string;
  prebuildConcurrency?: number;
  evalConcurrency?: number;
  evaluationEnabled?: boolean;
  allowRawFallback?: boolean;
  requirePrebuildCompletion?: boolean;
  strictPrebuildCoverage?: number;
  retrievalMetricSource?: RetrievalMetricSource;
}

export interface AgentEvalProgress {
  method: AgentEvalMethod;
  processedQuestions: number;
  totalQuestions: number;
  skippedAbstentions: number;
}

interface ProbeContextState {
  selectedSessionIds: string[];
  selectedMemoryIds: string[];
  retrievedSessionIds: string[];
}

export class AgentLongMemEvalEvaluator {
  private readonly dataset: LongMemEvalInstance[];
  private readonly judge: AnswerJudge;
  private readonly embeddings: Embeddings;
  private readonly modelFactory: AgentLongMemEvalEvaluatorConfig["modelFactory"];
  private readonly methods: AgentEvalMethod[];
  private readonly topK: number;
  private readonly topM: number;
  private readonly embeddingDimension: number;
  private readonly existingRecords: AgentRunRecord[];
  private readonly onRecord?: (record: AgentRunRecord) => Promise<void> | void;
  private readonly onProgress?: (
    progress: AgentEvalProgress
  ) => Promise<void> | void;
  private readonly storeFactory: (method: AgentEvalMethod) => BaseStore;
  private readonly vectorStoreFactory: NonNullable<
    AgentLongMemEvalEvaluatorConfig["vectorStoreFactory"]
  >;
  private readonly onTraceEvent?: (
    event: EvalProbeEvent
  ) => Promise<void> | void;
  private readonly prebuildTopicMemoryBank: boolean;
  private readonly prebuildMethods: Set<AgentEvalMethod>;
  private readonly includeSpeaker2InPrebuild: boolean;
  private readonly maxPrebuildSessions?: number;
  private readonly reflectionModelFactory?: (
    method: AgentEvalMethod,
    instance: LongMemEvalInstance
  ) => BaseChatModel;
  private readonly onPrebuildEvent?: (
    event: AgentPrebuildEvent
  ) => Promise<void> | void;
  private readonly prebuildAllBeforeEvaluation: boolean;
  private readonly vectorStoreCacheDir?: string;
  private readonly prebuildConcurrency: number;
  private readonly evalConcurrency: number;
  private readonly evaluationEnabled: boolean;
  private readonly allowRawFallback: boolean;
  private readonly requirePrebuildCompletion: boolean;
  private readonly strictPrebuildCoverage: number;
  private readonly retrievalMetricSource: RetrievalMetricSource;

  constructor(config: AgentLongMemEvalEvaluatorConfig) {
    this.dataset = config.dataset;
    this.judge = config.judge;
    this.embeddings = config.embeddings;
    this.modelFactory = config.modelFactory;
    this.methods = config.methods ?? ["rmm", "rag", "oracle"];
    this.topK = config.topK ?? 20;
    this.topM = config.topM ?? 5;
    this.embeddingDimension = config.embeddingDimension ?? 1536;
    this.existingRecords = config.existingRecords ?? [];
    this.onRecord = config.onRecord;
    this.onProgress = config.onProgress;
    this.storeFactory = config.storeFactory ?? (() => new InMemoryStore());
    this.vectorStoreFactory =
      config.vectorStoreFactory ?? defaultVectorStoreFactory;
    this.onTraceEvent = config.onTraceEvent;
    this.prebuildTopicMemoryBank = config.prebuildTopicMemoryBank ?? true;
    this.prebuildMethods = new Set(config.prebuildMethods ?? ["rmm"]);
    this.includeSpeaker2InPrebuild = config.includeSpeaker2InPrebuild ?? true;
    this.maxPrebuildSessions = config.maxPrebuildSessions;
    this.reflectionModelFactory = config.reflectionModelFactory;
    this.onPrebuildEvent = config.onPrebuildEvent;
    this.prebuildAllBeforeEvaluation =
      config.prebuildAllBeforeEvaluation ?? true;
    this.vectorStoreCacheDir = config.vectorStoreCacheDir;
    this.prebuildConcurrency = normalizeConcurrency(config.prebuildConcurrency);
    this.evalConcurrency = normalizeConcurrency(config.evalConcurrency);
    this.evaluationEnabled = config.evaluationEnabled ?? true;
    this.allowRawFallback = config.allowRawFallback ?? true;
    this.requirePrebuildCompletion = config.requirePrebuildCompletion ?? false;
    this.strictPrebuildCoverage = normalizeCoverage(
      config.strictPrebuildCoverage
    );
    this.retrievalMetricSource = config.retrievalMetricSource ?? "topm";
  }

  async evaluate(): Promise<AgentLongMemEvalOutput> {
    const records: AgentRunRecord[] = [...this.existingRecords];
    const summaryMap = new Map<
      AgentEvalMethod,
      {
        totalQuestions: number;
        skippedAbstentions: number;
        recallAt5: number;
        accuracy: number;
        sessionAccuracy: number;
        mrr: number;
      }
    >();
    const abstentionCount = this.dataset.filter((instance) =>
      isAbstention(instance)
    ).length;
    const existingSummaryByMethod = seedSummaryByMethod(this.existingRecords);
    const processedKeys = new Set(
      this.existingRecords.map((record) =>
        buildRecordKey(record.method, record.questionId)
      )
    );
    const nonAbstentionDataset = this.dataset.filter(
      (instance) => !isAbstention(instance)
    );
    const prebuiltVectorStores = new Map<string, VectorStoreInterface>();
    const prebuiltRecordKeys = new Set<string>();
    const prebuildStatusByRecordKey = new Map<string, PrebuildFinalStage>();
    const retainPrebuiltStoresInMemory = !this.vectorStoreCacheDir;

    if (this.prebuildTopicMemoryBank && this.prebuildAllBeforeEvaluation) {
      for (const method of this.methods) {
        if (!this.shouldPrebuildForMethod(method)) {
          continue;
        }

        const prebuildTargets = nonAbstentionDataset.filter((instance) => {
          const recordKey = buildRecordKey(method, instance.question_id);
          return !(
            processedKeys.has(recordKey) || prebuiltVectorStores.has(recordKey)
          );
        });

        await runWithConcurrency(
          prebuildTargets,
          this.prebuildConcurrency,
          async (instance) => {
            const recordKey = buildRecordKey(method, instance.question_id);
            let finalStage: PrebuildFinalStage | null = null;
            const vectorStore = await this.createVectorStore(
              method,
              instance,
              true,
              {
                onPrebuildEvent: async (event) => {
                  if (
                    event.stage === "complete" ||
                    event.stage === "fallback_raw" ||
                    event.stage === "skipped"
                  ) {
                    finalStage = event.stage;
                  }
                  await this.onPrebuildEvent?.(event);
                },
              }
            );
            prebuiltRecordKeys.add(recordKey);
            prebuildStatusByRecordKey.set(recordKey, finalStage ?? "complete");
            if (retainPrebuiltStoresInMemory) {
              prebuiltVectorStores.set(recordKey, vectorStore);
            }
          }
        );
      }
    }

    if (this.requirePrebuildCompletion) {
      await this.ensurePrebuildCoverage(
        nonAbstentionDataset,
        prebuildStatusByRecordKey
      );
    }

    const prebuildSummary = computePrebuildSummary(
      this.methods,
      nonAbstentionDataset,
      prebuildStatusByRecordKey,
      (method) =>
        this.shouldPrebuildForMethod(method) &&
        (this.prebuildTopicMemoryBank || this.requirePrebuildCompletion)
    );
    if (
      this.requirePrebuildCompletion &&
      prebuildSummary.required &&
      prebuildSummary.coverage < this.strictPrebuildCoverage
    ) {
      throw new Error(
        `[agent-longmemeval] prebuild coverage ${(
          prebuildSummary.coverage * 100
        ).toFixed(2)}% is below strict threshold ${(
          this.strictPrebuildCoverage * 100
        ).toFixed(2)}%`
      );
    }

    if (!this.evaluationEnabled) {
      return {
        generatedAt: new Date().toISOString(),
        results: this.methods.map((method) => ({
          method,
          totalQuestions: 0,
          skippedAbstentions: abstentionCount,
          recallAt5: 0,
          accuracy: 0,
          sessionAccuracy: 0,
          mrr: 0,
        })),
        records,
        prebuildSummary,
      };
    }

    for (const method of this.methods) {
      const methodStore = this.storeFactory(method);
      const runtimeUserId = `longmemeval-${method}`;
      const totalQuestionsForMethod = nonAbstentionDataset.length;
      const seededSummary = existingSummaryByMethod.get(method) ?? {
        totalQuestions: 0,
        recallAt5: 0,
        accuracy: 0,
        sessionAccuracy: 0,
        mrr: 0,
      };
      let processedQuestionsForMethod = seededSummary.totalQuestions;

      summaryMap.set(method, {
        totalQuestions: seededSummary.totalQuestions,
        skippedAbstentions: abstentionCount,
        recallAt5: seededSummary.recallAt5,
        accuracy: seededSummary.accuracy,
        sessionAccuracy: seededSummary.sessionAccuracy,
        mrr: seededSummary.mrr,
      });
      await this.onProgress?.({
        method,
        processedQuestions: processedQuestionsForMethod,
        totalQuestions: totalQuestionsForMethod,
        skippedAbstentions: abstentionCount,
      });

      const evalTargets = nonAbstentionDataset.filter((instance) => {
        const recordKey = buildRecordKey(method, instance.question_id);
        return !processedKeys.has(recordKey);
      });

      await runWithConcurrency(
        evalTargets,
        this.evalConcurrency,
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This closure keeps each instance evaluation atomic for resume safety and consistent metric logging.
        async (instance) => {
          const summary = summaryMap.get(method);
          if (!summary) {
            return;
          }

          const recordKey = buildRecordKey(method, instance.question_id);
          if (processedKeys.has(recordKey)) {
            return;
          }

          const wasPrebuilt = prebuiltRecordKeys.has(recordKey);
          let finalStage: PrebuildFinalStage | null = null;
          const vectorStore =
            prebuiltVectorStores.get(recordKey) ??
            (await this.createVectorStore(
              method,
              instance,
              this.shouldPrebuildForMethod(method) &&
                !this.prebuildAllBeforeEvaluation &&
                !wasPrebuilt,
              {
                onPrebuildEvent: async (event) => {
                  if (
                    event.stage === "complete" ||
                    event.stage === "fallback_raw" ||
                    event.stage === "skipped"
                  ) {
                    finalStage = event.stage;
                  }
                  await this.onPrebuildEvent?.(event);
                },
              }
            ));
          if (finalStage) {
            prebuildStatusByRecordKey.set(recordKey, finalStage);
          }

          const topKRetrievedSessionIds = await collectRetrievedSessionIds(
            vectorStore,
            instance.question,
            this.topK
          );

          const probeContext = {
            selectedSessionIds: [] as string[],
            selectedMemoryIds: [] as string[],
            retrievedSessionIds: [] as string[],
          };
          const middleware = this.buildMiddleware(
            method,
            instance,
            vectorStore,
            async (event) => {
              this.updateProbeContext(probeContext, event);
              await this.onTraceEvent?.(event);
            }
          );
          const agent = createAgent({
            model: this.modelFactory(method, instance),
            tools: [],
            middleware,
            store: methodStore,
          });

          const response = (await agent.invoke(
            {
              messages: [new HumanMessage(instance.question)],
            },
            {
              store: methodStore,
              context:
                method === "rmm"
                  ? {
                      userId: runtimeUserId,
                      sessionId: runtimeUserId,
                    }
                  : undefined,
            }
          )) as {
            messages?: Array<{ content?: unknown }>;
          };

          const predictedAnswer = extractFinalText(response.messages ?? []);
          const topMRetrievedSessionIds =
            probeContext.selectedSessionIds.length > 0
              ? probeContext.selectedSessionIds
              : topKRetrievedSessionIds.slice(0, this.topM);
          const retrievedSessionIds =
            this.retrievalMetricSource === "topk"
              ? topKRetrievedSessionIds
              : topMRetrievedSessionIds;
          const recallAt5 = computeRecallAtK(
            retrievedSessionIds,
            instance.answer_session_ids,
            5
          );
          const sessionAccuracy = computeSessionAccuracy(
            retrievedSessionIds,
            instance.answer_session_ids
          );
          const mrr = computeMeanReciprocalRank(
            [retrievedSessionIds],
            [instance.answer_session_ids]
          );

          const decision = await this.judge.judge({
            question: instance.question,
            referenceAnswer: instance.answer,
            predictedAnswer,
          });

          summary.totalQuestions += 1;
          summary.recallAt5 += recallAt5;
          summary.sessionAccuracy += sessionAccuracy;
          summary.mrr += mrr;
          summary.accuracy += decision.correct ? 1 : 0;
          processedQuestionsForMethod += 1;

          const record: AgentRunRecord = {
            method,
            questionId: instance.question_id,
            questionType: instance.question_type,
            question: instance.question,
            referenceAnswer: instance.answer,
            predictedAnswer,
            judgedCorrect: decision.correct,
            retrievedSessionIds,
            retrievalSource: this.retrievalMetricSource,
            topKRetrievedSessionIds,
            topMRetrievedSessionIds,
            selectedMemoryIds: probeContext.selectedMemoryIds,
            answerSessionIds: [...instance.answer_session_ids],
            recallAt5,
            sessionAccuracy,
            mrr,
            timestamp: new Date().toISOString(),
          };

          records.push(record);
          processedKeys.add(recordKey);
          await this.onRecord?.(record);
          await this.onProgress?.({
            method,
            processedQuestions: processedQuestionsForMethod,
            totalQuestions: totalQuestionsForMethod,
            skippedAbstentions: summary.skippedAbstentions,
          });
        }
      );
    }

    const results: AgentLongMemEvalResult[] = this.methods.map((method) => {
      const summary = summaryMap.get(method);
      if (!summary || summary.totalQuestions === 0) {
        return {
          method,
          totalQuestions: 0,
          skippedAbstentions: summary?.skippedAbstentions ?? 0,
          recallAt5: 0,
          accuracy: 0,
          sessionAccuracy: 0,
          mrr: 0,
        };
      }

      return {
        method,
        totalQuestions: summary.totalQuestions,
        skippedAbstentions: summary.skippedAbstentions,
        recallAt5: summary.recallAt5 / summary.totalQuestions,
        accuracy: summary.accuracy / summary.totalQuestions,
        sessionAccuracy: summary.sessionAccuracy / summary.totalQuestions,
        mrr: summary.mrr / summary.totalQuestions,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      results,
      records,
      prebuildSummary,
    };
  }

  private shouldPrebuildForMethod(method: AgentEvalMethod): boolean {
    return this.prebuildMethods.has(method) && method !== "oracle";
  }

  private async ensurePrebuildCoverage(
    dataset: LongMemEvalInstance[],
    statusByRecordKey: Map<string, PrebuildFinalStage>
  ): Promise<void> {
    for (const method of this.methods) {
      if (!this.shouldPrebuildForMethod(method)) {
        continue;
      }
      for (const instance of dataset) {
        const recordKey = buildRecordKey(method, instance.question_id);
        if (statusByRecordKey.has(recordKey)) {
          continue;
        }
        const persistentStatus = await this.loadPersistentPrebuildStatus(
          method,
          instance
        );
        statusByRecordKey.set(recordKey, persistentStatus);
      }
    }
  }

  private async loadPersistentPrebuildStatus(
    method: AgentEvalMethod,
    instance: LongMemEvalInstance
  ): Promise<PrebuildFinalStage> {
    const basePath = this.buildPersistentStoreBasePath(method, instance);
    if (!basePath) {
      return "missing";
    }
    const persistentStore = await PersistentSimpleVectorStore.create({
      embeddings: this.embeddings,
      basePath,
    });
    const marker = persistentStore.getPrebuildMarker();
    if (marker && marker.storedMemories > 0) {
      return "complete";
    }
    if (persistentStore.hasDocuments()) {
      return "fallback_raw";
    }
    return "missing";
  }

  private createVectorStore(
    method: AgentEvalMethod,
    instance: LongMemEvalInstance,
    prebuildTopicMemoryBank: boolean,
    overrides?: {
      onPrebuildEvent?: (event: AgentPrebuildEvent) => Promise<void> | void;
    }
  ): Promise<VectorStoreInterface> {
    return this.vectorStoreFactory(method, instance, this.embeddings, {
      prebuildTopicMemoryBank,
      includeSpeaker2: this.includeSpeaker2InPrebuild,
      allowRawFallback: this.allowRawFallback,
      maxPrebuildSessions: this.maxPrebuildSessions,
      reflectionModel: this.reflectionModelFactory
        ? this.reflectionModelFactory(method, instance)
        : undefined,
      onPrebuildEvent: overrides?.onPrebuildEvent ?? this.onPrebuildEvent,
      method,
      persistentStoreBasePath: this.buildPersistentStoreBasePath(
        method,
        instance
      ),
    });
  }

  private buildPersistentStoreBasePath(
    method: AgentEvalMethod,
    instance: LongMemEvalInstance
  ): string | undefined {
    if (!this.vectorStoreCacheDir || method === "oracle") {
      return undefined;
    }
    const sanitizedQuestionId = sanitizePathComponent(instance.question_id);
    const hash = createHash("sha256")
      .update(instance.question_id)
      .digest("hex")
      .slice(0, 12);
    return resolve(
      this.vectorStoreCacheDir,
      method,
      `${sanitizedQuestionId}-${hash}`
    );
  }

  private buildMiddleware(
    method: AgentEvalMethod,
    instance: LongMemEvalInstance,
    vectorStore: VectorStoreInterface,
    onTraceEvent?: (event: EvalProbeEvent) => Promise<void> | void
  ) {
    const probe = createEvalProbeMiddleware({
      method,
      questionId: instance.question_id,
      questionType: instance.question_type,
      topM: this.topM,
      onEvent: onTraceEvent ?? this.onTraceEvent,
    });

    if (method === "rmm") {
      return [
        rmmMiddleware({
          enabled: true,
          vectorStore,
          embeddings: this.embeddings,
          embeddingDimension: this.embeddingDimension,
          topK: this.topK,
          topM: this.topM,
        }),
        probe,
      ];
    }

    if (method === "oracle") {
      return [
        createOracleBaselineMiddleware({
          vectorStore,
          topK: this.topK,
          topM: this.topM,
        }),
        probe,
      ];
    }

    return [
      createRagMiddleware({
        vectorStore,
        topK: this.topK,
        topM: this.topM,
      }),
      probe,
    ];
  }

  private updateProbeContext(
    probeContext: ProbeContextState,
    event: EvalProbeEvent
  ): void {
    if (event.event !== "model_request") {
      return;
    }

    if (
      Array.isArray(event.selectedSessionIds) &&
      event.selectedSessionIds.length > 0
    ) {
      probeContext.selectedSessionIds = dedupePreserveOrder(
        event.selectedSessionIds
      );
    }
    if (
      Array.isArray(event.selectedMemoryIds) &&
      event.selectedMemoryIds.length > 0
    ) {
      probeContext.selectedMemoryIds = dedupePreserveOrder(
        event.selectedMemoryIds
      );
    }
    if (
      Array.isArray(event.retrievedSessionIds) &&
      event.retrievedSessionIds.length > 0
    ) {
      probeContext.retrievedSessionIds = dedupePreserveOrder(
        event.retrievedSessionIds
      );
    }
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This factory mirrors paper-style prebuild state transitions and strict fallback rules.
async function defaultVectorStoreFactory(
  method: AgentEvalMethod,
  instance: LongMemEvalInstance,
  embeddings: Embeddings,
  options?: VectorStoreFactoryOptions
): Promise<VectorStoreInterface> {
  if (method === "oracle") {
    return new OracleVectorStore({
      annotations: [instance],
    }) as unknown as VectorStoreInterface;
  }

  const persistentStore = options?.persistentStoreBasePath
    ? await PersistentSimpleVectorStore.create({
        embeddings,
        basePath: options.persistentStoreBasePath,
      })
    : null;
  const vectorStore: VectorStoreInterface = persistentStore
    ? (persistentStore as unknown as VectorStoreInterface)
    : createSimpleInMemoryVectorStore(embeddings);
  const shouldPrebuild = options?.prebuildTopicMemoryBank ?? false;
  const allowRawFallback = options?.allowRawFallback ?? true;

  if (shouldPrebuild) {
    await options?.onPrebuildEvent?.({
      timestamp: new Date().toISOString(),
      method,
      questionId: instance.question_id,
      questionType: instance.question_type,
      stage: "start",
      totalSessions: instance.haystack_sessions.length,
    });

    const existingPrebuildMarker = persistentStore?.getPrebuildMarker();
    if (existingPrebuildMarker) {
      await options?.onPrebuildEvent?.({
        timestamp: new Date().toISOString(),
        method,
        questionId: instance.question_id,
        questionType: instance.question_type,
        stage: "complete",
        totalSessions: existingPrebuildMarker.totalSessions,
        sessionsProcessed: existingPrebuildMarker.sessionsProcessed,
        extractedMemories: existingPrebuildMarker.extractedMemories,
        storedMemories: existingPrebuildMarker.storedMemories,
      });
      return vectorStore;
    }

    const reflectionModel = options?.reflectionModel;
    if (reflectionModel) {
      const prebuildResult = await buildTopicMemoryBank({
        instance,
        vectorStore,
        embeddings,
        reflectionModel,
        includeSpeaker2: options?.includeSpeaker2 ?? true,
        maxPrebuildSessions: options?.maxPrebuildSessions,
        method,
        onPrebuildEvent: options?.onPrebuildEvent,
      });

      if (prebuildResult.storedMemories > 0) {
        if (persistentStore) {
          await persistentStore.markPrebuildComplete({
            schemaVersion: 1,
            method,
            questionId: instance.question_id,
            questionType: instance.question_type,
            totalSessions: instance.haystack_sessions.length,
            sessionsProcessed: prebuildResult.sessionsProcessed,
            extractedMemories: prebuildResult.extractedMemories,
            storedMemories: prebuildResult.storedMemories,
            completedAt: new Date().toISOString(),
          });
        }
        await options?.onPrebuildEvent?.({
          timestamp: new Date().toISOString(),
          method,
          questionId: instance.question_id,
          questionType: instance.question_type,
          stage: "complete",
          totalSessions: instance.haystack_sessions.length,
          sessionsProcessed: prebuildResult.sessionsProcessed,
          extractedMemories: prebuildResult.extractedMemories,
          storedMemories: prebuildResult.storedMemories,
        });
        return vectorStore;
      }

      await options?.onPrebuildEvent?.({
        timestamp: new Date().toISOString(),
        method,
        questionId: instance.question_id,
        questionType: instance.question_type,
        stage: "fallback_raw",
        totalSessions: instance.haystack_sessions.length,
        sessionsProcessed: prebuildResult.sessionsProcessed,
        extractedMemories: prebuildResult.extractedMemories,
        storedMemories: prebuildResult.storedMemories,
        reason: "no topic memories extracted; falling back to raw sessions",
      });
      if (!allowRawFallback) {
        throw new Error(
          `[agent-longmemeval] prebuild extracted zero topic memories for ${method}:${instance.question_id} and raw fallback is disabled`
        );
      }
    } else {
      await options?.onPrebuildEvent?.({
        timestamp: new Date().toISOString(),
        method,
        questionId: instance.question_id,
        questionType: instance.question_type,
        stage: "skipped",
        reason:
          "prebuild requested but no reflectionModelFactory configured; falling back to raw sessions",
      });
      if (!allowRawFallback) {
        throw new Error(
          `[agent-longmemeval] prebuild failed for ${method}:${instance.question_id} because reflection model is missing and raw fallback is disabled`
        );
      }
    }
  }

  if (persistentStore?.hasDocuments()) {
    return vectorStore;
  }

  const docs = buildRawSessionDocuments(instance);
  if (docs.length > 0) {
    await vectorStore.addDocuments(docs);
  }

  return vectorStore;
}

function buildRawSessionDocuments(instance: LongMemEvalInstance): Document[] {
  return instance.haystack_sessions.map((session, index) => {
    const pageContent = formatSessionPageContent(session);
    const sessionId = getSessionId(instance, index);

    return new Document({
      pageContent,
      metadata: {
        id: `${instance.question_id}-${sessionId}`,
        rawDialogue: pageContent,
        timestamp: Date.now(),
        sessionId,
        turnReferences: [],
        questionId: instance.question_id,
        relevanceScore: 1,
      },
    });
  });
}

async function buildTopicMemoryBank(input: {
  instance: LongMemEvalInstance;
  vectorStore: VectorStoreInterface;
  embeddings: Embeddings;
  reflectionModel: BaseChatModel;
  includeSpeaker2: boolean;
  maxPrebuildSessions?: number;
  method: AgentEvalMethod;
  onPrebuildEvent?: (event: AgentPrebuildEvent) => Promise<void> | void;
}): Promise<{
  sessionsProcessed: number;
  extractedMemories: number;
  storedMemories: number;
}> {
  const {
    instance,
    vectorStore,
    embeddings,
    reflectionModel,
    includeSpeaker2,
    maxPrebuildSessions,
    method,
    onPrebuildEvent,
  } = input;

  let sessionsProcessed = 0;
  let extractedMemories = 0;
  let storedMemories = 0;

  const totalSessions = instance.haystack_sessions.length;
  const sessionLimit =
    typeof maxPrebuildSessions === "number" && maxPrebuildSessions > 0
      ? Math.min(totalSessions, maxPrebuildSessions)
      : totalSessions;

  for (let index = 0; index < sessionLimit; index++) {
    const session = instance.haystack_sessions[index];
    if (!session) {
      continue;
    }

    const sessionId = getSessionId(instance, index);
    const sessionHistory = sessionTurnsToMessages(session);
    sessionsProcessed += 1;

    const speaker1Memories = await extractMemories(
      sessionHistory,
      reflectionModel,
      embeddings,
      extractSpeaker1,
      sessionId
    );
    const speaker2Memories = includeSpeaker2
      ? await extractMemories(
          sessionHistory,
          reflectionModel,
          embeddings,
          extractSpeaker2,
          sessionId
        )
      : [];

    const extracted = [
      ...(speaker1Memories ?? []),
      ...(speaker2Memories ?? []),
    ];
    extractedMemories += extracted.length;

    for (const memory of extracted) {
      await processMemoryUpdate(
        memory,
        vectorStore,
        reflectionModel,
        updateMemory
      );
      storedMemories += 1;
    }

    await onPrebuildEvent?.({
      timestamp: new Date().toISOString(),
      method,
      questionId: instance.question_id,
      questionType: instance.question_type,
      stage: "session",
      sessionsProcessed,
      totalSessions: sessionLimit,
      extractedMemories,
      storedMemories,
    });
  }

  return {
    sessionsProcessed,
    extractedMemories,
    storedMemories,
  };
}

function sessionTurnsToMessages(
  session: LongMemEvalInstance["haystack_sessions"][number]
): BaseMessage[] {
  const messages: BaseMessage[] = [];

  for (const turn of session) {
    if (turn.role === "assistant") {
      messages.push(new AIMessage(turn.content));
      continue;
    }
    messages.push(new HumanMessage(turn.content));
  }

  return messages;
}

function formatSessionPageContent(
  session: LongMemEvalInstance["haystack_sessions"][number]
): string {
  return session.map((turn) => `${turn.role}: ${turn.content}`).join("\n");
}

function getSessionId(instance: LongMemEvalInstance, index: number): string {
  return instance.haystack_session_ids?.[index] ?? `session-${index}`;
}

function createSimpleInMemoryVectorStore(
  embeddings: Embeddings
): VectorStoreInterface {
  const entries: Array<{ doc: Document; vector: number[] }> = [];

  return {
    embeddings,
    async addDocuments(documents: Document[]): Promise<string[]> {
      if (documents.length === 0) {
        return [];
      }

      const vectors = await embeddings.embedDocuments(
        documents.map((doc) => doc.pageContent)
      );

      const ids: string[] = [];
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const vector = vectors[i];
        if (doc && vector) {
          entries.push({ doc, vector });
          ids.push(`doc-${entries.length - 1}`);
        }
      }

      return ids;
    },
    async similaritySearch(query: string, k = 4): Promise<Document[]> {
      if (entries.length === 0 || k <= 0) {
        return [];
      }

      const queryVector = await embeddings.embedQuery(query);
      const ranked = entries
        .map(({ doc, vector }) => ({
          doc,
          score: cosineSimilarity(queryVector, vector),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map((entry) => entry.doc);

      return ranked;
    },
  } as unknown as VectorStoreInterface;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / Math.sqrt(normA * normB);
}

function extractFinalText(messages: Array<{ content?: unknown }>): string {
  if (messages.length === 0) {
    return "";
  }

  const finalMessage = messages.at(-1);
  const content = finalMessage?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (
          typeof part === "object" &&
          part !== null &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function buildRecordKey(method: AgentEvalMethod, questionId: string): string {
  return `${method}::${questionId}`;
}

async function collectRetrievedSessionIds(
  vectorStore: VectorStoreInterface,
  query: string,
  k: number
): Promise<string[]> {
  try {
    const docs = await vectorStore.similaritySearch(query, k);
    const sessionIds = docs
      .map((doc) => doc.metadata?.sessionId)
      .filter((id): id is string => typeof id === "string");

    return dedupePreserveOrder(sessionIds);
  } catch {
    return [];
  }
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      output.push(value);
    }
  }

  return output;
}

function normalizeConcurrency(value: number | undefined): number {
  if (!(Number.isFinite(value) && value) || value < 1) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeCoverage(value: number | undefined): number {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return 1;
  }
  const numeric = value ?? 1;
  if (numeric <= 0) {
    return 0;
  }
  if (numeric >= 1) {
    return 1;
  }
  return numeric;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  const workerCount = Math.min(items.length, normalizeConcurrency(concurrency));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];
      if (!item) {
        continue;
      }
      await worker(item, currentIndex);
    }
  });

  await Promise.all(workers);
}

function sanitizePathComponent(value: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized.length === 0) {
    return "question";
  }
  return normalized.slice(0, 64);
}

function computePrebuildSummary(
  methods: AgentEvalMethod[],
  dataset: LongMemEvalInstance[],
  statusByRecordKey: Map<string, PrebuildFinalStage>,
  shouldPrebuildForMethod: (method: AgentEvalMethod) => boolean
): AgentPrebuildSummary {
  let totalTargets = 0;
  let complete = 0;
  let fallbackRaw = 0;
  let skipped = 0;
  let missing = 0;

  for (const method of methods) {
    if (!shouldPrebuildForMethod(method)) {
      continue;
    }
    for (const instance of dataset) {
      totalTargets += 1;
      const status =
        statusByRecordKey.get(buildRecordKey(method, instance.question_id)) ??
        "missing";
      if (status === "complete") {
        complete += 1;
        continue;
      }
      if (status === "fallback_raw") {
        fallbackRaw += 1;
        continue;
      }
      if (status === "skipped") {
        skipped += 1;
        continue;
      }
      missing += 1;
    }
  }

  const coverage = totalTargets > 0 ? complete / totalTargets : 1;
  return {
    required: totalTargets > 0,
    totalTargets,
    complete,
    fallbackRaw,
    skipped,
    missing,
    coverage,
  };
}

function seedSummaryByMethod(records: AgentRunRecord[]): Map<
  AgentEvalMethod,
  {
    totalQuestions: number;
    recallAt5: number;
    accuracy: number;
    sessionAccuracy: number;
    mrr: number;
  }
> {
  const summary = new Map<
    AgentEvalMethod,
    {
      totalQuestions: number;
      recallAt5: number;
      accuracy: number;
      sessionAccuracy: number;
      mrr: number;
    }
  >();

  for (const record of records) {
    const current = summary.get(record.method) ?? {
      totalQuestions: 0,
      recallAt5: 0,
      accuracy: 0,
      sessionAccuracy: 0,
      mrr: 0,
    };

    const sessionAccuracy =
      typeof record.sessionAccuracy === "number"
        ? record.sessionAccuracy
        : computeSessionAccuracy(
            record.retrievedSessionIds,
            record.answerSessionIds
          );
    const mrr =
      typeof record.mrr === "number"
        ? record.mrr
        : computeMeanReciprocalRank(
            [record.retrievedSessionIds],
            [record.answerSessionIds]
          );

    current.totalQuestions += 1;
    current.recallAt5 += record.recallAt5;
    current.sessionAccuracy += sessionAccuracy;
    current.mrr += mrr;
    current.accuracy += record.judgedCorrect ? 1 : 0;

    summary.set(record.method, current);
  }

  return summary;
}

function isAbstention(instance: LongMemEvalInstance): boolean {
  return (
    instance.question_id.endsWith("_abs") ||
    instance.question_type.endsWith("_abs") ||
    instance.answer_session_ids.length === 0
  );
}
