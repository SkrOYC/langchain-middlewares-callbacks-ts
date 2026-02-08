/**
 * beforeModel hook for Retrospective Reflection
 *
 * Performs memory retrieval for the current query:
 * 1. Extracts the last human message as the query
 * 2. Retrieves Top-K memories from VectorStore
 * 3. Transforms VectorStore results to RetrievedMemory format
 * 4. Increments turn counter for session tracking
 *
 * Per Algorithm 1 from the paper: M_K ← f_θ(q, B)
 */

import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseMessage } from "@langchain/core/messages";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import type { CitationRecord, RerankerState, RetrievedMemory } from "@/schemas";
import { getLogger } from "@/utils/logger";
import { extractLastHumanMessage } from "@/utils/memory-helpers";

const logger = getLogger("before-model");

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration options for the beforeModel hook
 */
export interface BeforeModelOptions {
  /**
   * VectorStore instance for memory retrieval
   */
  vectorStore: VectorStoreInterface;

  /**
   * Embeddings instance for query encoding
   * (Used if query embedding is needed)
   */
  embeddings: Embeddings;

  /**
   * Number of memories to retrieve (Top-K)
   * @default 20
   */
  topK?: number;
}

/**
 * Runtime interface for beforeModel hook
 *
 * Note: vectorStore and embeddings are passed via options, not runtime.context.
 * This interface exists for type compatibility with the middleware pattern.
 */
