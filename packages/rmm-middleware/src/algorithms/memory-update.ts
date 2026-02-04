import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { parseUpdateActions } from "@/middleware/prompts/update-memory";
import type { MemoryEntry, RetrievedMemory } from "@/schemas/index";

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
    console.warn(
      "[memory-update] Error during update decision, returning empty array:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}
