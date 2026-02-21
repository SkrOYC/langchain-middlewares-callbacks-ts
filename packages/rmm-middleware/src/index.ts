/**
 * Reflective Memory Management (RMM) Middleware for LangChain
 *
 * Provides learnable memory reranking with:
 * - Prospective Reflection: Extracts high-quality memories from dialogue
 * - Retrospective Reflection: Reranks memories using learned relevance scores
 * - REINFORCE Learning: Updates reranker weights based on citations
 */

import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import {
  type AfterModelHook,
  type BeforeAgentHook,
  type BeforeModelHook,
  createMiddleware,
  type WrapModelCallHook,
} from "langchain";
import { z } from "zod";
import {
  type AfterAgentDependencies,
  afterAgent,
} from "@/middleware/hooks/after-agent.js";
import {
  type AfterModelOptions,
  createRetrospectiveAfterModel,
} from "@/middleware/hooks/after-model.js";
// Import existing hook factories
import {
  type BeforeAgentOptions,
  createRetrospectiveBeforeAgent,
} from "@/middleware/hooks/before-agent.js";
import {
  type BeforeModelOptions,
  createRetrospectiveBeforeModel,
} from "@/middleware/hooks/before-model.js";
import {
  createRetrospectiveWrapModelCall,
  type WrapModelCallOptions,
} from "@/middleware/hooks/wrap-model-call.js";
import { extractSpeaker1 } from "@/middleware/prompts/extract-speaker1.js";
import { extractSpeaker2 } from "@/middleware/prompts/extract-speaker2.js";
import { updateMemory } from "@/middleware/prompts/update-memory.js";
import { type RmmConfig, rmmConfigSchema } from "@/schemas/config.js";
import {
  DEFAULT_REFLECTION_CONFIG,
  type RmmMiddlewareState,
  rmmMiddlewareStateSchema,
} from "@/schemas/index.js";
import { getLogger } from "@/utils/logger";

// Offline Pretraining exports - types only
export type {
  ContrastivePair,
  PretrainingConfig,
  TrainingResult,
} from "@/algorithms/offline-pretraining.js";
// Offline Pretraining exports - values
export {
  InfoNCE,
  OfflinePretrainer,
  SupervisedContrastiveLoss,
} from "@/algorithms/offline-pretraining.js";
// Evaluation exports - types only
export type {
  EvaluationResult,
  LongMemEvalEvaluatorConfig,
  Table1Metrics,
} from "@/evaluation/longmemeval-evaluator.js";
// Evaluation exports - values
export { LongMemEvalEvaluator } from "@/evaluation/longmemeval-evaluator.js";
// Metrics exports - types only
export type {
  EvaluationMetrics,
  MRRResult,
  RecallResult,
} from "@/evaluation/metrics.js";
// Metrics exports - values
export {
  computeAllMetrics,
  computeMeanReciprocalRank,
  computeRecallAtK,
  computeSessionAccuracy,
  computeTurnAccuracy,
} from "@/evaluation/metrics.js";
// Oracle Retriever exports - types only
export type {
  LongMemEvalInstance,
  LongMemEvalTurn,
  OracleConfig as OracleRetrieverConfig,
} from "@/retrievers/oracle-retriever.js";
// Oracle Retriever exports - values
export { OracleVectorStore } from "@/retrievers/oracle-retriever.js";
// Schema exports - types only
export type {
  EvaluationConfig,
  RmmConfig,
} from "@/schemas/config.js";
export type { RmmMiddlewareState, RmmRuntimeContext } from "@/schemas/index.js";

const logger = getLogger("rmm-middleware");

