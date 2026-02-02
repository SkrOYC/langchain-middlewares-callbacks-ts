/**
 * Citation extraction for RMM (Reflective Memory Management) algorithms.
 *
 * Parses LLM response citations to generate reward signals for REINFORCE:
 * - [i,j,k]: indices of useful memories from Top-M set
 * - [NO_CITE]: no useful memories (all receive R = -1)
 * - malformed: invalid format
 *
 * Per paper Appendix D.2 citation output formats.
 */

/**
 * Result type for citation extraction
 */
export interface CitationResult {
  /** Type of citation result */
  type: "cited" | "no_cite" | "malformed";
  /** Memory indices (0-based, relative to Top-M set) - only present for 'cited' type */
  indices?: number[];
}

/**
 * Regex pattern for citation extraction.
 *
 * Matches:
 * - [i,j,k] - comma-separated integers
 * - [NO_CITE] - special no-citation marker
 * - Handles whitespace: [ 0 , 1 , 2 ]
 *
 * Pattern breakdown:
 * - \[ - opening bracket
 * - ( - start capture group
 * - [\d,\s]+ - one or more digits, commas, or whitespace
 * - | - OR
 * - NO_CITE - literal NO_CITE string
 * - ) - end capture group
 * - \] - closing bracket
 */
const CITATION_REGEX = /\[([\d,\s]+|NO_CITE)\]/;

/**
 * Extracts citations from LLM response text.
 *
 * Parses citation formats per paper Appendix D.2:
 * - Valid: [0, 2, 4], [NO_CITE], [3], [ 0 , 2 ]
 * - Invalid: [abc], [0,, 2], [], missing brackets
 *
 * Returns first citation found if multiple present.
 *
 * @param response - LLM response text
 * @returns CitationResult with type and optional indices
 */
export function extractCitations(response: string): CitationResult {
  // Handle empty input
  if (!response || response.trim().length === 0) {
    return { type: "malformed" };
  }

  // Match citation pattern
  const match = CITATION_REGEX.exec(response);
  if (!match) {
    return { type: "malformed" };
  }

  const captured = match[1];
  if (!captured) {
    return { type: "malformed" };
  }

  // Handle NO_CITE case
  if (captured === "NO_CITE") {
    return { type: "no_cite" };
  }

  // Parse comma-separated integers
  const parts = captured.split(",");
  const indices: number[] = [];

  for (const part of parts) {
    const trimmed = part.trim();

    // Skip empty parts (handle cases like "0,,1" or trailing comma)
    if (trimmed.length === 0) {
      return { type: "malformed" };
    }

    // Parse integer
    const num = Number(trimmed);

    // Validate it's a valid non-negative integer
    if (!(Number.isFinite(num) && Number.isInteger(num)) || num < 0) {
      return { type: "malformed" };
    }

    indices.push(num);
  }

  // Validate we got at least one index
  if (indices.length === 0) {
    return { type: "malformed" };
  }

  return { type: "cited", indices };
}

/**
 * Validates that citation indices are within valid bounds.
 *
 * Requirements:
 * - All indices must be in range [0, topM - 1]
 * - No duplicate indices allowed
 *
 * @param indices - Array of memory indices
 * @param topM - Maximum number of memories in Top-M set
 * @returns true if valid, false otherwise
 */
export function validateCitations(indices: number[], topM: number): boolean {
  // Empty array is valid (no citations)
  if (indices.length === 0) {
    return true;
  }

  // Check for duplicates using Set
  const uniqueIndices = new Set(indices);
  if (uniqueIndices.size !== indices.length) {
    return false;
  }

  // Validate each index is within bounds [0, topM - 1]
  for (const idx of indices) {
    // Must be non-negative integer less than topM
    if (!Number.isInteger(idx) || idx < 0 || idx >= topM) {
      return false;
    }
  }

  return true;
}
