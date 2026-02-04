import type { BaseStore } from "@langchain/langgraph-checkpoint";
import {
  createMetadataStorage,
  type MetadataStorage,
} from "./metadataStorage.ts";
import { createWeightStorage, type WeightStorage } from "./weightStorage.ts";

export type { MetadataStorage } from "./metadataStorage.ts";
export type { WeightStorage } from "./weightStorage.ts";

/**
 * Creates both storage adapters for the given BaseStore instance
 * @param store - BaseStore instance from @langchain/langgraph-checkpoint
 * @returns Object containing weights and metadata storage adapters
 */
export function createStorageAdapters(store: BaseStore): {
  weights: WeightStorage;
  metadata: MetadataStorage;
} {
  return {
    weights: createWeightStorage(store),
    metadata: createMetadataStorage(store),
  };
}
