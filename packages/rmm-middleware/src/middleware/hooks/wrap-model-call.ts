/**
 * wrapModelCall hook for Retrospective Reflection
 *
 * Performs reranking and memory injection for model calls:
 * 1. Embeds the query using the embeddings model
 * 2. Applies embedding adaptation (Equation 1): q' = q + W_q · q
 * 3. Computes relevance scores via dot product: s_i = q'^T · m'_i
 * 4. Performs Gumbel-Softmax sampling (Equation 2) for Top-M selection
 * 5. Creates ephemeral HumanMessage with selected memories
 * 6. Calls handler with augmented messages
 * 7. Extracts citations from LLM response
 * 8. Stores citations with rewards (+1 cited, -1 not cited) in runtime context
 *
 * RL Weight Updates: Deferred to afterModel hook (not implemented in this PR).
 * Citations stored in runtime.context._citations for downstream processing.
 *
 * Per Appendix F.8: Uses ephemeral HumanMessage (NOT system message)
 */

import type { Embeddings } from "@langchain/core/embeddings";
import { HumanMessage } from "@langchain/core/messages";
import {
  applyEmbeddingAdaptation,
  computeRelevanceScore,
  gumbelSoftmaxSample,
  type ScoredMemory,
} from "@/algorithms/reranking";
import type {
  BaseMessage,
  CitationRecord,
  RerankerState,
  RetrievedMemory,
} from "@/schemas";
import {
  type CitationResult,
  extractCitations,
} from "@/utils/citation-extractor";
import {
  extractLastHumanMessage,
  formatMemoriesBlock,
} from "@/utils/memory-helpers";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration options for the wrapModelCall hook
 */
export interface WrapModelCallOptions {
  /**
   * Embeddings instance for query encoding
   */
  embeddings: Embeddings;
}

/**
 * Runtime interface for wrapModelCall hook
 *
 * Note: embeddings is passed via options, not runtime.context.
 * The _citations field is populated by this hook for downstream use.
 */
