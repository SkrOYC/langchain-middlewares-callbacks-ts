import { z } from "zod";

/**
 * Memory update prompt for Add/Merge decisions (Appendix D.1.2)
 *
 * Built-in, non-configurable prompt template that determines whether
 * to add new memory or merge with existing memories.
 */

/**
 * Update action types
 */
export type UpdateAction =
  | { action: "Add" }
  | { action: "Merge"; index: number; merged_summary: string };

/**
 * Regex pattern for parsing Merge actions
 * Uses [^)]+ to require at least one character in summary and avoid greedy matching
 */
const MERGE_ACTION_REGEX = /^Merge\((\d+),\s*([^)]+)\)$/;

/**
 * Output schema for update action (Appendix D.1.2)
 */
const AddActionSchema = z.literal("Add()");

const MergeActionSchema = z.string().regex(/^Merge\(\d+,\s*[^)]+\)$/);

const SingleActionSchema = z.union([AddActionSchema, MergeActionSchema]);

// Multiple actions on separate lines
// Pattern: action followed by newline followed by more actions
// Each action must have at least one character in the summary
const MultiActionSchema = z
  .string()
  .regex(
    /^((?:Merge\(\d+,\s*[^)]+\))|Add\(\))(\n((?:Merge\(\d+,\s*[^)]+\))|Add\(\)))*$/
  );

export const UpdateActionSchema = z.union([
  SingleActionSchema,
  MultiActionSchema,
]);

export type UpdateActionOutput = z.infer<typeof UpdateActionSchema>;

/**
 * Parse update actions from LLM output
 *
 * @param output - Raw LLM output containing actions
 * @param historyLength - Number of history summaries for bounds validation
 * @returns Parsed array of update actions with validated indices
 */
export function parseUpdateActions(
  output: string,
  historyLength = 0
): UpdateAction[] {
  if (!output.trim()) {
    return [];
  }

  const actions: UpdateAction[] = [];
  const lines = output.trim().split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine === "Add()") {
      actions.push({ action: "Add" });
    } else if (trimmedLine.startsWith("Merge(")) {
      // Parse Merge(index, merged_summary)
      const match = trimmedLine.match(MERGE_ACTION_REGEX);
      if (match) {
        const index = Number.parseInt(match[1], 10);
        // Validate index is within bounds
        if (index >= 0 && index < historyLength) {
          const merged_summary = match[2];
          actions.push({ action: "Merge", index, merged_summary });
        }
      }
    }
    // Note: Invalid lines are silently ignored. This is intentional - if the LLM
    // produces malformed output, we err on the side of not taking action.
    // Use validateUpdateActions() explicitly if you need to check validity.
  }

  return actions;
}

/**
 * Validation result for update actions
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate update actions from LLM output
 *
 * @param output - Raw LLM output containing actions
 * @param historyLength - Number of history summaries for bounds validation
 * @returns Validation result with any errors found
 */
export function validateUpdateActions(
  output: string,
  historyLength: number
): ValidationResult {
  const errors: string[] = [];

  if (!output.trim()) {
    return { isValid: true, errors: [] };
  }

  const lines = output.trim().split("\n");
  let hasValidAction = false;

  for (const [lineNumStr, line] of lines.entries()) {
    const lineNum = lineNumStr + 1;
    const trimmedLine = line.trim();

    if (trimmedLine === "Add()") {
      hasValidAction = true;
      continue;
    }

    if (trimmedLine.startsWith("Merge(")) {
      const match = trimmedLine.match(MERGE_ACTION_REGEX);
      if (!match) {
        errors.push(
          `Line ${lineNum}: Invalid Merge format. Expected: Merge(index, summary)`
        );
        continue;
      }

      const index = Number.parseInt(match[1], 10);
      if (index < 0 || index >= historyLength) {
        errors.push(
          `Line ${lineNum}: Merge index ${index} is out of bounds (history length: ${historyLength})`
        );
      }

      if (!match[2] || match[2].trim() === "") {
        errors.push(`Line ${lineNum}: Merge summary cannot be empty`);
      }

      hasValidAction = true;
      continue;
    }

    if (trimmedLine !== "") {
      errors.push(`Line ${lineNum}: Unknown action format "${trimmedLine}"`);
    }
  }

  return {
    isValid: errors.length === 0 && hasValidAction,
    errors,
  };
}

/**
 * Build the update memory prompt
 *
 * @param historySummaries - Array of existing personal summaries
 * @param newSummary - New personal summary to evaluate
 * @returns Formatted prompt string ready for LLM invocation
 */
export function updateMemory(
  historySummaries: string[],
  newSummary: string
): string {
  // Format history summaries as compact JSON
  const historyJson = JSON.stringify({ history_summaries: historySummaries });
  const newSummaryJson = JSON.stringify({ new_summary: newSummary });

  const prompt = `Task Description: Given a list of history personal summaries for a specific user and a new
and similar personal summary from the same user, update the personal history summaries
following the instructions below:

* Input format: Both the history personal summaries and the new personal summary
  are provided in JSON format, with the top-level keys of "history_summaries" and
  "new_summary".
* Possible update actions:
  – Add: If the new personal summary is not relevant to any history personal summary,
    add it.
    Format: Add()
  – Merge: If the new personal summary is relevant to a history personal summary,
    merge them as an updated summary.
    Format: Merge(index, merged_summary)
    Note: index is the position of the relevant history summary in the list.
    merged_summary is the merged summary of the new summary and the relevant history
    summary. Two summaries are considered relevant if they discuss the same aspect
    of the user's personal information or experiences.
* If multiple actions need to be executed, output each action in a single line, and
  separate them with a newline character ("\\n").
* Do not include additional explanations or examples in the output—only return the
  required action functions.

Example:
INPUT:
* History Personal Summaries:
  – {"history_summaries": ["SPEAKER_1 works out although he doesn't particularly enjoy it."]}
* New Personal Summary:
  – {"new_summary": "SPEAKER_1 exercises every Monday and Thursday."}

OUTPUT ACTION:
Merge(0, SPEAKER_1 exercises every Monday and Thursday, although he doesn't particularly enjoy it.)

Task: Follow the example format above to update the personal history for the given case.
INPUT:
* History Personal Summaries:
  – ${historyJson}
* New Personal Summary:
  – ${newSummaryJson}

OUTPUT ACTION:
`;

  return prompt;
}
