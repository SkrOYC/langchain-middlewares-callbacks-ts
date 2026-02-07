/**
 * RMM Middleware Configuration Schema
 *
 * Defines the configuration options exposed to developers.
 * Only includes options that are developer concerns.
 * Internal implementation details are handled internally.
 */

import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { z } from "zod";

/**
 * Vector store interface for memory retrieval
 */
export interface RmmVectorStore {
  similaritySearch: (
    query: string,
    k?: number
  ) => Promise<
    Array<{ pageContent: string; metadata: Record<string, unknown> }>
  >;
  addDocuments: (
    documents: Array<{
      pageContent: string;
      metadata?: Record<string, unknown>;
    }>
  ) => Promise<void>;
}

/**
 * Configuration schema for RMM middleware
 *
 * Exposes only what's strictly necessary as developer concern.
 * All internal defaults and implementation details are handled internally.
 */
export const rmmConfigSchema = z.object({
  /**
   * Vector store for memory retrieval and storage.
   * Required for retrospective reflection (memory retrieval).
   */
  vectorStore: z.custom<RmmVectorStore>().optional(),

  /**
   * Embeddings instance for encoding queries and memories.
   * Required for reranking computations.
   */
  embeddings: z.custom<Embeddings>().optional(),

  /**
   * Language model for prospective reflection (memory extraction).
   * Optional - if not provided, prospective reflection is skipped.
   */
  llm: z.custom<BaseLanguageModel>().optional(),

  /**
   * Number of memories to retrieve from vector store.
   * @default 20
   */
  topK: z.number().int().positive().default(20),

  /**
   * Number of memories to include in LLM context.
   * @default 5
   */
  topM: z.number().int().positive().max(10).default(5),

  /**
   * Temperature parameter for Gumbel-Softmax sampling.
   * Lower values produce more deterministic reranking.
   * Higher values encourage exploration.
   * @default 0.5
   */
  temperature: z.number().positive().default(0.5),

  /**
   * Learning rate for REINFORCE weight updates.
   * Controls how fast the reranker adapts to user patterns.
   * @default 1e-3
   */
  learningRate: z.number().positive().default(0.001),

  /**
   * Baseline value for REINFORCE variance reduction.
   * @default 0.5
   */
  baseline: z.number().min(0).max(1).default(0.5),

  /**
   * Embedding dimension for the reranker matrices.
   * Required when using retrospective reflection (when embeddings is provided).
   * Must match the output dimension of your embeddings model.
   */
  embeddingDimension: z.number().int().positive().optional(),

  /**
   * Session identifier for memory isolation.
   * If not provided, derived from runtime context.
   */
  sessionId: z.string().optional(),

  /**
   * Whether RMM is enabled.
   * @default true
   */
  enabled: z.boolean().default(true),
});

export type RmmConfig = z.input<typeof rmmConfigSchema>;
