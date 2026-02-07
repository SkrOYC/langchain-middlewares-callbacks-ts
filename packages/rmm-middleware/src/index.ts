/**
 * Reflective Memory Management (RMM) Middleware for LangChain
 *
 * Provides learnable memory reranking with:
 * - Prospective Reflection: Extracts high-quality memories from dialogue
 * - Retrospective Reflection: Reranks memories using learned relevance scores
 * - REINFORCE Learning: Updates reranker weights based on citations
 */

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
import { type RmmConfig, rmmConfigSchema } from "@/schemas/config.js";
import type { Runtime } from "@/schemas/index.js";

export type { RmmConfig } from "@/schemas/config.js";

/**
 * Extracts the hook function from a middleware factory result
 */
function extractHook<
  T extends { name: string; [key: string]: unknown },
  K extends string,
>(factory: T, hookKey: K): T extends Record<K, infer R> ? R : never {
  return factory[hookKey] as T extends Record<K, infer R> ? R : never;
}

/**
 * Creates RMM middleware for LangChain createAgent
 *
 * @param config - Configuration options for RMM
 * @param config.vectorStore - Vector store for memory retrieval (required for retrospective reflection)
 * @param config.embeddings - Embeddings instance for reranking (required)
 * @param config.llm - LLM for memory extraction (optional - enables prospective reflection)
 * @param config.topK - Number of memories to retrieve (default: 20)
 * @param config.topM - Number of memories to include in context (default: 5)
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

  // Build beforeAgent hook options
  const beforeAgentOptions: BeforeAgentOptions = {
    store: parsedConfig.vectorStore as BeforeAgentOptions["store"],
    userIdExtractor: (runtime: Runtime) => {
      // Try configurable first (from createAgent config)
      const configurable = (
        runtime as { configurable?: { sessionId?: string } }
      ).configurable;
      if (configurable?.sessionId) {
        return configurable.sessionId;
      }
      // Fall back to context
      const context = (runtime as { context?: { sessionId?: string } }).context;
      return context?.sessionId ?? "";
    },
    reflectionConfig: parsedConfig.llm
      ? {
          minTurns: 3,
          maxTurns: 50,
          minInactivityMs: 300_000,
          maxInactivityMs: 1_800_000,
          mode: "strict" as const,
          retryDelayMs: 1000,
          maxRetries: 3,
        }
      : undefined,
    namespace: parsedConfig.sessionId
      ? ["rmm", parsedConfig.sessionId]
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

  // Create the combined middleware
  return createMiddleware({
    name: "RmmMiddleware",
    beforeAgent: beforeAgentHook,
    beforeModel: beforeModelHook,
    wrapModelCall: undefined,
    afterModel: afterModelHook,
    afterAgent: (state, runtime) => {
      // Extract dependencies from runtime for afterAgent
      const deps: AfterAgentDependencies = {
        store: (runtime as { context?: { store?: unknown } }).context
          ?.store as AfterAgentDependencies["store"],
        reflectionConfig: parsedConfig.llm
          ? {
              minTurns: 3,
              maxTurns: 50,
              minInactivityMs: 300_000,
              maxInactivityMs: 1_800_000,
              mode: "strict" as const,
              retryDelayMs: 1000,
              maxRetries: 3,
            }
          : undefined,
      };
      return afterAgent(state, runtime as Runtime, deps);
    },
  });
}
