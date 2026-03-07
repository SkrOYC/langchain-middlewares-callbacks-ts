#!/usr/bin/env bun

import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AsyncCaller } from "@langchain/core/utils/async_caller";
import { FakeToolCallingModel } from "langchain";
import {
  type AgentEvalMethod,
  type AgentEvalProgress,
  AgentLongMemEvalEvaluator,
  type AgentPrebuildEvent,
  type AgentRunRecord,
} from "../src/evaluation/agent-longmemeval-evaluator";
import { loadLongMemEvalDataset } from "../src/evaluation/dataset-loader";
import type { EvalProbeEvent } from "../src/evaluation/eval-probe-middleware";
import {
  type AnswerJudge,
  createExactMatchJudge,
  createPromptJudge,
  type PromptJudgeRunner,
} from "../src/evaluation/judges";
import {
  CachedChatModelStore,
  wrapModelWithInvokeCache,
} from "./utils/cached-chat-model";
import { CachedEmbeddings } from "./utils/cached-embeddings";
import {
  SharedRateLimitCoordinator,
  wrapModelWithRateLimitRetry,
} from "./utils/rate-limit-retry-model";

const NO_CITE_TAG_REGEX = /\[NO_CITE\]/i;
const DEFAULT_LONGMEMEVAL_DATASET =
  "./data/longmemeval/longmemeval_s_cleaned.json";
const DEFAULT_LONGMEMEVAL_OUT_DIR = "./artifacts/longmemeval-s-gemma";
const DEFAULT_LONGMEMEVAL_CONFIG = {
  allowRawFallback: false,
  embeddingCache: true,
  embeddingCachePath: "./data/longmemeval/cache/embeddings",
  embeddingDimension: 384,
  embeddingsAdapter: "./scripts/adapters/huggingface-embeddings-adapter.ts",
  evalConcurrency: 20,
  methods: "rmm",
  mode: "all",
  modelAdapter: "./scripts/adapters/google-gemma-model-adapter.ts",
  paperStrict: true,
  prebuildAllBeforeEvaluation: true,
  prebuildConcurrency: 20,
  prebuildMethods: "rmm",
  prebuildSpeaker2: false,
  prebuildTopicBank: true,
  prebuildZeroMemoryRetries: 2,
  reflectionCache: true,
  reflectionCachePath: "./data/longmemeval/cache/reflection-cache.jsonl",
  reflectionModelAdapter: "./scripts/adapters/google-gemma-model-adapter.ts",
  requirePrebuild: true,
  resume: true,
  retrievalMetricSource: "topm",
  saveArtifacts: true,
  strictPrebuildCoverage: 1,
  vectorStoreCache: true,
  vectorStoreCacheDir: "./data/longmemeval/cache/vector-stores.s1only.c20",
} as const;

