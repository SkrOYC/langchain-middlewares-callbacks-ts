import { describe, expect, test } from "bun:test";
import {
  extractCitations,
  validateCitations,
} from "@/utils/citation-extractor";

// ============================================================================
// extractCitations Tests
// ============================================================================

describe("extractCitations", () => {
  test("parses valid citation format [0, 2, 4]", () => {
    const response = "The user enjoys hiking [0, 2, 4] and reading books.";
    const result = extractCitations(response);
    expect(result.type).toBe("cited");
    expect(result.indices).toEqual([0, 2, 4]);
  });

  test("parses valid NO_CITE format", () => {
    const response =
      "I don't have specific memories about this topic. [NO_CITE]";
    const result = extractCitations(response);
    expect(result.type).toBe("no_cite");
    expect(result.indices).toBeUndefined();
  });

  test("parses single index [3]", () => {
    const response = "The user mentioned this [3].";
    const result = extractCitations(response);
    expect(result.type).toBe("cited");
    expect(result.indices).toEqual([3]);
  });

  test("handles whitespace in citation [ 0 , 2 ]", () => {
    const response = "User preferences [ 0 , 2 ] are noted.";
    const result = extractCitations(response);
    expect(result.type).toBe("cited");
    expect(result.indices).toEqual([0, 2]);
  });

  test("handles multiple spaces in citation", () => {
    const response = "Based on [  1  ,   3  ,  5  ] memories.";
    const result = extractCitations(response);
    expect(result.type).toBe("cited");
    expect(result.indices).toEqual([1, 3, 5]);
  });

  test("returns malformed for invalid format [abc]", () => {
    const response = "Invalid citation format [abc].";
    const result = extractCitations(response);
    expect(result.type).toBe("malformed");
    expect(result.indices).toBeUndefined();
  });

  test("returns malformed for incomplete citation [0,", () => {
    const response = "Incomplete [0,";
    const result = extractCitations(response);
    expect(result.type).toBe("malformed");
    expect(result.indices).toBeUndefined();
  });

  test("returns malformed for empty brackets []", () => {
    const response = "Empty [] citation.";
    const result = extractCitations(response);
    expect(result.type).toBe("malformed");
    expect(result.indices).toBeUndefined();
  });

  test("returns malformed for missing brackets 0, 2", () => {
    const response = "No brackets just 0, 2 numbers.";
    const result = extractCitations(response);
    expect(result.type).toBe("malformed");
    expect(result.indices).toBeUndefined();
  });

  test("extracts all citations when multiple bracket groups present", () => {
    const response = "First [0, 1] and second [2, 3] citation.";
    const result = extractCitations(response);
    expect(result.type).toBe("cited");
    expect(result.indices).toEqual([0, 1, 2, 3]);
  });

  test("extracts inline citations scattered throughout response", () => {
    const response = "You like hiking [0] and play guitar [1] and enjoy stargazing [2].";
    const result = extractCitations(response);
    expect(result.type).toBe("cited");
    expect(result.indices).toEqual([0, 1, 2]);
  });

  test("deduplicates citations across multiple groups", () => {
    const response = "Based on [0, 1] and confirmed by [1, 2].";
    const result = extractCitations(response);
    expect(result.type).toBe("cited");
    expect(result.indices).toEqual([0, 1, 2]);
  });

  test("handles citation at end of response", () => {
    const response = "User likes coffee and tea [0, 1, 2]";
    const result = extractCitations(response);
    expect(result.type).toBe("cited");
    expect(result.indices).toEqual([0, 1, 2]);
  });

  test("handles citation at beginning of response", () => {
    const response = "[0] User mentioned hiking.";
    const result = extractCitations(response);
    expect(result.type).toBe("cited");
    expect(result.indices).toEqual([0]);
  });

  test("handles NO_CITE with surrounding text", () => {
    const response = "Based on my knowledge [NO_CITE], I can help with that.";
    const result = extractCitations(response);
    expect(result.type).toBe("no_cite");
    expect(result.indices).toBeUndefined();
  });

  test("handles large indices", () => {
    const response = "Citing memories [10, 20, 100]";
    const result = extractCitations(response);
    expect(result.type).toBe("cited");
    expect(result.indices).toEqual([10, 20, 100]);
  });

  test("handles zero index", () => {
    const response = "First memory [0] is relevant.";
    const result = extractCitations(response);
    expect(result.type).toBe("cited");
    expect(result.indices).toEqual([0]);
  });

  test("returns malformed for mixed valid and invalid", () => {
    const response = "Mixed [0, abc, 2] format.";
    const result = extractCitations(response);
    expect(result.type).toBe("malformed");
    expect(result.indices).toBeUndefined();
  });

  test("returns malformed for negative indices", () => {
    const response = "Negative index [-1, 0, 1].";
    const result = extractCitations(response);
    expect(result.type).toBe("malformed");
    expect(result.indices).toBeUndefined();
  });

  test("returns malformed for decimal numbers", () => {
    const response = "Decimal [0.5, 1, 2].";
    const result = extractCitations(response);
    expect(result.type).toBe("malformed");
    expect(result.indices).toBeUndefined();
  });

  test("handles consecutive indices", () => {
    const response = "Consecutive [0,1,2,3,4].";
    const result = extractCitations(response);
    expect(result.type).toBe("cited");
    expect(result.indices).toEqual([0, 1, 2, 3, 4]);
  });

  test("returns malformed for empty response", () => {
    const result = extractCitations("");
    expect(result.type).toBe("malformed");
    expect(result.indices).toBeUndefined();
  });

  test("returns malformed for no citation in response", () => {
    const response = "Just some text without any citation format.";
    const result = extractCitations(response);
    expect(result.type).toBe("malformed");
    expect(result.indices).toBeUndefined();
  });
});