interface BeforeModelRuntime {
  context: {
    // Placeholder for future runtime-injected context
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * State interface for beforeModel hook
 */
interface BeforeModelState {
  messages: BaseMessage[];
  _rerankerWeights: RerankerState;
  _retrievedMemories: RetrievedMemory[];
  _citations: CitationRecord[];
  _turnCountInSession: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validates that reranker weights have all required properties
 */
function hasValidRerankerWeights(
  weights: RerankerState | null | undefined
): weights is RerankerState & {
  weights: { queryTransform: number[][]; memoryTransform: number[][] };
  config: unknown;
} {
  return !!(
    weights?.weights?.queryTransform &&
    weights.weights.memoryTransform &&
    weights.config
  );
}

/**
 * Transforms VectorStore documents to RetrievedMemory format
 */
function transformDocsToMemories(
  docs: Array<{
    pageContent: string;
    metadata?: Record<string, unknown>;
    score?: number;
  }>,
  existingMemories: RetrievedMemory[]
): RetrievedMemory[] {
  return docs.map((doc, index) => {
    const metadata = doc.metadata as Record<string, unknown> | undefined;

    // Try to preserve existing memory ID if this is an update
    const existingMemory = existingMemories.find(
      (m) => m.topicSummary === doc.pageContent
    );

    return {
      id: (metadata?.id as string) ?? existingMemory?.id ?? `memory-${index}`,
      topicSummary: doc.pageContent,
      rawDialogue: (metadata?.rawDialogue as string) ?? "",
      timestamp:
        (metadata?.timestamp as number) ??
        existingMemory?.timestamp ??
        Date.now(),
      sessionId: (metadata?.sessionId as string) ?? "unknown",
      turnReferences: (metadata?.turnReferences as number[]) ?? [],
      relevanceScore:
        (metadata?.score as number) ?? (doc as { score?: number }).score ?? -1,
    };
  });
}

/**
 * Populates embeddings for retrieved memories
 * Returns true on success, false on error (graceful degradation)
 */
async function populateMemoryEmbeddings(
  memories: RetrievedMemory[],
  embeddings: Embeddings
): Promise<boolean> {
  const texts = memories.map((m) => m.topicSummary);

  if (texts.length === 0) {
    return true;
  }

  try {
    const memEmbeddings = await embeddings.embedDocuments(texts);

    for (let i = 0; i < memories.length; i++) {
      const emb = memEmbeddings[i];
      if (emb) {
        memories[i].embedding = emb;
      }
    }

    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Hook Factory
// ============================================================================

/**
 * Creates a beforeModel hook for Retrospective Reflection
 *
 * This hook is responsible for:
 * 1. Extracting the query from the last human message
 * 2. Retrieving Top-K memories from the VectorStore
 * 3. Transforming results to RetrievedMemory format
 * 4. Incrementing the turn counter
 *
 * @param options - Configuration options
 * @returns Middleware with beforeModel hook
 *
 * @example
 * ```typescript
 * const beforeModel = createRetrospectiveBeforeModel({
 *   vectorStore,
 *   embeddings,
 *   topK: 20,
 * });
 *
 * const agent = createAgent({
 *   model,
 *   middleware: [beforeModel],
 * });
 * ```
 */
export function createRetrospectiveBeforeModel(options: BeforeModelOptions) {
  // Create lazy validator for embedding dimension (once per middleware instance)
  const embeddings = options.embeddings;

  // Apply defaults
  const topK = options.topK ?? 20;

  // Lazy validator state (created once, reused across calls)
  let validateOnce: (() => Promise<void>) | null = null;

  return {
    name: "rmm-before-model",

    beforeModel: async (
      state: BeforeModelState,
      _runtime: BeforeModelRuntime
    ): Promise<BeforeModelStateUpdate> => {
      // Lazy validate embedding dimension on first call
      if (!validateOnce) {
        const { createLazyValidator } = await import(
          "@/utils/embedding-validation"
        );
        validateOnce = createLazyValidator(embeddings);
      }
      await validateOnce();

      // Validate reranker weights have required properties
      const weights = state._rerankerWeights;
      if (!hasValidRerankerWeights(weights)) {
        logger.warn("Invalid reranker weights, skipping retrieval");
        // Preserve existing state
        return {
          _retrievedMemories: state._retrievedMemories ?? [],
          _turnCountInSession: (state._turnCountInSession ?? 0) + 1,
        };
      }

      // Preserve existing retrieved memories in case of error
      // Use shallow clone to prevent mutation of source arrays
      const existingMemories =
        state._retrievedMemories?.map((m) => ({ ...m })) ?? [];

      // Calculate turn counter increment (used in all paths)
      const newTurnCount = (state._turnCountInSession ?? 0) + 1;

      try {
        // Step 1: Extract query from last human message
        const query = extractLastHumanMessage(state.messages);

        // If no human message found, skip retrieval
        // Still increment turn counter and preserve existing memories
        if (!query) {
          return {
            _retrievedMemories: existingMemories,
            _turnCountInSession: newTurnCount,
          };
        }

        // Step 2: Retrieve Top-K memories from VectorStore
        const vs = options.vectorStore;
        const retrievedDocs = await vs.similaritySearch(query, topK);

        // Step 3: Transform to RetrievedMemory format
        const retrievedMemories = transformDocsToMemories(
          retrievedDocs,
          existingMemories
        );

        // Step 4: Populate embeddings for reranking (Equation 1: m'_i = m_i + W_m·m_i)
        // VectorStore.similaritySearch doesn't return embeddings, so we re-embed
        // each memory's topicSummary using the embeddings model.
        const embeddingsSuccess = await populateMemoryEmbeddings(
          retrievedMemories,
          embeddings
        );

        if (!embeddingsSuccess) {
          logger.warn(
            "Failed to embed memories, reranking will use relevance scores"
          );
        }

        return {
          _retrievedMemories: retrievedMemories,
          _turnCountInSession: newTurnCount,
        };
      } catch (error) {
        // Graceful degradation: continue without retrieval on error
        logger.warn(
          "Error during memory retrieval, continuing:",
          error instanceof Error ? error.message : String(error)
        );

        // Preserve existing memories and increment turn counter
        return {
          _retrievedMemories: existingMemories,
          _turnCountInSession: newTurnCount,
        };
      }
    },
  };
}

// ============================================================================
// Type Exports
// ============================================================================

/**
 * State update returned by the beforeModel hook
 */
export interface BeforeModelStateUpdate {
  /**
   * Retrieved memories from VectorStore
   */
  _retrievedMemories?: RetrievedMemory[];

  /**
   * Incremented turn counter
   */
  _turnCountInSession?: number;
}
