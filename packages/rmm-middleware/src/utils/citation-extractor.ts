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
 * Matches any content within square brackets (global flag to find all groups).
 * The parser validates the content (digits/commas or NO_CITE).
 *
 * Security note: Using [^\]]* instead of [\d,\s]+ prevents ReDoS
 * attacks via catastrophic backtracking on malicious input.
 */
const CITATION_REGEX = /\[([^\]]*)\]/g;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Checks if response is empty or whitespace only
 */
function isEmptyResponse(response: string): boolean {
  return !response || response.trim().length === 0;
}

/**
 * Finds all bracket groups in response
 */
function findBracketGroups(response: string): RegExpMatchArray[] {
  return [...response.matchAll(CITATION_REGEX)];
}

/**
 * Checks if any group contains NO_CITE marker
 */
function hasNoCiteMarker(matches: RegExpMatchArray[]): boolean {
  return matches.some((match) => match[1] === "NO_CITE");
}

/**
 * Parses a single bracket group and returns indices or null if malformed
 */
function parseIndicesFromGroup(captured: string): number[] | null {
  const parts = captured.split(",");

  const indices: number[] = [];

  for (const part of parts) {
    const trimmed = part.trim();

    // Skip empty parts (handle cases like "0,,1" or trailing comma)
    if (trimmed.length === 0) {
      return null;
    }

    // Parse integer
    const num = Number(trimmed);

    // Validate it's a valid non-negative integer
    if (!(Number.isFinite(num) && Number.isInteger(num)) || num < 0) {
      return null;
    }

    indices.push(num);
  }

  return indices;
}

/**
 * Deduplicates indices while preserving order
 */
function deduplicateIndices(indices: number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];

  for (const idx of indices) {
    if (!seen.has(idx)) {
      seen.add(idx);
      result.push(idx);
    }
  }

  return result;
}

// ============================================================================
// Main Export Functions
// ============================================================================

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
  if (isEmptyResponse(response)) {
    return { type: "malformed" };
  }

  // Find all bracket groups in response
  const allMatches = findBracketGroups(response);
  if (allMatches.length === 0) {
    return { type: "malformed" };
  }

  // Check for NO_CITE in any group
  if (hasNoCiteMarker(allMatches)) {
    return { type: "no_cite" };
  }

  // Parse all bracket groups and collect indices
  const allIndices: number[] = [];

  for (const match of allMatches) {
    const captured = match[1];
    if (!captured) {
      return { type: "malformed" };
    }

    const parsed = parseIndicesFromGroup(captured);
    if (parsed === null) {
      return { type: "malformed" };
    }

    allIndices.push(...parsed);
  }

  // Validate we got at least one index
  if (allIndices.length === 0) {
    return { type: "malformed" };
  }

  // Deduplicate while preserving order
  const deduplicated = deduplicateIndices(allIndices);

  return { type: "cited", indices: deduplicated };
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
