/**
 * State Diff Utility
 *
 * Computes JSON Patch deltas between two state objects.
 * Uses fast-json-patch's compare function to generate RFC 6902 patch operations.
 */

import * as jsonpatch from "fast-json-patch";
import type { Operation } from "fast-json-patch";

/**
 * Compute the delta between two state objects using JSON Patch (RFC 6902).
 *
 * @param oldState - The previous state object
 * @param newState - The updated state object
 * @returns An array of JSON Patch operations describing the changes
 */
export function computeStateDelta(
  oldState: unknown,
  newState: unknown
): Operation[] {
  return jsonpatch.compare(oldState as any, newState as any);
}