interface CliArgs {
  mode: "prebuild" | "eval" | "all";
  paperStrict: boolean;
  dataset?: string;
  methods: AgentEvalMethod[];
  outDir: string;
  saveArtifacts: boolean;
  topK: number;
  topM: number;
  embeddingDimension: number;
  modelAdapter?: string;
  judgeAdapter?: string;
  embeddingsAdapter?: string;
  embeddingCache: boolean;
  embeddingCachePath: string;
  embeddingCacheNamespace: string;
  resume: boolean;
  logFile: string;
  prebuildTopicMemoryBank: boolean;
  prebuildMethods: AgentEvalMethod[];
  includeSpeaker2InPrebuild: boolean;
  prebuildMaxSessions?: number;
  reflectionModelAdapter?: string;
  reflectionCache: boolean;
  reflectionCachePath: string;
  prebuildAllBeforeEvaluation: boolean;
  vectorStoreCache: boolean;
  vectorStoreCacheDir: string;
  prebuildConcurrency: number;
  evalConcurrency: number;
  requirePrebuild: boolean;
  allowRawFallback: boolean;
  strictPrebuildCoverage: number;
  retrievalMetricSource: "topm" | "topk";
  prebuildZeroMemoryRetries: number;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Main orchestrates full run lifecycle with explicit, ordered steps for traceability and resumability.
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.dataset) {
    throw new Error("Missing required --dataset argument");
  }
  const datasetPath = resolve(args.dataset);

  const dataset = await loadLongMemEvalDataset(args.dataset);
  const baseModelFactory = await loadModelFactory(args.modelAdapter);
  const baseReflectionModelFactory = await resolveReflectionModelFactory(
    args,
    baseModelFactory
  );
  const reflectionCache = args.reflectionCache
    ? await CachedChatModelStore.create({
        cachePath: args.reflectionCachePath,
      })
    : null;
  const judge = await loadJudge(args.judgeAdapter);
  const rawEmbeddings = await loadEmbeddings(
    args.embeddingsAdapter,
    args.embeddingDimension
  );

  let embeddings: Embeddings = rawEmbeddings;
  let embeddingCache: CachedEmbeddings | null = null;
  if (args.embeddingCache) {
    embeddingCache = await CachedEmbeddings.create(rawEmbeddings, {
      cachePath: args.embeddingCachePath,
      namespace: args.embeddingCacheNamespace,
    });
    embeddings = embeddingCache;
    const paths = embeddingCache.getPaths();
    console.log(
      `[agent-longmemeval] embeddings cache enabled: ${paths.dataPath} / ${paths.indexPath}`
    );
  }

  let recordsHandle: Awaited<ReturnType<typeof open>> | null = null;
  let logHandle: Awaited<ReturnType<typeof open>> | null = null;
  const progressByMethod = new Map<
    AgentEvalMethod,
    {
      processedQuestions: number;
      totalQuestions: number;
      skippedAbstentions: number;
    }
  >();
  const citationStatsByMethod = new Map<
    AgentEvalMethod,
    { total: number; noCite: number }
  >();
  let lastProgressWrite = 0;
  const recordsPath = resolve(args.outDir, "records.jsonl");
  let existingRecords: AgentRunRecord[] = [];
  const totalNonAbstentionQuestions = dataset.filter(
    (row) =>
      !(
        row.question_id.endsWith("_abs") ||
        row.question_type.endsWith("_abs") ||
        row.answer_session_ids.length === 0
      )
  ).length;

  const writeLog = async (entry: Record<string, unknown>): Promise<void> => {
    if (!logHandle) {
      return;
    }
    const line = `${JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
    })}\n`;
    await logHandle.write(line);
  };

  const rateLimitCoordinator = new SharedRateLimitCoordinator({
    onEvent: async (event) => {
      await writeLog({
        event: "rate_limit_retry",
        details: event,
      });
    },
  });
  const modelFactory = (
    method: AgentEvalMethod,
    instance: (typeof dataset)[number]
  ): BaseChatModel =>
    wrapModelWithRateLimitRetry(baseModelFactory(method), {
      coordinator: rateLimitCoordinator,
      scope: `generation:${method}:${instance.question_id}`,
    });

  let reflectionModelFactoryWithCache:
    | ((
        method: AgentEvalMethod,
        instance: (typeof dataset)[number]
      ) => BaseChatModel)
    | undefined;
  if (baseReflectionModelFactory && reflectionCache) {
    reflectionModelFactoryWithCache = (
      method: AgentEvalMethod,
      instance: (typeof dataset)[number]
    ): BaseChatModel =>
      wrapModelWithInvokeCache(
        wrapModelWithRateLimitRetry(baseReflectionModelFactory(method), {
          coordinator: rateLimitCoordinator,
          scope: `reflection:${method}:${instance.question_id}`,
        }),
        {
          cache: reflectionCache,
          namespace: [
            "longmemeval-reflection",
            method,
            args.reflectionModelAdapter ?? args.modelAdapter ?? "default",
          ].join("|"),
          emptyResponseRetryCount: 1,
          onEvent: async (event) => {
            await writeLog({
              event: "reflection_cache",
              details: {
                method,
                questionId: instance.question_id,
                questionType: instance.question_type,
                ...event,
              },
            });
          },
        }
      );
  } else if (baseReflectionModelFactory) {
    reflectionModelFactoryWithCache = (
      method: AgentEvalMethod,
      instance: (typeof dataset)[number]
    ): BaseChatModel =>
      wrapModelWithRateLimitRetry(baseReflectionModelFactory(method), {
        coordinator: rateLimitCoordinator,
        scope: `reflection:${method}:${instance.question_id}`,
      });
  }

  const writeProgressSnapshot = async (force = false): Promise<void> => {
    if (!args.saveArtifacts) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastProgressWrite < 1500) {
      return;
    }

    const progressPath = resolve(args.outDir, "progress.json");
    const perMethod: Record<string, unknown> = {};
    for (const method of args.methods) {
      perMethod[method] = progressByMethod.get(method) ?? {
        processedQuestions: 0,
        totalQuestions: 0,
        skippedAbstentions: 0,
      };
    }

    await writeFile(
      progressPath,
      `${JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          datasetPath,
          methods: args.methods,
          perMethod,
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    lastProgressWrite = now;
  };

  const writeRunManifest = async (): Promise<void> => {
    if (!args.saveArtifacts) {
      return;
    }
    const manifestPath = resolve(args.outDir, "run-manifest.json");
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          datasetPath,
          mode: args.mode,
          paperStrict: args.paperStrict,
          methods: args.methods,
          topK: args.topK,
          topM: args.topM,
          embeddingDimension: args.embeddingDimension,
          requirePrebuild: args.requirePrebuild,
          allowRawFallback: args.allowRawFallback,
          strictPrebuildCoverage: args.strictPrebuildCoverage,
          retrievalMetricSource: args.retrievalMetricSource,
          prebuildZeroMemoryRetries: args.prebuildZeroMemoryRetries,
          prebuildTopicMemoryBank: args.prebuildTopicMemoryBank,
          prebuildMethods: args.prebuildMethods,
          includeSpeaker2InPrebuild: args.includeSpeaker2InPrebuild,
          prebuildAllBeforeEvaluation: args.prebuildAllBeforeEvaluation,
          prebuildConcurrency: args.prebuildConcurrency,
          evalConcurrency: args.evalConcurrency,
          vectorStoreCache: args.vectorStoreCache,
          vectorStoreCacheDir: args.vectorStoreCacheDir,
          reflectionCache: args.reflectionCache,
          reflectionCachePath: args.reflectionCachePath,
          resume: args.resume,
          outDir: args.outDir,
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  };

  try {
    if (args.saveArtifacts) {
      await mkdir(args.outDir, { recursive: true });
    }
    await mkdir(dirname(args.logFile), { recursive: true });
    logHandle = await open(args.logFile, args.resume ? "a" : "w");
    await writeLog({
      event: "run_start",
      mode: args.mode,
      paperStrict: args.paperStrict,
      datasetPath,
      methods: args.methods,
      topK: args.topK,
      topM: args.topM,
      embeddingDimension: args.embeddingDimension,
      resume: args.resume,
      prebuildTopicMemoryBank: args.prebuildTopicMemoryBank,
      prebuildMethods: args.prebuildMethods,
      includeSpeaker2InPrebuild: args.includeSpeaker2InPrebuild,
      prebuildMaxSessions: args.prebuildMaxSessions ?? null,
      reflectionModelAdapter:
        args.reflectionModelAdapter ?? args.modelAdapter ?? null,
      reflectionCache: args.reflectionCache,
      reflectionCachePath: args.reflectionCachePath,
      prebuildAllBeforeEvaluation: args.prebuildAllBeforeEvaluation,
      vectorStoreCache: args.vectorStoreCache,
      vectorStoreCacheDir: args.vectorStoreCacheDir,
      prebuildConcurrency: args.prebuildConcurrency,
      evalConcurrency: args.evalConcurrency,
      requirePrebuild: args.requirePrebuild,
      allowRawFallback: args.allowRawFallback,
      strictPrebuildCoverage: args.strictPrebuildCoverage,
      retrievalMetricSource: args.retrievalMetricSource,
      prebuildZeroMemoryRetries: args.prebuildZeroMemoryRetries,
    });
    await writeRunManifest();

    if (reflectionCache) {
      console.log(
        `[agent-longmemeval] reflection cache enabled: ${reflectionCache.getPath()}`
      );
    }

    if (args.saveArtifacts) {
      if (args.resume) {
        existingRecords = await loadExistingRecords(recordsPath, args.methods);
        if (existingRecords.length > 0) {
          console.log(
            `[agent-longmemeval] resume enabled: loaded ${existingRecords.length} existing records from ${recordsPath}`
          );
          await writeLog({
            event: "resume_loaded_records",
            recordsPath,
            existingRecords: existingRecords.length,
          });
        }
      }

      for (const method of args.methods) {
        const processedQuestions = existingRecords.filter(
          (record) => record.method === method
        ).length;
        progressByMethod.set(method, {
          processedQuestions,
          totalQuestions: totalNonAbstentionQuestions,
          skippedAbstentions: dataset.length - totalNonAbstentionQuestions,
        });
      }

      recordsHandle = await open(recordsPath, args.resume ? "a" : "w");
      await writeProgressSnapshot(true);
    }

    for (const method of args.methods) {
      const methodRecords = existingRecords.filter(
        (record) => record.method === method
      );
      citationStatsByMethod.set(method, {
        total: methodRecords.length,
        noCite: methodRecords.filter((record) =>
          hasNoCiteTag(record.predictedAnswer)
        ).length,
      });
    }

    const onRecord = async (record: AgentRunRecord): Promise<void> => {
      if (recordsHandle) {
        await recordsHandle.write(`${JSON.stringify(record)}\n`);
      } else {
        // keep logging even if records.jsonl is disabled
      }

      const stats = citationStatsByMethod.get(record.method) ?? {
        total: 0,
        noCite: 0,
      };
      stats.total += 1;
      const noCite = hasNoCiteTag(record.predictedAnswer);
      if (noCite) {
        stats.noCite += 1;
      }
      citationStatsByMethod.set(record.method, stats);

      await writeLog({
        event: "record",
        method: record.method,
        questionId: record.questionId,
        questionType: record.questionType,
        judgedCorrect: record.judgedCorrect,
        noCite,
        noCiteRate:
          stats.total > 0 ? Number((stats.noCite / stats.total).toFixed(6)) : 0,
        recallAt5: record.recallAt5,
        sessionAccuracy: record.sessionAccuracy,
        mrr: record.mrr,
        retrievedSessionIds: record.retrievedSessionIds,
        retrievalSource: record.retrievalSource ?? "topm",
        topKRetrievedSessionIds: record.topKRetrievedSessionIds ?? [],
        topMRetrievedSessionIds: record.topMRetrievedSessionIds ?? [],
        selectedMemoryIds: record.selectedMemoryIds ?? [],
        answerSessionIds: record.answerSessionIds,
        predictedAnswer: record.predictedAnswer,
      });
    };

    const onProgress = async (progress: AgentEvalProgress): Promise<void> => {
      progressByMethod.set(progress.method, {
        processedQuestions: progress.processedQuestions,
        totalQuestions: progress.totalQuestions,
        skippedAbstentions: progress.skippedAbstentions,
      });
      await writeProgressSnapshot(false);
      await writeLog({
        event: "progress",
        method: progress.method,
        processedQuestions: progress.processedQuestions,
        totalQuestions: progress.totalQuestions,
        skippedAbstentions: progress.skippedAbstentions,
      });
    };

    const onTraceEvent = async (traceEvent: EvalProbeEvent): Promise<void> => {
      await writeLog({
        event: "trace",
        trace: traceEvent,
      });
    };

    const onPrebuildEvent = async (
      event: AgentPrebuildEvent
    ): Promise<void> => {
      await writeLog({
        event: "prebuild",
        details: event,
      });
    };

    const evaluator = new AgentLongMemEvalEvaluator({
      dataset,
      judge,
      embeddings,
      modelFactory,
      reflectionModelFactory: reflectionModelFactoryWithCache,
      methods: args.methods,
      topK: args.topK,
      topM: args.topM,
      embeddingDimension: args.embeddingDimension,
      existingRecords,
      onRecord: args.saveArtifacts ? onRecord : undefined,
      onProgress: args.saveArtifacts ? onProgress : undefined,
      onTraceEvent,
      prebuildTopicMemoryBank: args.prebuildTopicMemoryBank,
      prebuildMethods: args.prebuildMethods,
      includeSpeaker2InPrebuild: args.includeSpeaker2InPrebuild,
      maxPrebuildSessions: args.prebuildMaxSessions,
      onPrebuildEvent,
      prebuildAllBeforeEvaluation: args.prebuildAllBeforeEvaluation,
      vectorStoreCacheDir: args.vectorStoreCache
        ? args.vectorStoreCacheDir
        : undefined,
      prebuildConcurrency: args.prebuildConcurrency,
      evalConcurrency: args.evalConcurrency,
      evaluationEnabled: args.mode !== "prebuild",
      allowRawFallback: args.allowRawFallback,
      requirePrebuildCompletion: args.requirePrebuild,
      strictPrebuildCoverage: args.strictPrebuildCoverage,
      retrievalMetricSource: args.retrievalMetricSource,
      prebuildZeroMemoryRetries: args.prebuildZeroMemoryRetries,
    });

    const output = await evaluator.evaluate();

    if (args.saveArtifacts) {
      await writeProgressSnapshot(true);

      const summaryPath = resolve(args.outDir, "summary.json");
      await writeFile(
        summaryPath,
        `${JSON.stringify(
          {
            generatedAt: output.generatedAt,
            datasetPath,
            mode: args.mode,
            methods: args.methods,
            resultCount: output.results.length,
            recordCount: output.records.length,
            results: output.results,
            prebuildSummary: output.prebuildSummary ?? null,
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      if (output.prebuildSummary) {
        await writeFile(
          resolve(args.outDir, "prebuild-summary.json"),
          `${JSON.stringify(output.prebuildSummary, null, 2)}\n`,
          "utf8"
        );
      }
    }

    await writeLog({
      event: "run_complete",
      recordCount: output.records.length,
      results: output.results,
      prebuildSummary: output.prebuildSummary ?? null,
      citationStatsByMethod: Object.fromEntries(
        [...citationStatsByMethod.entries()].map(([method, stats]) => [
          method,
          {
            total: stats.total,
            noCite: stats.noCite,
            noCiteRate:
              stats.total > 0
                ? Number((stats.noCite / stats.total).toFixed(6))
                : 0,
          },
        ])
      ),
    });

    printResults(output.results);
  } finally {
    if (recordsHandle) {
      await recordsHandle.close();
    }
    if (logHandle) {
      await logHandle.close();
    }

    if (embeddingCache) {
      const stats = embeddingCache.getStats();
      await embeddingCache.close();
      console.log(
        `[agent-longmemeval] embeddings cache stats: hits=${stats.hits} misses=${stats.misses} writes=${stats.writes}`
      );
    }
    if (reflectionCache) {
      const stats = reflectionCache.getStats();
      await reflectionCache.close();
      console.log(
        `[agent-longmemeval] reflection cache stats: hits=${stats.hits} misses=${stats.misses} writes=${stats.writes}`
      );
    }
  }
}

function parseArgs(argv: string[]): CliArgs {
  const kv = parseCliKeyValueArgs(argv);
  const methods = parseMethods(
    readCliEnvOrDefault(
      kv,
      "methods",
      "EVAL_METHODS",
      DEFAULT_LONGMEMEVAL_CONFIG.methods
    )
  );
  const prebuildMethods = parseMethods(
    readCliEnvOrDefault(
      kv,
      "prebuild-methods",
      "EVAL_PREBUILD_METHODS",
      DEFAULT_LONGMEMEVAL_CONFIG.prebuildMethods
    )
  );
  const mode = parseMode(
    readCliEnvOrDefault(
      kv,
      "mode",
      "EVAL_MODE",
      DEFAULT_LONGMEMEVAL_CONFIG.mode
    )
  );
  const paperStrict = parseBoolean(
    readCliEnvOrDefault(
      kv,
      "paper-strict",
      "EVAL_PAPER_STRICT",
      String(DEFAULT_LONGMEMEVAL_CONFIG.paperStrict)
    ),
    DEFAULT_LONGMEMEVAL_CONFIG.paperStrict
  );
  const outDir = resolve(
    readCliEnvOrDefault(
      kv,
      "out-dir",
      "EVAL_OUT_DIR",
      DEFAULT_LONGMEMEVAL_OUT_DIR
    )
  );
  const profile = resolveCliProfile(kv, mode, paperStrict);
  const runtimeOptions = resolveRuntimeOptions(kv, outDir);
  const defaultEmbeddingCacheNamespace = [
    process.env.EVAL_EMBEDDINGS_MODEL ?? "embeddings-model",
    `dim=${profile.embeddingDimension}`,
    `dtype=${process.env.EVAL_EMBEDDING_DTYPE ?? "default"}`,
    `encoding=${process.env.EVAL_EMBEDDING_ENCODING ?? "default"}`,
  ].join("|");

  return {
    mode,
    paperStrict,
    dataset: readCliEnvOrDefault(
      kv,
      "dataset",
      "EVAL_DATASET",
      DEFAULT_LONGMEMEVAL_DATASET
    ),
    methods,
    outDir,
    saveArtifacts: runtimeOptions.saveArtifacts,
    topK: profile.topK,
    topM: profile.topM,
    embeddingDimension: profile.embeddingDimension,
    modelAdapter: runtimeOptions.modelAdapter,
    judgeAdapter: runtimeOptions.judgeAdapter,
    embeddingsAdapter: runtimeOptions.embeddingsAdapter,
    embeddingCache: runtimeOptions.embeddingCache,
    embeddingCachePath: runtimeOptions.embeddingCachePath,
    embeddingCacheNamespace:
      readCliOrEnv(
        kv,
        "embedding-cache-namespace",
        "EVAL_EMBEDDING_CACHE_NAMESPACE"
      ) ?? defaultEmbeddingCacheNamespace,
    resume: runtimeOptions.resume,
    logFile: runtimeOptions.logFile,
    prebuildTopicMemoryBank: profile.prebuildTopicMemoryBank,
    prebuildMethods,
    includeSpeaker2InPrebuild: runtimeOptions.includeSpeaker2InPrebuild,
    prebuildMaxSessions: parseOptionalPositiveInt(
      readCliOrEnv(kv, "prebuild-max-sessions", "EVAL_PREBUILD_MAX_SESSIONS")
    ),
    reflectionModelAdapter: runtimeOptions.reflectionModelAdapter,
    reflectionCache: runtimeOptions.reflectionCache,
    reflectionCachePath: runtimeOptions.reflectionCachePath,
    prebuildAllBeforeEvaluation: runtimeOptions.prebuildAllBeforeEvaluation,
    vectorStoreCache: runtimeOptions.vectorStoreCache,
    vectorStoreCacheDir: runtimeOptions.vectorStoreCacheDir,
    prebuildConcurrency: profile.prebuildConcurrency,
    evalConcurrency: profile.evalConcurrency,
    requirePrebuild: profile.requirePrebuild,
    allowRawFallback: profile.allowRawFallback,
    strictPrebuildCoverage: profile.strictPrebuildCoverage,
    retrievalMetricSource: profile.retrievalMetricSource,
    prebuildZeroMemoryRetries: profile.prebuildZeroMemoryRetries,
  };
}

function resolveCliProfile(
  kv: Map<string, string>,
  _mode: "prebuild" | "eval" | "all",
  paperStrict: boolean
): Pick<
  CliArgs,
  | "allowRawFallback"
  | "embeddingDimension"
  | "evalConcurrency"
  | "prebuildConcurrency"
  | "prebuildTopicMemoryBank"
  | "prebuildZeroMemoryRetries"
  | "requirePrebuild"
  | "retrievalMetricSource"
  | "strictPrebuildCoverage"
  | "topK"
  | "topM"
> {
  const defaultEmbeddingDimension = parseIntWithDefault(
    process.env.EVAL_EMBEDDING_DIMENSION,
    DEFAULT_LONGMEMEVAL_CONFIG.embeddingDimension
  );
  const defaultPrebuildConcurrency = parseIntWithDefault(
    process.env.EVAL_PREBUILD_CONCURRENCY,
    DEFAULT_LONGMEMEVAL_CONFIG.prebuildConcurrency
  );
  const defaultEvalConcurrency = parseIntWithDefault(
    process.env.EVAL_CONCURRENCY,
    DEFAULT_LONGMEMEVAL_CONFIG.evalConcurrency
  );
  const hasExplicitPrebuildFlag = kv.has("prebuild-topic-bank");
  const prebuildTopicMemoryBank = hasExplicitPrebuildFlag
    ? parseBoolean(kv.get("prebuild-topic-bank"), true)
    : parseBoolean(
        process.env.EVAL_PREBUILD_TOPIC_BANK,
        DEFAULT_LONGMEMEVAL_CONFIG.prebuildTopicBank
      );
  const requirePrebuild = parseBoolean(
    readCliEnvOrDefault(
      kv,
      "require-prebuild",
      "EVAL_REQUIRE_PREBUILD",
      String(DEFAULT_LONGMEMEVAL_CONFIG.requirePrebuild)
    ),
    DEFAULT_LONGMEMEVAL_CONFIG.requirePrebuild
  );
  const allowRawFallback = parseBoolean(
    readCliEnvOrDefault(
      kv,
      "allow-raw-fallback",
      "EVAL_ALLOW_RAW_FALLBACK",
      String(DEFAULT_LONGMEMEVAL_CONFIG.allowRawFallback)
    ),
    DEFAULT_LONGMEMEVAL_CONFIG.allowRawFallback
  );
  const retrievalMetricSource = parseRetrievalMetricSource(
    readCliEnvOrDefault(
      kv,
      "metrics-retrieval-source",
      "EVAL_RETRIEVAL_METRIC_SOURCE",
      DEFAULT_LONGMEMEVAL_CONFIG.retrievalMetricSource
    ) ??
      readCliOrEnv(
        kv,
        "retrieval-metric-source",
        "EVAL_RETRIEVAL_METRIC_SOURCE"
      ),
    paperStrict ? "topm" : "topk"
  );

  return {
    allowRawFallback,
    embeddingDimension: parseIntWithDefault(
      readCliOrEnv(kv, "embedding-dimension", "EVAL_EMBEDDING_DIMENSION"),
      defaultEmbeddingDimension
    ),
    evalConcurrency: parseIntWithDefault(
      readCliOrEnv(kv, "eval-concurrency", "EVAL_CONCURRENCY"),
      defaultEvalConcurrency
    ),
    prebuildConcurrency: parseIntWithDefault(
      readCliOrEnv(kv, "prebuild-concurrency", "EVAL_PREBUILD_CONCURRENCY"),
      defaultPrebuildConcurrency
    ),
    prebuildTopicMemoryBank,
    prebuildZeroMemoryRetries: parseIntWithDefault(
      readCliEnvOrDefault(
        kv,
        "prebuild-zero-memory-retries",
        "EVAL_PREBUILD_ZERO_MEMORY_RETRIES",
        String(DEFAULT_LONGMEMEVAL_CONFIG.prebuildZeroMemoryRetries)
      ),
      parseIntWithDefault(
        process.env.EVAL_PREBUILD_ZERO_MEMORY_RETRIES,
        DEFAULT_LONGMEMEVAL_CONFIG.prebuildZeroMemoryRetries
      )
    ),
    requirePrebuild,
    retrievalMetricSource,
    strictPrebuildCoverage: parseCoverageWithDefault(
      readCliOrEnv(
        kv,
        "strict-prebuild-coverage",
        "EVAL_STRICT_PREBUILD_COVERAGE"
      ),
      requirePrebuild ? 1 : 0
    ),
    topK: paperStrict
      ? 20
      : parseIntWithDefault(readCliOrEnv(kv, "top-k", "EVAL_TOP_K"), 20),
    topM: paperStrict
      ? 5
      : parseIntWithDefault(readCliOrEnv(kv, "top-m", "EVAL_TOP_M"), 5),
  };
}

function resolveRuntimeOptions(
  kv: Map<string, string>,
  outDir: string
): Pick<
  CliArgs,
  | "embeddingsAdapter"
  | "embeddingCache"
  | "embeddingCachePath"
  | "includeSpeaker2InPrebuild"
  | "judgeAdapter"
  | "logFile"
  | "modelAdapter"
  | "prebuildAllBeforeEvaluation"
  | "reflectionCache"
  | "reflectionCachePath"
  | "reflectionModelAdapter"
  | "resume"
  | "saveArtifacts"
  | "vectorStoreCache"
  | "vectorStoreCacheDir"
> {
  return {
    embeddingsAdapter:
      readCliOrEnv(kv, "embeddings-adapter", "EVAL_EMBEDDINGS_ADAPTER") ??
      DEFAULT_LONGMEMEVAL_CONFIG.embeddingsAdapter,
    embeddingCache: parseBoolean(
      readCliOrEnv(kv, "embedding-cache", "EVAL_EMBEDDING_CACHE"),
      DEFAULT_LONGMEMEVAL_CONFIG.embeddingCache
    ),
    embeddingCachePath: resolve(
      readCliOrEnv(kv, "embedding-cache-path", "EVAL_EMBEDDING_CACHE_PATH") ??
        DEFAULT_LONGMEMEVAL_CONFIG.embeddingCachePath
    ),
    includeSpeaker2InPrebuild: parseBoolean(
      readCliOrEnv(kv, "prebuild-speaker2", "EVAL_PREBUILD_SPEAKER2"),
      DEFAULT_LONGMEMEVAL_CONFIG.prebuildSpeaker2
    ),
    judgeAdapter:
      readCliOrEnv(kv, "judge-adapter", "EVAL_JUDGE_ADAPTER") ??
      "./scripts/adapters/google-gemma-judge-adapter.ts",
    logFile: resolve(
      readCliOrEnv(kv, "log-file", "EVAL_LOG_FILE") ?? `${outDir}/run.log`
    ),
    modelAdapter:
      readCliOrEnv(kv, "model-adapter", "EVAL_MODEL_ADAPTER") ??
      DEFAULT_LONGMEMEVAL_CONFIG.modelAdapter,
    prebuildAllBeforeEvaluation: parseBoolean(
      readCliOrEnv(
        kv,
        "prebuild-all-before-evaluation",
        "EVAL_PREBUILD_ALL_BEFORE_EVALUATION"
      ),
      DEFAULT_LONGMEMEVAL_CONFIG.prebuildAllBeforeEvaluation
    ),
    reflectionCache: parseBoolean(
      readCliOrEnv(kv, "reflection-cache", "EVAL_REFLECTION_CACHE"),
      DEFAULT_LONGMEMEVAL_CONFIG.reflectionCache
    ),
    reflectionCachePath: resolve(
      readCliOrEnv(kv, "reflection-cache-path", "EVAL_REFLECTION_CACHE_PATH") ??
        DEFAULT_LONGMEMEVAL_CONFIG.reflectionCachePath
    ),
    reflectionModelAdapter:
      readCliOrEnv(
        kv,
        "reflection-model-adapter",
        "EVAL_REFLECTION_MODEL_ADAPTER"
      ) ?? DEFAULT_LONGMEMEVAL_CONFIG.reflectionModelAdapter,
    resume: parseBoolean(
      readCliOrEnv(kv, "resume", "EVAL_RESUME"),
      DEFAULT_LONGMEMEVAL_CONFIG.resume
    ),
    saveArtifacts: parseBoolean(
      readCliOrEnv(kv, "save-artifacts", "EVAL_SAVE_ARTIFACTS"),
      DEFAULT_LONGMEMEVAL_CONFIG.saveArtifacts
    ),
    vectorStoreCache: parseBoolean(
      readCliOrEnv(kv, "vector-store-cache", "EVAL_VECTOR_STORE_CACHE"),
      DEFAULT_LONGMEMEVAL_CONFIG.vectorStoreCache
    ),
    vectorStoreCacheDir: resolve(
      readCliOrEnv(
        kv,
        "vector-store-cache-dir",
        "EVAL_VECTOR_STORE_CACHE_DIR"
      ) ?? DEFAULT_LONGMEMEVAL_CONFIG.vectorStoreCacheDir
    ),
  };
}

function readCliOrEnv(
  kv: Map<string, string>,
  cliKey: string,
  envKey: string
): string | undefined {
  return kv.get(cliKey) ?? process.env[envKey];
}

function readCliEnvOrDefault(
  kv: Map<string, string>,
  cliKey: string,
  envKey: string,
  fallback: string
): string {
  return kv.get(cliKey) ?? process.env[envKey] ?? fallback;
}

async function loadExistingRecords(
  path: string,
  methods: AgentEvalMethod[]
): Promise<AgentRunRecord[]> {
  try {
    const raw = await readFile(path, "utf8");
    const allowedMethods = new Set(methods);
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const deduped = new Map<string, AgentRunRecord>();

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Partial<AgentRunRecord>;
        if (
          !parsed ||
          typeof parsed !== "object" ||
          typeof parsed.method !== "string" ||
          typeof parsed.questionId !== "string"
        ) {
          continue;
        }
        if (!allowedMethods.has(parsed.method as AgentEvalMethod)) {
          continue;
        }

        const record = parsed as AgentRunRecord;
        const key = `${record.method}::${record.questionId}`;
        if (!deduped.has(key)) {
          deduped.set(key, record);
        }
      } catch {
        // Ignore malformed line and continue.
      }
    }

    return [...deduped.values()];
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function parseMethods(raw?: string): AgentEvalMethod[] {
  const values = (raw ?? "rmm,rag,oracle")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const allowed = new Set<AgentEvalMethod>(["rmm", "rag", "oracle"]);
  const methods: AgentEvalMethod[] = [];

  for (const value of values) {
    if (!allowed.has(value as AgentEvalMethod)) {
      throw new Error(`Invalid method "${value}". Allowed: rmm, rag, oracle`);
    }
    methods.push(value as AgentEvalMethod);
  }

  return methods.length > 0 ? methods : ["rmm", "rag", "oracle"];
}

function parseMode(raw?: string): "prebuild" | "eval" | "all" {
  if (!raw) {
    return "all";
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "prebuild" ||
    normalized === "eval" ||
    normalized === "all"
  ) {
    return normalized;
  }
  throw new Error(
    `Invalid --mode "${raw}". Allowed values: prebuild, eval, all`
  );
}

function parseRetrievalMetricSource(
  raw: string | undefined,
  fallback: "topm" | "topk"
): "topm" | "topk" {
  if (!raw) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "topm" || normalized === "topk") {
    return normalized;
  }
  throw new Error(
    `Invalid retrieval metric source "${raw}". Allowed values: topm, topk`
  );
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseIntWithDefault(
  raw: string | undefined,
  fallback: number
): number {
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseOptionalPositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseCoverageWithDefault(
  raw: string | undefined,
  fallback: number
): number {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed <= 0) {
    return 0;
  }
  if (parsed >= 1) {
    return 1;
  }
  return parsed;
}

async function loadModelFactory(
  adapterPath?: string
): Promise<(method: AgentEvalMethod) => BaseChatModel> {
  if (!adapterPath) {
    console.warn(
      "No --model-adapter provided. Falling back to FakeToolCallingModel for smoke testing."
    );
    return () => new FakeToolCallingModel();
  }

  const modulePath = resolve(adapterPath);
  const imported = await import(pathToFileUrl(modulePath));
  const fn = imported.createModel ?? imported.default;

  if (typeof fn !== "function") {
    throw new Error(
      `Model adapter at ${modulePath} must export createModel(method) or default function`
    );
  }

  return (method: AgentEvalMethod) => fn(method);
}

async function loadJudge(adapterPath?: string): Promise<AnswerJudge> {
  if (!adapterPath) {
    console.warn(
      "No --judge-adapter provided. Falling back to exact-match judge (not paper-equivalent)."
    );
    return createExactMatchJudge();
  }

  const modulePath = resolve(adapterPath);
  const imported = await import(pathToFileUrl(modulePath));

  if (typeof imported.createJudge === "function") {
    return imported.createJudge();
  }

  if (typeof imported.judgePrompt === "function") {
    return createPromptJudge(imported.judgePrompt as PromptJudgeRunner);
  }

  if (typeof imported.default === "function") {
    const candidate = imported.default();
    if (candidate && typeof candidate.judge === "function") {
      return candidate as AnswerJudge;
    }
  }

  throw new Error(
    `Judge adapter at ${modulePath} must export createJudge(), judgePrompt(), or a default factory returning { judge }`
  );
}

async function loadEmbeddings(
  adapterPath: string | undefined,
  dimension: number
): Promise<Embeddings> {
  if (!adapterPath) {
    console.warn(
      "No --embeddings-adapter provided. Falling back to deterministic local embeddings for smoke testing."
    );
    return createDeterministicEmbeddings(dimension);
  }

  const modulePath = resolve(adapterPath);
  const imported = await import(pathToFileUrl(modulePath));
  const factory = imported.createEmbeddings ?? imported.default;

  if (typeof factory !== "function") {
    throw new Error(
      `Embeddings adapter at ${modulePath} must export createEmbeddings() or default function`
    );
  }

  const embeddings = await factory();
  if (!embeddings || typeof embeddings.embedQuery !== "function") {
    throw new Error(
      `Embeddings adapter at ${modulePath} returned invalid object`
    );
  }

  return embeddings as Embeddings;
}

function createDeterministicEmbeddings(dimension: number): Embeddings {
  const makeVector = (text: string): number[] => {
    const output = new Array(dimension).fill(0);
    for (let i = 0; i < text.length; i++) {
      const slot = i % dimension;
      const value = (text.charCodeAt(i) % 32) / 32;
      output[slot] += value;
    }
    return output;
  };

  return {
    caller: new AsyncCaller({}),
    embedQuery(text: string): Promise<number[]> {
      return Promise.resolve(makeVector(text));
    },
    embedDocuments(texts: string[]): Promise<number[][]> {
      return Promise.resolve(texts.map((text) => makeVector(text)));
    },
  };
}

function printResults(
  results: Array<{
    method: AgentEvalMethod;
    totalQuestions: number;
    skippedAbstentions: number;
    recallAt5: number;
    accuracy: number;
    sessionAccuracy: number;
    mrr: number;
  }>
): void {
  const header = "method\ttotal\tskipped\trecall@5\taccuracy\tsession_acc\tmrr";
  console.log(header);
  for (const row of results) {
    console.log(
      [
        row.method,
        row.totalQuestions,
        row.skippedAbstentions,
        row.recallAt5.toFixed(4),
        row.accuracy.toFixed(4),
        row.sessionAccuracy.toFixed(4),
        row.mrr.toFixed(4),
      ].join("\t")
    );
  }
}

function hasNoCiteTag(text: string): boolean {
  return NO_CITE_TAG_REGEX.test(text);
}

function pathToFileUrl(filePath: string): string {
  return pathToFileURL(resolve(filePath)).toString();
}

function resolveReflectionModelFactory(
  args: CliArgs,
  modelFactory: (method: AgentEvalMethod) => BaseChatModel
): Promise<((method: AgentEvalMethod) => BaseChatModel) | undefined> {
  if (!args.prebuildTopicMemoryBank) {
    return Promise.resolve(undefined);
  }
  if (!(args.reflectionModelAdapter || args.modelAdapter)) {
    return Promise.resolve(undefined);
  }

  if (
    args.reflectionModelAdapter &&
    args.modelAdapter &&
    resolve(args.reflectionModelAdapter) === resolve(args.modelAdapter)
  ) {
    return Promise.resolve(modelFactory);
  }

  return loadModelFactory(args.reflectionModelAdapter ?? args.modelAdapter);
}

function parseCliKeyValueArgs(argv: string[]): Map<string, string> {
  const kv = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token?.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    if (!rawKey) {
      continue;
    }

    if (inlineValue !== undefined) {
      kv.set(rawKey, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      kv.set(rawKey, next);
      i += 1;
    } else {
      kv.set(rawKey, "true");
    }
  }

  return kv;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[agent-longmemeval] ${message}`);
  process.exitCode = 1;
});
