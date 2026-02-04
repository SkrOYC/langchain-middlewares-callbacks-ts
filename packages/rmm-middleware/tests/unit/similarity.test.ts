import { describe, expect, test } from "bun:test";
import { cosineSimilarity, dotProduct } from "@/utils/similarity";

// ============================================================================
// Dot Product Tests
// ============================================================================

describe("dotProduct", () => {
  test("computes dot product of two vectors", () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    const result = dotProduct(a, b);
    expect(result).toBe(32);
  });

  test("computes dot product for 1536-dimensional vectors", () => {
    const dim = 1536;
    const a = Array.from({ length: dim }, (_, i) => i * 0.001);
    const b = Array.from({ length: dim }, (_, i) => (dim - i) * 0.001);

    const result = dotProduct(a, b);

    // Verify it's a number and finite
    expect(typeof result).toBe("number");
    expect(Number.isFinite(result)).toBe(true);
    // Result should be positive in this case
    expect(result).toBeGreaterThan(0);
  });

  test("dot product is zero for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const result = dotProduct(a, b);
    expect(result).toBe(0);
  });

  test("dot product handles negative values", () => {
    const a = [-1, 2, -3];
    const b = [4, -5, 6];
    // (-1)*4 + 2*(-5) + (-3)*6 = -4 - 10 - 18 = -32
    const result = dotProduct(a, b);
    expect(result).toBe(-32);
  });

  test("dot product of vector with itself equals squared norm", () => {
    const a = [1, 2, 3];
    const dotProductResult = dotProduct(a, a);
    const expected = 1 * 1 + 2 * 2 + 3 * 3; // 14
    expect(dotProductResult).toBe(expected);
  });

  test("throws error for dimension mismatch", () => {
    const a = [1, 2, 3];
    const b = [1, 2];
    expect(() => dotProduct(a, b)).toThrow();
  });

  test("throws error for empty vectors", () => {
    expect(() => dotProduct([], [])).toThrow();
  });

  test("handles single element vectors", () => {
    const a = [5];
    const b = [3];
    const result = dotProduct(a, b);
    expect(result).toBe(15);
  });
});

// ============================================================================
// Cosine Similarity Tests
// ============================================================================

describe("cosineSimilarity", () => {
  test("identical vectors have similarity of 1", () => {
    const a = [1, 2, 3];
    const result = cosineSimilarity(a, a);
    expect(result).toBeCloseTo(1, 10);
  });

  test("opposite vectors have similarity of -1", () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    const result = cosineSimilarity(a, b);
    expect(result).toBeCloseTo(-1, 10);
  });

  test("orthogonal vectors have similarity of 0", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const result = cosineSimilarity(a, b);
    expect(result).toBeCloseTo(0, 10);
  });

  test("zero vector returns 0 (graceful handling, not NaN)", () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    const result = cosineSimilarity(a, b);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  test("both zero vectors return 0", () => {
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const result = cosineSimilarity(a, b);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  test("handles 1536-dimensional vectors", () => {
    const dim = 1536;
    const a = Array.from({ length: dim }, () => Math.random() * 2 - 1);
    const b = Array.from({ length: dim }, () => Math.random() * 2 - 1);

    const result = cosineSimilarity(a, b);

    // Verify result is in valid range
    expect(result).toBeGreaterThanOrEqual(-1);
    expect(result).toBeLessThanOrEqual(1);
    expect(Number.isFinite(result)).toBe(true);
  });

  test("similarity of unit vectors is correct", () => {
    // Two unit vectors at 45 degrees
    const a = [1, 0];
    const b = [Math.cos(Math.PI / 4), Math.sin(Math.PI / 4)];
    const result = cosineSimilarity(a, b);
    expect(result).toBeCloseTo(Math.cos(Math.PI / 4), 10);
  });

  test("throws error for dimension mismatch", () => {
    const a = [1, 2, 3];
    const b = [1, 2];
    expect(() => cosineSimilarity(a, b)).toThrow();
  });

  test("throws error for empty vectors", () => {
    expect(() => cosineSimilarity([], [])).toThrow();
  });

  test("handles nearly zero vectors (small values)", () => {
    const a = [1e-10, 2e-10, 3e-10];
    const b = [1, 2, 3];
    const result = cosineSimilarity(a, b);
    // Should still return valid similarity close to 1
    expect(result).toBeCloseTo(1, 5);
  });

  test("handles very different vectors", () => {
    const a = [100, 0, 0];
    const b = [0, 100, 0];
    const result = cosineSimilarity(a, b);
    // Orthogonal, should be 0
    expect(result).toBeCloseTo(0, 10);
  });

  test("is symmetric (sim(a,b) = sim(b,a))", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [5, 4, 3, 2, 1];
    const simAB = cosineSimilarity(a, b);
    const simBA = cosineSimilarity(b, a);
    expect(simAB).toBe(simBA);
  });

  test("returns value in range [-1, 1] for random vectors", () => {
    for (let i = 0; i < 10; i++) {
      const a = Array.from({ length: 10 }, () => Math.random() * 10 - 5);
      const b = Array.from({ length: 10 }, () => Math.random() * 10 - 5);
      const result = cosineSimilarity(a, b);
      expect(result).toBeGreaterThanOrEqual(-1);
      expect(result).toBeLessThanOrEqual(1);
      expect(Number.isFinite(result)).toBe(true);
    }
  });
});
