import type { BaseStore } from "@langchain/langgraph-checkpoint";
import {
  createEmptyGradientAccumulatorState,
  type GradientAccumulatorState,
  GradientAccumulatorStateSchema,
  type GradientSample,
} from "@/schemas/index";

/**
 * GradientStorage interface for persisting gradient accumulator state to BaseStore
 * Supports exact REINFORCE gradient accumulation across turns (batch size = 4)
 */
export interface GradientStorage {
  /**
   * Load gradient accumulator state for a user from BaseStore
   * @param userId - The user identifier
   * @returns GradientAccumulatorState or null if not found/invalid
   */
  load(userId: string): Promise<GradientAccumulatorState | null>;

  /**
   * Save gradient accumulator state for a user to BaseStore
   * @param userId - The user identifier
   * @param state - The gradient accumulator state to persist
   * @returns true on success, false on failure
   */
  save(userId: string, state: GradientAccumulatorState): Promise<boolean>;

  /**
   * Add a gradient sample to the accumulator and persist
   * Automatically manages batch size limits (max 4 samples)
   * @param userId - The user identifier
   * @param sample - The gradient sample to add
   * @returns Updated GradientAccumulatorState or null on failure
   */
  addSample(
    userId: string,
    sample: GradientSample
  ): Promise<GradientAccumulatorState | null>;

  /**
   * Clear the gradient accumulator for a user
   * @param userId - The user identifier
   * @returns true on success, false on failure
   */
  clear(userId: string): Promise<boolean>;
}

/**
 * Creates a GradientStorage adapter for the given BaseStore instance
 * @param store - BaseStore instance from @langchain/langgraph-checkpoint
 * @returns GradientStorage implementation
 */
export function createGradientStorage(store: BaseStore): GradientStorage {
  const NAMESPACE_KEY = "gradient" as const;

  const buildNamespace = (userId: string): string[] => [
    "rmm",
    userId,
    "gradients",
  ];

  return {
    async load(userId: string): Promise<GradientAccumulatorState | null> {
      try {
        const namespace = buildNamespace(userId);
        const item = await store.get(namespace, NAMESPACE_KEY);

        if (item === null || item === undefined) {
          return null;
        }

        // Validate the data against schema
        const parseResult = GradientAccumulatorStateSchema.safeParse(
          item.value
        );

        if (!parseResult.success) {
          return null;
        }

        return parseResult.data;
      } catch {
        // Graceful degradation: return null on any error
        return null;
      }
    },

    async save(
      userId: string,
      state: GradientAccumulatorState
    ): Promise<boolean> {
      try {
        const namespace = buildNamespace(userId);

        // Validate state before saving
        const validationResult =
          GradientAccumulatorStateSchema.safeParse(state);
        if (!validationResult.success) {
          return false;
        }

        // Prepare value with timestamp
        const value = {
          ...validationResult.data,
          lastUpdated: Date.now(),
        };

        await store.put(namespace, NAMESPACE_KEY, value);
        return true;
      } catch {
        // Graceful degradation: return false on any error
        return false;
      }
    },

    async addSample(
      userId: string,
      sample: GradientSample
    ): Promise<GradientAccumulatorState | null> {
      try {
        // Load existing state or create new one
        const existingState = await this.load(userId);
        const state = existingState ?? createEmptyGradientAccumulatorState();

        // Validate sample before adding
        const sampleValidation =
          GradientAccumulatorStateSchema.shape.samples.element.safeParse(
            sample
          );
        if (!sampleValidation.success) {
          return null;
        }

        // Add sample to the accumulator
        const updatedState: GradientAccumulatorState = {
          ...state,
          samples: [...state.samples, sample],
          lastUpdated: Date.now(),
        };

        // Persist the updated state
        const saved = await this.save(userId, updatedState);
        if (!saved) {
          return null;
        }

        return updatedState;
      } catch {
        // Graceful degradation: return null on any error
        return null;
      }
    },

    async clear(userId: string): Promise<boolean> {
      try {
        const namespace = buildNamespace(userId);
        const emptyState = createEmptyGradientAccumulatorState();

        // Validate empty state before saving
        const validationResult =
          GradientAccumulatorStateSchema.safeParse(emptyState);
        if (!validationResult.success) {
          return false;
        }

        await store.put(namespace, NAMESPACE_KEY, validationResult.data);
        return true;
      } catch {
        // Graceful degradation: return false on any error
        return false;
      }
    },
  };
}
