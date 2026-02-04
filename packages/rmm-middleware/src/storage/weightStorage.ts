import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { type RerankerState, RerankerStateSchema } from "../schemas/index.ts";

/**
 * WeightStorage interface for persisting reranker weights to BaseStore
 */
export interface WeightStorage {
  /**
   * Load reranker weights for a user from BaseStore
   * @param userId - The user identifier
   * @returns RerankerState or null if not found/invalid
   */
  loadWeights(userId: string): Promise<RerankerState | null>;

  /**
   * Save reranker weights for a user to BaseStore
   * @param userId - The user identifier
   * @param weights - The reranker state to persist
   * @returns true on success, false on failure
   */
  saveWeights(userId: string, weights: RerankerState): Promise<boolean>;
}

/**
 * Creates a WeightStorage adapter for the given BaseStore instance
 * @param store - BaseStore instance from @langchain/langgraph-checkpoint
 * @returns WeightStorage implementation
 */
export function createWeightStorage(store: BaseStore): WeightStorage {
  const NAMESPACE_KEY = "reranker" as const;

  const buildNamespace = (userId: string): string[] => [
    "rmm",
    userId,
    "weights",
  ];

  return {
    async loadWeights(userId: string): Promise<RerankerState | null> {
      try {
        const namespace = buildNamespace(userId);
        const item = await store.get(namespace, NAMESPACE_KEY);

        if (item === null || item === undefined) {
          return null;
        }

        // BaseStore returns an Item object with a value property
        const rawValue =
          typeof item === "object" && "value" in item
            ? (item.value as unknown)
            : item;

        if (rawValue === null || rawValue === undefined) {
          return null;
        }

        // Validate the data against schema
        const parseResult = RerankerStateSchema.safeParse(rawValue);

        if (!parseResult.success) {
          return null;
        }

        return parseResult.data;
      } catch {
        // Graceful degradation: return null on any error
        return null;
      }
    },

    async saveWeights(
      userId: string,
      weights: RerankerState
    ): Promise<boolean> {
      try {
        const namespace = buildNamespace(userId);

        // Validate weights before saving
        const validationResult = RerankerStateSchema.safeParse(weights);
        if (!validationResult.success) {
          return false;
        }

        // Prepare value with timestamp for debugging
        const value = {
          ...validationResult.data,
          updatedAt: Date.now(),
        };

        await store.put(namespace, NAMESPACE_KEY, value);
        return true;
      } catch {
        // Graceful degradation: return false on any error
        return false;
      }
    },
  };
}