/**
 * Creates RMM middleware for LangChain createAgent
 *
 * @param config - Configuration options for RMM
 * @param config.vectorStore - Vector store for memory retrieval (optional, needed for retrospective reflection)
 * @param config.embeddings - Embeddings instance for reranking (optional, needed for reranking computations)
 * @param config.llm - LLM for memory extraction (optional - enables prospective reflection)
 * @param config.topK - Number of memories to retrieve (default: 20)
 * @param config.topM - Number of memories to include in context (default: 5)
 * @param config.temperature - Gumbel-Softmax temperature for reranking (default: 0.5)
 * @param config.learningRate - REINFORCE learning rate for weight updates (default: 0.001)
 * @param config.baseline - REINFORCE baseline for variance reduction (default: 0.5)
 * @param config.embeddingDimension - Embedding dimension for reranker matrices (default: 1536)
 * @param config.sessionId - Session identifier for memory isolation
 * @param config.enabled - Whether RMM is enabled (default: true)
 *
 * @returns AgentMiddleware instance
 *
 * @example
 * ```typescript
 * import { createAgent, rmmMiddleware } from "@skroyc/rmm-middleware";
 * import { OpenAIEmbeddings } from "@langchain/openai";
 * import { MemoryVectorStore } from "langchain/vectorstores/memory";
 *
 * const vectorStore = new MemoryVectorStore(new OpenAIEmbeddings());
 *
 * const agent = createAgent({
 *   model: openaiModel,
 *   tools: [myTool],
 *   middleware: [
 *     rmmMiddleware({
 *       vectorStore,
 *       embeddings: new OpenAIEmbeddings(),
 *       topK: 20,
 *       topM: 5,
 *       temperature: 0.5,
 *       learningRate: 0.001,
 *       baseline: 0.5,
 *       embeddingDimension: 1536,
 *     })
 *   ]
 * });
 * ```
 */
