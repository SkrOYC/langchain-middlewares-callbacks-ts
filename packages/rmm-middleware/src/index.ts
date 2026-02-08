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
import { createMiddleware } from "langchain";
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
import { getLogger } from "@/utils/logger";

export type { RmmConfig } from "@/schemas/config.js";

/**
 * Extracts the hook function from a middleware factory result
 */
function extractHook<T extends Record<string, unknown>, K extends keyof T>(
  factory: T,
  hookKey: K
): T[K] {
  return factory[hookKey];
}

/**
 * Default reflection configuration
 */
const DEFAULT_REFLECTION_CONFIG = {
  minTurns: 3,
  maxTurns: 50,
  minInactivityMs: 300_000,
  maxInactivityMs: 1_800_000,
  mode: "strict" as const,
  retryDelayMs: 1000,
  maxRetries: 3,
} as const;

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
    store: parsedConfig.vectorStore as BeforeAgentOptions["store"],
    userIdExtractor: (runtime: {
      configurable?: { sessionId?: string };
      context?: { sessionId?: string };
    }) => {
      // Try configurable first (from createAgent config)
      const configurable = runtime.configurable;
      if (configurable?.sessionId) {
        return configurable.sessionId;
      }
      // Fall back to context
      const context = runtime.context;
      return context?.sessionId ?? "";
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
      parsedConfig.llm && parsedConfig.embeddings
        ? {
            vectorStore: {
              similaritySearch: (query) =>
                parsedConfig.vectorStore?.similaritySearch?.(query as string) ??
                Promise.resolve([]),
              addDocuments: (documents) =>
                parsedConfig.vectorStore?.addDocuments?.(documents) ??
                Promise.resolve(),
            },
            extractSpeaker1,
            extractSpeaker2,
            updateMemory,
            llm: parsedConfig.llm as BaseChatModel,
            embeddings: parsedConfig.embeddings as Embeddings,
          }
        : undefined,
  };

  // Build beforeModel hook options
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

  // Create hook factories and extract hooks
  const beforeAgentMiddleware =
    createRetrospectiveBeforeAgent(beforeAgentOptions);
  const beforeAgentHook = extractHook(beforeAgentMiddleware, "beforeAgent");

  const beforeModelMiddleware =
    createRetrospectiveBeforeModel(beforeModelOptions);
  const beforeModelHook = extractHook(beforeModelMiddleware, "beforeModel");

  const afterModelMiddleware = createRetrospectiveAfterModel(afterModelOptions);
  const afterModelHook = extractHook(afterModelMiddleware, "afterModel");

  // Create wrapModelCall hook only if embeddings is present (optional for retrospective reflection)
  let wrapModelCallHook: ReturnType<typeof extractHook> | undefined;
  if (parsedConfig.embeddings && parsedConfig.embeddingDimension) {
    const wrapModelCallOptions: WrapModelCallOptions = {
      embeddings: parsedConfig.embeddings as Embeddings,
      embeddingDimension: parsedConfig.embeddingDimension,
    };
    const wrapModelCallMiddleware =
      createRetrospectiveWrapModelCall(wrapModelCallOptions);
    wrapModelCallHook = extractHook(wrapModelCallMiddleware, "wrapModelCall");
  }

  // Create the combined middleware
  return createMiddleware({
    name: "RmmMiddleware",
    beforeAgent: beforeAgentHook,
    beforeModel: beforeModelHook,
    wrapModelCall: wrapModelCallHook,
    afterModel: afterModelHook,
    afterAgent: (state, runtime: { context?: { store?: unknown } }) => {
      // Extract dependencies from runtime for afterAgent
      const deps: AfterAgentDependencies = {
        store: runtime.context?.store as AfterAgentDependencies["store"],
        reflectionConfig: parsedConfig.llm
          ? DEFAULT_REFLECTION_CONFIG
          : undefined,
      };
      return afterAgent(state, { context: runtime.context }, deps);
    },
  });
}
