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
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import {
  applyEmbeddingAdaptation,
  computeRelevanceScore,
  gumbelSoftmaxSample,
  type ScoredMemory,
} from "@/algorithms/reranking";
import type { CitationRecord, RerankerState, RetrievedMemory } from "@/schemas";
import {
  type CitationResult,
  extractCitations,
} from "@/utils/citation-extractor";
import { getLogger } from "@/utils/logger";
import {
  extractLastHumanMessage,
  formatMemoriesBlock,
} from "@/utils/memory-helpers";

const logger = getLogger("wrap-model-call");

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

  /**
   * Embedding dimension for reranker matrices
   */
  embeddingDimension: number;
}

/**
 * Runtime interface for wrapModelCall hook
 *
 * Note: embeddings is passed via options, not runtime.context.
 * The _citations field is populated by this hook for downstream use.
 * For exact REINFORCE, we also store embeddings and probabilities.
 */
interface WrapModelCallRuntime {
  context: {
    embeddings?: Embeddings; // May be set by other hooks
    _citations?: CitationRecord[];
    // Exact REINFORCE gradient computation data
    _originalQuery?: number[]; // Original query embedding q
    _adaptedQuery?: number[]; // Adapted query embedding q'
    _originalMemoryEmbeddings?: number[][]; // Original memory embeddings m_i for all K
    _adaptedMemoryEmbeddings?: number[][]; // Adapted memory embeddings m'_i for all K
    _samplingProbabilities?: number[]; // P_i for all K memories
    _selectedIndices?: number[]; // Indices of Top-M selected memories
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
// Helper Functions
// ============================================================================

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
  // Create lazy validator for embedding dimension
  const embeddings = options.embeddings;
  const embeddingDimension = options.embeddingDimension;

  // Lazy validator state (created once, reused across calls)
  let validateOnce: (() => Promise<void>) | null = null;

  return {
    name: "rmm-wrap-model-call",

    wrapModelCall: async (
      request: ModelRequest,
      handler: (
        request: ModelRequest
      ) => Promise<{ content: string; text: string }>
    ): Promise<{ content: string; text: string }> => {
      const { state, runtime } = request;

      // Lazy validate embedding dimension on first call
      if (!validateOnce) {
        const { createLazyValidator } = await import(
          "@/utils/embedding-validation"
        );
        validateOnce = createLazyValidator(embeddings);
      }
      await validateOnce();

      const memories = state._retrievedMemories;

      // If no memories to process, call handler directly
      if (!memories || memories.length === 0) {
        return handler(request);
      }

      try {
        const reranker = state._rerankerWeights;

        // Validate reranker weights exist
        if (
          !(
            reranker?.weights?.queryTransform &&
            reranker.weights?.memoryTransform &&
            reranker.config
          )
        ) {
          logger.warn("Invalid reranker weights, skipping reranking");
          return handler(request);
        }

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
        const samplingResult = gumbelSoftmaxSample(
          scoredMemories,
          reranker.config.topM,
          reranker.config.temperature
        );

        const selectedMemories = samplingResult.selectedMemories;
        const allProbabilities = samplingResult.allProbabilities;
        const selectedIndices = samplingResult.selectedIndices;

        // Store embeddings and probabilities for exact REINFORCE in afterModel
        // Store original query embedding
        runtime.context._originalQuery = queryEmbedding;

        // Store adapted query embedding (q')
        runtime.context._adaptedQuery = adaptedQuery;

        // Store all original memory embeddings for K retrieved memories
        // This requires re-applying adaptation to memories that may not have embeddings
        const originalMemEmbeddings: number[][] = [];
        const adaptedMemEmbeddings: number[][] = [];

        for (const memory of memories) {
          if (memory.embedding && memory.embedding.length > 0) {
            // Memory has embedding, store original
            originalMemEmbeddings.push(memory.embedding);

            // Compute adapted embedding
            const adapted = applyEmbeddingAdaptation(
              memory.embedding,
              reranker.weights.memoryTransform
            );
            adaptedMemEmbeddings.push(adapted);
          } else {
            // Memory doesn't have embedding - this shouldn't happen for exact REINFORCE
            // Create zero embedding as placeholder
            logger.warn(
              `Memory ${memory.id} missing embedding, using zero vector.`
            );
            const zeroEmbedding = new Array(embeddingDimension).fill(0);
            originalMemEmbeddings.push(zeroEmbedding);

            const adapted = applyEmbeddingAdaptation(
              zeroEmbedding,
              reranker.weights.memoryTransform
            );
            adaptedMemEmbeddings.push(adapted);
          }
        }

        runtime.context._originalMemoryEmbeddings = originalMemEmbeddings;
        runtime.context._adaptedMemoryEmbeddings = adaptedMemEmbeddings;

        // Store sampling probabilities for all K memories
        runtime.context._samplingProbabilities = allProbabilities;

        // Store selected indices
        runtime.context._selectedIndices = selectedIndices;

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
        // Extended to all K memories for exact REINFORCE
        const citations = extractCitationsFromResponse(
          response.content,
          selectedMemories,
          memories,
          selectedIndices
        );

        // Step 8: Store citations in runtime context for afterModel
        // The afterModel hook will use these for RL weight updates
        runtime.context._citations = citations;

        return response;
      } catch (error) {
        // Graceful degradation: call handler normally on error
        logger.warn(
          "Error during reranking, calling handler normally:",
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
 * Parses citation result and returns set of valid cited indices
 */
function parseCitedIndices(
  citationResult: CitationResult,
  selectedMemories: RetrievedMemory[]
): Set<number> {
  if (
    citationResult.type === "no_cite" ||
    citationResult.type === "malformed"
  ) {
    return new Set<number>();
  }

  const citedIndices = new Set<number>();
  const maxIndex = selectedMemories.length - 1;
  const allIndices = citationResult.indices ?? [];

  for (const idx of allIndices) {
    if (typeof idx === "number" && idx >= 0 && idx <= maxIndex) {
      citedIndices.add(idx);
    } else {
      logger.warn(
        `LLM returned out-of-bounds citation index: ${idx} (valid: 0-${maxIndex})`
      );
    }
  }

  return citedIndices;
}

/**
 * Builds mapping from global K index to selected position
 */
function buildGlobalToSelectedMapping(
  selectedIndices: number[]
): Map<number, number> {
  const mapping = new Map<number, number>();
  for (
    let selectedPos = 0;
    selectedPos < selectedIndices.length;
    selectedPos++
  ) {
    const globalIdx = selectedIndices[selectedPos];
    if (globalIdx !== undefined) {
      mapping.set(globalIdx, selectedPos);
    }
  }
  return mapping;
}

/**
 * Creates a citation record for a single memory
 */
function createCitationRecord(
  memoryId: string,
  turnIndex: number,
  _isSelected: boolean,
  wasCited: boolean
): CitationRecord {
  return {
    memoryId,
    cited: wasCited,
    reward: wasCited ? 1 : -1,
    turnIndex,
  };
}

/**
 * Extracts citation records from LLM response
 *
 * Parses citation format from Appendix D.2:
 * - [0, 2, 4]: Cited memories get +1 reward
 * - [NO_CITE]: All memories get -1 reward
 * - malformed: Empty array (RL update aborted)
 *
 * For exact REINFORCE, extends rewards to all K retrieved memories:
 * - Selected + cited: +1
 * - Selected + not cited: -1
 * - Not selected: -1 (implicitly not useful)
 *
 * @param responseContent - LLM response text
 * @param selectedMemories - Memories sent to LLM (Top-M)
 * @param allMemories - All retrieved memories (Top-K)
 * @param selectedIndices - Indices of selected memories in allMemories
 * @returns Array of citation records for all K memories
 */
function extractCitationsFromResponse(
  responseContent: string,
  selectedMemories: RetrievedMemory[],
  allMemories: RetrievedMemory[],
  selectedIndices: number[]
): CitationRecord[] {
  const citationResult: CitationResult = extractCitations(responseContent);

  if (citationResult.type === "malformed") {
    logger.warn("Malformed citation format in response, RL update aborted");
    return [];
  }

  const citedIndicesInSelection = parseCitedIndices(
    citationResult,
    selectedMemories
  );
  const globalToSelectedPosition =
    buildGlobalToSelectedMapping(selectedIndices);

  const k = allMemories.length;
  const citations: CitationRecord[] = [];

  for (let i = 0; i < k; i++) {
    const memoryId = allMemories[i]?.id ?? `memory-${i}`;
    const isSelected = selectedIndices.includes(i);

    if (!isSelected) {
      citations.push(createCitationRecord(memoryId, i, false, false));
      continue;
    }

    const selectedPosition = globalToSelectedPosition.get(i);
    const wasCited =
      selectedPosition !== undefined &&
      citedIndicesInSelection.has(selectedPosition);
    citations.push(createCitationRecord(memoryId, i, true, wasCited));
  }

  return citations;
}
