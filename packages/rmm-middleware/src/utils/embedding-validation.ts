import type { Embeddings } from "@langchain/core/embeddings";
import { getLogger } from "@/utils/logger";
import { ConfigurationError } from "./configuration-error";

const logger = getLogger("embedding-validation");

/**
 * Validates that embeddings produce vectors of the correct dimension
 *
 * RMM requires 1536-dimensional embeddings (matching OpenAI ada-002).
 * This validation ensures reranker weights are compatible with embeddings.
 *
 * Validation is performed lazily on first call to allow:
 * - Testing with mock embeddings that don't implement embedQuery
 * - Creating middleware before actual embeddings are available
 * - Network transient errors to be handled gracefully
 *
 * @param embeddings - Embeddings instance to validate
 * @param expectedDimension - Expected embedding dimension (default: 1536)
 * @throws ConfigurationError if dimension doesn't match
 *
 * @example
 * ```typescript
 * await validateEmbeddingDimension(openaiEmbeddings);
 * ```
 */
export async function validateEmbeddingDimension(
  embeddings: Embeddings,
  expectedDimension = 1536
): Promise<void> {
  // Skip validation if embedQuery is not implemented (e.g., mock)
  if (typeof embeddings.embedQuery !== "function") {
    console.debug(
      "[embedding-validation] Skipping validation - embedQuery not implemented (likely mock)"
    );
    return;
  }

  try {
    const testVector = await embeddings.embedQuery("Dimension validation test");

    if (testVector.length !== expectedDimension) {
      throw new ConfigurationError(
        `Embedding dimension mismatch: expected ${expectedDimension}, got ${testVector.length}`
      );
    }
  } catch (error) {
    // Re-throw ConfigurationError (dimension mismatch)
    if (error instanceof ConfigurationError) {
      throw error;
    }

    // Other errors (network, timeouts, etc.) - log and continue
    // This allows graceful degradation when embeddings service is temporarily unavailable
    logger.warn(
      "Skipping validation due to error:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Creates a lazy validation function for embedding dimension
 *
 * This factory function creates a closure that tracks validation state,
 * ensuring dimension validation only happens once per middleware instance.
 *
 * @param embeddings - Embeddings instance to validate
 * @returns Validation function that performs lazy validation
 *
 * @example
 * ```typescript
 * const validateOnce = createLazyValidator(embeddings);
 *
 * return {
 *   beforeModel: async (state) => {
 *     await validateOnce();  // Validates only on first call
 *     // ... rest of hook
 *   }
 * };
 * ```
 */
export function createLazyValidator(
  embeddings: Embeddings
): () => Promise<void> {
  let validated = false;

  return async function validateOnce(): Promise<void> {
    if (!validated) {
      await validateEmbeddingDimension(embeddings);
      validated = true;
    }
  };
}
