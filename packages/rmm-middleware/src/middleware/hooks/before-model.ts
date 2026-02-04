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
import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import type {
  BaseMessage,
  CitationRecord,
  RerankerState,
  RetrievedMemory,
} from "@/schemas";
import { extractLastHumanMessage } from "@/utils/memory-helpers";

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
  // Apply defaults
  const topK = options.topK ?? 20;

  return {
    name: "rmm-before-model",

    beforeModel: async (
      state: BeforeModelState,
      _runtime: BeforeModelRuntime
    ): Promise<BeforeModelStateUpdate> => {
      // Validate reranker weights have required properties
      const weights = state._rerankerWeights;
      if (
        !(
          weights?.weights?.queryTransform &&
          weights.weights.memoryTransform &&
          weights.config
        )
      ) {
        console.warn(
          "[before-model] Invalid reranker weights, skipping retrieval"
        );
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
        // Note: embedding is not populated because VectorStore.similaritySearch
        // doesn't return embeddings by default. wrap-model-call handles this
        // by using relevanceScore as a fallback. For embedding adaptation to
        // work, embeddings must be stored in VectorStore metadata.
        const retrievedMemories: RetrievedMemory[] = retrievedDocs.map(
          (doc, index) => {
            const metadata = doc.metadata as
              | Record<string, unknown>
              | undefined;

            return {
              id: (metadata?.id as string) ?? `memory-${index}`,
              topicSummary: doc.pageContent,
              rawDialogue: (metadata?.rawDialogue as string) ?? "",
              timestamp: (metadata?.timestamp as number) ?? Date.now(),
              sessionId: (metadata?.sessionId as string) ?? "unknown",
              turnReferences: (metadata?.turnReferences as number[]) ?? [],
              relevanceScore:
                (metadata?.score as number) ??
                (doc as { score?: number }).score ??
                -1,
              // embedding: not populated (see comment above)
            };
          }
        );

        return {
          _retrievedMemories: retrievedMemories,
          _turnCountInSession: newTurnCount,
        };
      } catch (error) {
        // Graceful degradation: continue without retrieval on error
        console.warn(
          "[before-model] Error during memory retrieval, continuing:",
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
interface BeforeModelStateUpdate {
  /**
   * Retrieved memories from VectorStore
   */
  _retrievedMemories?: RetrievedMemory[];

  /**
   * Incremented turn counter
   */
  _turnCountInSession?: number;
}