interface WrapModelCallRuntime {
  context: {
    embeddings?: Embeddings; // May be set by other hooks
    _citations?: CitationRecord[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * State interface for wrapModelCall hook
 */
interface WrapModelCallState {
  messages: BaseMessage[];
  _rerankerWeights: RerankerState;
  _retrievedMemories: RetrievedMemory[];
  _citations: CitationRecord[];
  _turnCountInSession: number;
}

/**
 * Model request interface
 */
interface ModelRequest {
  messages: BaseMessage[];
  state: WrapModelCallState;
  runtime: WrapModelCallRuntime;
  [key: string]: unknown;
}

// ============================================================================
// Hook Factory
// ============================================================================

/**
 * Creates a wrapModelCall hook for Retrospective Reflection
 *
 * This hook is responsible for:
 * 1. Reranking retrieved memories using learned weights
 * 2. Injecting selected memories into model context
 * 3. Extracting citations and computing rewards
 *
 * @param options - Configuration options
 * @returns Middleware with wrapModelCall hook
 *
 * @example
 * ```typescript
 * const wrapModelCall = createRetrospectiveWrapModelCall({
 *   embeddings,
 * });
 *
 * const agent = createAgent({
 *   model,
 *   middleware: [wrapModelCall],
 * });
 * ```
 */
export function createRetrospectiveWrapModelCall(
  options: WrapModelCallOptions
) {
  return {
    name: "rmm-wrap-model-call",

    wrapModelCall: async (
      request: ModelRequest,
      handler: (
        request: ModelRequest
      ) => Promise<{ content: string; text: string }>
    ): Promise<{ content: string; text: string }> => {
      const { state, runtime } = request;
      const memories = state._retrievedMemories;

      // If no memories to process, call handler directly
      if (!memories || memories.length === 0) {
        return handler(request);
      }

      try {
        const reranker = state._rerankerWeights;

        // Step 1: Extract query and embed it
        const query = extractLastHumanMessage(state.messages);
        if (!query) {
          // No query, call handler normally
          return handler(request);
        }

        const queryEmbedding = await options.embeddings.embedQuery(query);

        // Step 2: Apply embedding adaptation (Equation 1)
        // q' = q + W_q · q
        const adaptedQuery = applyEmbeddingAdaptation(
          queryEmbedding,
          reranker.weights.queryTransform
        );

        // Step 3: Score memories via dot product
        // s_i = q'^T · m'_i
        const scoredMemories: ScoredMemory[] = memories.map((memory) => {
          let rerankScore = 0;

          if (memory.embedding && memory.embedding.length > 0) {
            // Apply adaptation to memory embedding if available
            const adaptedMemory = applyEmbeddingAdaptation(
              memory.embedding,
              reranker.weights.memoryTransform
            );
            rerankScore = computeRelevanceScore(adaptedQuery, adaptedMemory);
          } else {
            // Fallback to relevance score from retrieval
            rerankScore = memory.relevanceScore ?? 0;
          }

          return {
            ...memory,
            rerankScore,
          };
        });

        // Step 4: Gumbel-Softmax sampling (Equation 2)
        // Select Top-M memories using stochastic sampling
        const selectedMemories = gumbelSoftmaxSample(
          scoredMemories,
          reranker.config.topM,
          reranker.config.temperature
        );

        // Step 5: Create ephemeral HumanMessage with formatted memories
        // Per Appendix F.8: Use HumanMessage, NOT system message
        const memoryBlock = formatMemoriesBlock(selectedMemories);
        const ephemeralMessage = new HumanMessage({
          content: memoryBlock,
        });

        // Step 6: Call handler with augmented messages
        const augmentedMessages = [...state.messages, ephemeralMessage];
        const response = await handler({
          ...request,
          messages: augmentedMessages,
        });

        // Step 7: Extract citations from response
        // Per Appendix D.2: [0, 2] or [NO_CITE] format
        const citations = extractCitationsFromResponse(
          response.content,
          selectedMemories
        );

        // Step 8: Store citations in runtime context for afterModel
        // The afterModel hook will use these for RL weight updates
        runtime.context._citations = citations;

        return response;
      } catch (error) {
        // Graceful degradation: call handler normally on error
        console.warn(
          "[wrap-model-call] Error during reranking, calling handler normally:",
          error instanceof Error ? error.message : String(error)
        );

        return handler(request);
      }
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extracts citation records from LLM response
 *
 * Parses citation format from Appendix D.2:
 * - [0, 2, 4]: Cited memories get +1 reward
 * - [NO_CITE]: All memories get -1 reward
 * - malformed: Empty array (RL update aborted)
 *
 * @param responseContent - LLM response text
 * @param selectedMemories - Memories sent to LLM
 * @returns Array of citation records for RL update
 */
function extractCitationsFromResponse(
  responseContent: string,
  selectedMemories: RetrievedMemory[]
): CitationRecord[] {
  // Extract citations using existing utility
  const citationResult: CitationResult = extractCitations(responseContent);

  // Handle malformed citations
  if (citationResult.type === "malformed") {
    // Will abort RL update in afterModel (empty citations)
    return [];
  }

  // Handle NO_CITE case
  if (citationResult.type === "no_cite") {
    // All selected memories get -1 reward (not useful)
    return selectedMemories.map((memory, index) => ({
      memoryId: memory.id,
      cited: false,
      reward: -1,
      turnIndex: index,
    }));
  }

  // Handle valid citations
  // citedSet contains indices of memories the LLM found useful
  // Validate indices are within valid range for selectedMemories
  const maxIndex = selectedMemories.length - 1;
  const allIndices = citationResult.indices ?? [];
  const outOfBoundsCount = allIndices.filter(
    (i) => typeof i === "number" && (i < 0 || i > maxIndex)
  ).length;

  // Warn about out-of-bounds citations
  if (outOfBoundsCount > 0) {
    console.warn(
      `[wrap-model-call] LLM returned ${outOfBoundsCount} out-of-bounds citation indices (valid: 0-${maxIndex}), filtering...`
    );
  }

  const validIndices = allIndices.filter(
    (i): i is number => typeof i === "number" && i >= 0 && i <= maxIndex
  );
  const citedSet = new Set(validIndices);

  return selectedMemories.map((memory, index) => ({
    memoryId: memory.id,
    cited: citedSet.has(index),
    reward: citedSet.has(index) ? 1 : -1,
    turnIndex: index,
  }));
}