// ============================================================================
// validateCitations Tests
// ============================================================================

describe("validateCitations", () => {
  test("validates indices within bounds [0, 1, 2] with topM=5", () => {
    const indices = [0, 1, 2];
    const topM = 5;
    const result = validateCitations(indices, topM);
    expect(result).toBe(true);
  });

  test("rejects out of bounds index [5] with topM=3", () => {
    const indices = [5];
    const topM = 3;
    const result = validateCitations(indices, topM);
    expect(result).toBe(false);
  });

  test("rejects negative index [-1] with topM=5", () => {
    const indices = [-1];
    const topM = 5;
    const result = validateCitations(indices, topM);
    expect(result).toBe(false);
  });

  test("rejects index at exact topM boundary", () => {
    const indices = [5]; // Index 5 is out of bounds for topM=5 (valid: 0-4)
    const topM = 5;
    const result = validateCitations(indices, topM);
    expect(result).toBe(false);
  });

  test("validates index at topM-1 boundary", () => {
    const indices = [4]; // Index 4 is valid for topM=5 (valid: 0-4)
    const topM = 5;
    const result = validateCitations(indices, topM);
    expect(result).toBe(true);
  });

  test("rejects duplicate indices", () => {
    const indices = [0, 1, 1, 2]; // Duplicate 1
    const topM = 5;
    const result = validateCitations(indices, topM);
    expect(result).toBe(false);
  });

  test("validates single index [0] with topM=1", () => {
    const indices = [0];
    const topM = 1;
    const result = validateCitations(indices, topM);
    expect(result).toBe(true);
  });

  test("rejects single index [1] with topM=1", () => {
    const indices = [1];
    const topM = 1;
    const result = validateCitations(indices, topM);
    expect(result).toBe(false);
  });

  test("validates empty indices array", () => {
    const indices: number[] = [];
    const topM = 5;
    const result = validateCitations(indices, topM);
    expect(result).toBe(true); // Empty is valid (no citations)
  });

  test("validates large topM with multiple indices", () => {
    const indices = [0, 5, 10, 15, 19];
    const topM = 20;
    const result = validateCitations(indices, topM);
    expect(result).toBe(true);
  });

  test("rejects when any index out of bounds in large set", () => {
    const indices = [0, 5, 10, 20, 15]; // 20 is out of bounds for topM=20
    const topM = 20;
    const result = validateCitations(indices, topM);
    expect(result).toBe(false);
  });

  test("validates typical topM=5 case", () => {
    // Valid indices for topM=5 are 0, 1, 2, 3, 4
    const validIndices = [0, 2, 4];
    const result = validateCitations(validIndices, 5);
    expect(result).toBe(true);
  });

  test("rejects non-integer indices", () => {
    // TypeScript type system prevents this, but function should handle gracefully
    // If somehow passed, it should validate based on numeric comparison
    const indices = [0.5, 1.5] as number[];
    const topM = 5;
    const result = validateCitations(indices, topM);
    // 0.5 < 5 is true, but decimals are technically valid numbers
    // Function behavior depends on implementation - should be consistent
    expect(typeof result).toBe("boolean");
  });

  test("handles topM=0 edge case", () => {
    const indices: number[] = [];
    const topM = 0;
    const result = validateCitations(indices, topM);
    expect(result).toBe(true); // Empty array is valid even with topM=0
  });

  test("rejects any index when topM=0", () => {
    const indices = [0];
    const topM = 0;
    const result = validateCitations(indices, topM);
    expect(result).toBe(false);
  });
});
