import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import { addMemory, mergeMemory } from "@/algorithms/memory-actions";
import { findSimilarMemories } from "@/algorithms/similarity-search";
import { parseUpdateActions } from "@/middleware/prompts/update-memory";
import type { MemoryEntry, RetrievedMemory } from "@/schemas/index";
import { getLogger } from "@/utils/logger";

const logger = getLogger("memory-update");

/**
 * Update action types for memory updates
 */
export type UpdateAction =
  | { action: "Add" }
  | { action: "Merge"; index: number; merged_summary: string };

/**
 * Decides whether to add a new memory or merge it with existing memories.
 *
 * This function implements the memory update decision logic of Prospective Reflection.
 * It takes a newly extracted memory, finds similar existing memories, and uses an LLM
 * to decide whether to add the new memory as a separate entry or merge it with
 * an existing memory.
 *
 * @param newMemory - The newly extracted MemoryEntry to evaluate
 * @param similarMemories - Array of similar existing memories retrieved from the memory bank
 * @param summarizationModel - LLM for making the add vs merge decision
 * @param updatePrompt - Prompt template function for memory update decisions
 * @returns Array of UpdateAction objects representing the decisions
 *
 * @example
 * ```typescript
 * const actions = await decideUpdateAction(
 *   newMemory,
 *   similarMemories,
 *   llm,
 *   updateMemory
 * );
 * ```
 */
export async function decideUpdateAction(
  newMemory: MemoryEntry,
  similarMemories: RetrievedMemory[],
  summarizationModel: BaseChatModel,
  updatePrompt: (historySummaries: string[], newSummary: string) => string
): Promise<UpdateAction[]> {
  try {
    // Step 1: Format similar memories as history summaries
    const historySummaries = similarMemories.map((mem) => mem.topicSummary);

    // Step 2: Build the update decision prompt
    const prompt = updatePrompt(historySummaries, newMemory.topicSummary);

    // Step 3: Call LLM with update decision prompt
    const response = await summarizationModel.invoke(prompt);
    const responseContent = response.text;

    // Step 4: Parse the update actions from the response
    const actions = parseUpdateActions(
      responseContent,
      historySummaries.length
    );

    return actions;
  } catch (error) {
    // Graceful degradation: return empty array on error
    logger.warn(
      "Error during update decision, returning empty array:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

/**
 * Processes a single memory through the merge/add decision pipeline.
 *
 * Implements Algorithm 1 lines 9-11 of the RMM paper:
 * 1. Find similar existing memories via similarity search
 * 2. Use LLM to decide Add (new entry) or Merge (with existing)
 * 3. Execute the decided action against the VectorStore
 *
 * If no similar memories are found, the memory is added directly.
 * If the LLM decision fails, falls back to adding the memory.
 *
 * @param memory - The newly extracted MemoryEntry to process
 * @param vectorStore - VectorStore for similarity search and storage
 * @param summarizationModel - LLM for making add/merge decisions
 * @param updatePrompt - Prompt template for update decisions
 */
export async function processMemoryUpdate(
  memory: MemoryEntry,
  vectorStore: VectorStoreInterface,
  summarizationModel: BaseChatModel,
  updatePrompt: (historySummaries: string[], newSummary: string) => string
): Promise<void> {
  // Step 1: Find similar memories in the memory bank
  const similarMemories = await findSimilarMemories(memory, vectorStore);

  // Step 2: If no similar memories, directly add
  if (similarMemories.length === 0) {
    await addMemory(memory, vectorStore);
    return;
  }

  // Step 3: Decide update action (Add or Merge)
  const actions = await decideUpdateAction(
    memory,
    similarMemories,
    summarizationModel,
    updatePrompt
  );

  // Step 4: Execute action
  // Paper-aligned behavior: one Add-or-Merge decision per extracted memory.
  // If multiple valid actions are returned, we keep only the first.
  if (actions.length === 0) {
    await addMemory(memory, vectorStore);
    return;
  }

  if (actions.length > 1) {
    logger.warn(
      `Received ${actions.length} update actions for one memory; applying first action only`
    );
  }

  const action = actions[0];
  if (!action) {
    await addMemory(memory, vectorStore);
    return;
  }

  if (action.action === "Merge") {
    const targetMemory = similarMemories[action.index];
    if (!targetMemory) {
      await addMemory(memory, vectorStore);
      return;
    }
    await mergeMemory(targetMemory, action.merged_summary, vectorStore);
    return;
  }

  await addMemory(memory, vectorStore);
}