export function rmmMiddleware(config: RmmConfig = {}) {
  const parsedConfig = rmmConfigSchema.parse(config);

  /**
   * Context schema for RMM middleware runtime context.
   * Defines the shape of runtime.context accessed in middleware hooks.
   */
  const rmmContextSchema = z.object({
    sessionId: z.string().optional(),
    store: z.custom<BaseStore>().optional(),
  });

  /**
   * Validates that vectorStore's internal embeddings matches the configured embeddings.
   * Mismatched embeddings cause silent incorrect reranking results.
   */
  if (parsedConfig.vectorStore && parsedConfig.embeddings) {
    const vsEmbeddings = (parsedConfig.vectorStore as VectorStoreInterface)
      ?.embeddings;
    if (vsEmbeddings && vsEmbeddings !== parsedConfig.embeddings) {
      logger.warn(
        "RMM middleware embeddings instance differs from vectorStore's internal embeddings. " +
          "This may cause incorrect reranking results. Ensure both use the same embedding model."
      );
    }
  }

  // If RMM is disabled, return a no-op middleware
  if (!parsedConfig.enabled) {
    return createMiddleware({
      name: "RmmMiddleware",
      beforeAgent: () => undefined,
      beforeModel: () => undefined,
      afterModel: () => undefined,
      afterAgent: () => undefined,
    });
  }

  // Validate embeddings and embeddingDimension (both required together)
  if (parsedConfig.embeddings && !parsedConfig.embeddingDimension) {
    throw new Error(
      "embeddingDimension is required when embeddings is provided. " +
        "Please specify the output dimension of your embeddings model."
    );
  }
  if (parsedConfig.embeddingDimension && !parsedConfig.embeddings) {
    throw new Error(
      "embeddings is required when embeddingDimension is provided. " +
        "Please provide an embeddings instance."
    );
  }

  // Validate topM <= topK (cap topM at topK if exceeds)
  const effectiveTopM = Math.min(parsedConfig.topM, parsedConfig.topK);
  if (effectiveTopM < parsedConfig.topM) {
    logger.warn(
      `RMM configuration: topM (${parsedConfig.topM}) exceeds topK (${parsedConfig.topK}), ` +
        `capping to ${effectiveTopM}.`
    );
  }

  // Build beforeAgent hook options
  const beforeAgentOptions: BeforeAgentOptions = {
    userIdExtractor: (runtime) => {
      // Try configurable first (from createAgent config)
      const configurable = runtime.configurable as
        | { sessionId?: string }
        | undefined;
      if (configurable?.sessionId) {
        return configurable.sessionId;
      }
      // Fall back to context
      return runtime.context?.sessionId ?? "";
    },
    rerankerConfig: {
      topK: parsedConfig.topK,
      topM: effectiveTopM,
      temperature: parsedConfig.temperature,
      learningRate: parsedConfig.learningRate,
      baseline: parsedConfig.baseline,
      embeddingDimension: parsedConfig.embeddingDimension,
    },
    reflectionConfig: parsedConfig.llm ? DEFAULT_REFLECTION_CONFIG : undefined,
    namespace: parsedConfig.sessionId
      ? ["rmm", parsedConfig.sessionId]
      : undefined,
    reflectionDeps:
      parsedConfig.llm && parsedConfig.embeddings && parsedConfig.vectorStore
        ? {
            vectorStore: parsedConfig.vectorStore as VectorStoreInterface,
            extractSpeaker1,
            extractSpeaker2,
            updateMemory,
            llm: parsedConfig.llm as BaseChatModel,
            embeddings: parsedConfig.embeddings as Embeddings,
          }
        : undefined,
  };

  // Build beforeModel hook options
  // VectorStoreInterface is used directly
  const beforeModelOptions: BeforeModelOptions = {
    vectorStore: parsedConfig.vectorStore as BeforeModelOptions["vectorStore"],
    embeddings: parsedConfig.embeddings as BeforeModelOptions["embeddings"],
    topK: parsedConfig.topK,
  };

  // Build afterModel hook options
  const afterModelOptions: AfterModelOptions = {
    batchSize: 4,
    clipThreshold: 100,
  };

  // Create hooks directly (factories now return hook functions)
  const beforeAgentHook = createRetrospectiveBeforeAgent(beforeAgentOptions);

  const beforeModelHook = createRetrospectiveBeforeModel(beforeModelOptions);

  const afterModelHook = createRetrospectiveAfterModel(afterModelOptions);

  // Create wrapModelCall hook only if embeddings is present (optional for retrospective reflection)
  let wrapModelCallHook:
    | ReturnType<typeof createRetrospectiveWrapModelCall>
    | undefined;
  if (parsedConfig.embeddings && parsedConfig.embeddingDimension) {
    const wrapModelCallOptions: WrapModelCallOptions = {
      embeddings: parsedConfig.embeddings as Embeddings,
      embeddingDimension: parsedConfig.embeddingDimension,
    };
    wrapModelCallHook = createRetrospectiveWrapModelCall(wrapModelCallOptions);
  }

  // Create the combined middleware
  // Use rmmMiddlewareStateSchema so LangChain knows about our custom state fields
  type Context = z.infer<typeof rmmContextSchema>;
  type StateSchema = typeof rmmMiddlewareStateSchema;
  return createMiddleware({
    name: "RmmMiddleware",
    stateSchema: rmmMiddlewareStateSchema,
    contextSchema: rmmContextSchema,
    beforeAgent: beforeAgentHook as BeforeAgentHook<StateSchema, Context>,
    beforeModel: beforeModelHook as BeforeModelHook<StateSchema, Context>,
    wrapModelCall: wrapModelCallHook as unknown as WrapModelCallHook<
      StateSchema,
      Context
    >,
    afterModel: afterModelHook as AfterModelHook<StateSchema, Context>,
    afterAgent: async (state, runtime) => {
      // Extract userId from runtime (same pattern as beforeAgent's userIdExtractor)
      // Try configurable first (from createAgent config), then fall back to context
      const configurable = runtime.configurable as
        | { sessionId?: string }
        | undefined;
      const userId =
        configurable?.sessionId ?? runtime.context?.sessionId ?? "";

      // Extract dependencies from runtime for afterAgent
      // Check both runtime.store (LangGraph) and context.store (user-provided)
      const store = runtime.store ?? runtime.context?.store;

      const deps: AfterAgentDependencies = {
        userId,
        store,
        reflectionConfig: parsedConfig.llm
          ? DEFAULT_REFLECTION_CONFIG
          : undefined,
      };

      // Pass state directly - afterAgent now accepts partial RmmMiddlewareState
      return await afterAgent(
        state as RmmMiddlewareState & { messages: BaseMessage[] },
        runtime,
        deps
      );
    },
  });
}
