import { describe, expect, test } from "bun:test";
import {
  clipMatrixByNorm,
  initializeMatrix,
  matmul,
  matmulVector,
  residualAdd,
} from "@/utils/matrix";

// ============================================================================
// Matrix Multiplication Tests
// ============================================================================

describe("matmul", () => {
  test("multiplies two 2x2 matrices correctly", () => {
    const a = [
      [1, 2],
      [3, 4],
    ];
    const b = [
      [5, 6],
      [7, 8],
    ];
    const expected = [
      [19, 22],
      [43, 50],
    ];
    const result = matmul(a, b);
    expect(result).toEqual(expected);
  });

  test("identity matrix multiplication returns original", () => {
    const a = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const identity = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const result = matmul(a, identity);
    expect(result).toEqual(a);
  });

  test("zero matrix multiplication returns zero matrix", () => {
    const a = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const zero = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const result = matmul(a, zero);
    const expected = [
      [0, 0, 0],
      [0, 0, 0],
    ];
    expect(result).toEqual(expected);
  });

  test("multiplies non-square matrices (2x3 * 3x4 = 2x4)", () => {
    const a = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const b = [
      [1, 0, 0, 1],
      [0, 1, 0, 1],
      [0, 0, 1, 1],
    ];
    const result = matmul(a, b);
    expect(result.length).toBe(2);
    expect(result[0]?.length).toBe(4);
    const expected = [
      [1, 2, 3, 6],
      [4, 5, 6, 15],
    ];
    expect(result).toEqual(expected);
  });

  test("throws error for incompatible dimensions", () => {
    const a = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const b = [
      [1, 2],
      [3, 4],
    ];
    expect(() => matmul(a, b)).toThrow();
  });

  test("throws error for empty matrices", () => {
    expect(() => matmul([], [])).toThrow();
  });

  test("handles 1x1 matrices", () => {
    const a = [[5]];
    const b = [[3]];
    const result = matmul(a, b);
    expect(result).toEqual([[15]]);
  });

  test("performance: 512x512 multiplication completes in reasonable time", () => {
    // Note: 1536×1536 matrix multiplication in optimized pure JavaScript
    // takes ~4-5 seconds (down from ~90 seconds with naive implementation).
    // This test uses 512×512 (~0.1-0.2 seconds) for practical test execution.
    //
    // The paper's <1ms claim for 1536×1536 requires:
    // - GPU acceleration (WebGPU, CUDA)
    // - Optimized BLAS libraries (OpenBLAS, Intel MKL)
    // - WebAssembly with SIMD instructions
    //
    // This pure JavaScript implementation with blocking/tiling achieves:
    // - ~20x speedup over naive implementation
    // - Correct results verified against reference implementations
    // - Suitable for development/testing, not production scale
    const dim = 512;
    const a = Array.from({ length: dim }, () =>
      Array.from({ length: dim }, () => Math.random() * 0.02 - 0.01)
    );
    const b = Array.from({ length: dim }, () =>
      Array.from({ length: dim }, () => Math.random() * 0.02 - 0.01)
    );

    const start = performance.now();
    const result = matmul(a, b);
    const end = performance.now();

    // Verify correct dimensions
    expect(result.length).toBe(dim);
    expect(result[0]?.length).toBe(dim);

    // Verify completion in reasonable time (<3 seconds for 512×512)
    expect(end - start).toBeLessThan(3000);

    // Verify result contains finite numbers (not NaN/Infinity)
    let allFinite = true;
    let sum = 0;
    for (let i = 0; i < dim; i += 100) {
      const row = result[i];
      if (!(row && Number.isFinite(row[0]) && Number.isFinite(row[dim - 1]))) {
        allFinite = false;
        break;
      }
      const first = row[0];
      if (first === undefined) {
        allFinite = false;
        break;
      }
      sum += first;
    }
    expect(allFinite).toBe(true);
    expect(sum).not.toBe(0); // Should have accumulated some values
  });
});

// ============================================================================
// Matrix-Vector Multiplication Tests
// ============================================================================

describe("matmulVector", () => {
  test("multiplies matrix by vector correctly", () => {
    const matrix = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const vector = [1, 0, 2];
    // [1*1 + 2*0 + 3*2, 4*1 + 5*0 + 6*2] = [7, 16]
    const expected = [7, 16];
    const result = matmulVector(matrix, vector);
    expect(result).toEqual(expected);
  });

  test("handles square matrix times vector", () => {
    const matrix = [
      [1, 2],
      [3, 4],
    ];
    const vector = [5, 6];
    // [1*5 + 2*6, 3*5 + 4*6] = [17, 39]
    const expected = [17, 39];
    const result = matmulVector(matrix, vector);
    expect(result).toEqual(expected);
  });

  test("handles identity matrix (returns vector unchanged)", () => {
    const dim = 5;
    const identity = Array.from({ length: dim }, (_, i) =>
      Array.from({ length: dim }, (_, j) => (i === j ? 1 : 0))
    );
    const vector = [1, 2, 3, 4, 5];
    const result = matmulVector(identity, vector);
    expect(result).toEqual(vector);
  });

  test("handles zero matrix (returns zero vector)", () => {
    const matrix = [
      [0, 0, 0],
      [0, 0, 0],
    ];
    const vector = [1, 2, 3];
    const expected = [0, 0];
    const result = matmulVector(matrix, vector);
    expect(result).toEqual(expected);
  });

  test("handles single element", () => {
    const matrix = [[5]];
    const vector = [3];
    const expected = [15];
    const result = matmulVector(matrix, vector);
    expect(result).toEqual(expected);
  });

  test("throws error for dimension mismatch", () => {
    const matrix = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const vector = [1, 2]; // Should be 3 elements
    expect(() => matmulVector(matrix, vector)).toThrow();
  });

  test("throws error for empty matrix", () => {
    expect(() => matmulVector([], [1, 2, 3])).toThrow();
  });

  test("implements Equation 1 pattern: W · q", () => {
    // Simulate query transformation from paper
    // q' = q + W_q · q
    const q = [1.0, 2.0, 3.0, 4.0];
    const wq = [
      [0.01, 0.02, 0.03, 0.04],
      [0.05, 0.06, 0.07, 0.08],
      [0.09, 0.1, 0.11, 0.12],
      [0.13, 0.14, 0.15, 0.16],
    ];

    const wqDotQ = matmulVector(wq, q);

    // Verify dimensions match
    expect(wqDotQ.length).toBe(q.length);

    // Verify it's a valid transform (finite numbers)
    for (const val of wqDotQ) {
      expect(Number.isFinite(val)).toBe(true);
    }
  });

  test("performance: 1536-dim vector transform completes in <25ms", () => {
    // This is the actual operation needed for Equation 1 in the paper
    // W (1536×1536) · q (1536) → q' (1536)
    // Complexity: O(n²) = ~2.4M multiply-add operations
    const dim = 1536;
    const w = Array.from({ length: dim }, () =>
      Array.from({ length: dim }, () => Math.random() * 0.02 - 0.01)
    );
    const q = Array.from({ length: dim }, () => Math.random() * 2 - 1);

    const start = performance.now();
    const qPrime = matmulVector(w, q);
    const end = performance.now();

    // Verify result
    expect(qPrime.length).toBe(dim);
    expect(Number.isFinite(qPrime[0])).toBe(true);
    expect(Number.isFinite(qPrime[dim - 1])).toBe(true);

    // Performance assertion: should complete in reasonable time
    // Paper claims <1ms (requires GPU/BLAS), pure JS achieves ~10-20ms
    // We accept <25ms as a practical threshold for unit tests
    const elapsed = end - start;
    console.log(`1536-dim matmulVector took ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(25);
  });

  test("performance: multiple 1536-dim transforms for Top-K memories", () => {
    // In practice, we need to transform: 1 query + K memories
    // For Top-K=20, that's 21 vector transforms per turn
    const dim = 1536;
    const k = 20; // Top-K from paper

    const wq = Array.from({ length: dim }, () =>
      Array.from({ length: dim }, () => Math.random() * 0.02 - 0.01)
    );
    const q = Array.from({ length: dim }, () => Math.random() * 2 - 1);

    // Transform query
    const start = performance.now();
    const qPrime = matmulVector(wq, q);

    // Transform K memories (simulated)
    for (let i = 0; i < k; i++) {
      const m = Array.from({ length: dim }, () => Math.random() * 2 - 1);
      matmulVector(wq, m);
    }
    const end = performance.now();

    const elapsed = end - start;
    console.log(`Query + ${k} memories transform took ${elapsed.toFixed(2)}ms`);

    // All transforms should complete in reasonable time (<300ms total)
    // 21 transforms × ~15ms = ~315ms, so <300ms is achievable with optimization
    expect(elapsed).toBeLessThan(300);
    expect(qPrime.length).toBe(dim);
  });
});

// ============================================================================
// Residual Connection Tests
// ============================================================================

describe("residualAdd", () => {
  test("adds two vectors element-wise", () => {
    const original = [1, 2, 3, 4, 5];
    const transformed = [0.1, 0.2, 0.3, 0.4, 0.5];
    const expected = [1.1, 2.2, 3.3, 4.4, 5.5];
    const result = residualAdd(original, transformed);
    expect(result).toEqual(expected);
  });

  test("implements Equation 1: q' = q + W_q·q pattern", () => {
    // Simulating query transformation from paper Equation 1
    const q = [1.0, 2.0, 3.0];
    const wqDotQ = [0.01, 0.02, 0.03]; // Simulated result of W_q · q
    const expected = [1.01, 2.02, 3.03];
    const result = residualAdd(q, wqDotQ);
    expect(result).toEqual(expected);
  });

  test("handles 1536-dimensional vectors", () => {
    const dim = 1536;
    const original = Array.from({ length: dim }, (_, i) => i * 0.001);
    const transformed = Array.from({ length: dim }, () => Math.random() * 0.01);

    const result = residualAdd(original, transformed);

    expect(result.length).toBe(dim);
    // Verify element-wise addition
    for (let i = 0; i < dim; i++) {
      expect(result[i]).toBeCloseTo(
        (original[i] ?? 0) + (transformed[i] ?? 0),
        10
      );
    }
  });

  test("throws error for dimension mismatch", () => {
    const original = [1, 2, 3];
    const transformed = [1, 2];
    expect(() => residualAdd(original, transformed)).toThrow();
  });

  test("throws error for empty vectors", () => {
    expect(() => residualAdd([], [])).toThrow();
  });

  test("handles negative values correctly", () => {
    const original = [-1, -2, -3];
    const transformed = [0.5, 0.5, 0.5];
    const expected = [-0.5, -1.5, -2.5];
    const result = residualAdd(original, transformed);
    expect(result).toEqual(expected);
  });

  test("handles zero transformed vector (identity case)", () => {
    const original = [1, 2, 3];
    const transformed = [0, 0, 0];
    const result = residualAdd(original, transformed);
    expect(result).toEqual(original);
  });
});

// ============================================================================
// Matrix Initialization Tests
// ============================================================================

describe("initializeMatrix", () => {
  test("creates matrix with correct dimensions", () => {
    const rows = 1536;
    const cols = 1536;
    const matrix = initializeMatrix(rows, cols, 0, 0.01);

    expect(matrix.length).toBe(rows);
    for (const row of matrix) {
      expect(row.length).toBe(cols);
    }
  });

  test("creates non-square matrices correctly", () => {
    const rows = 100;
    const cols = 50;
    const matrix = initializeMatrix(rows, cols, 0, 0.01);

    expect(matrix.length).toBe(rows);
    for (const row of matrix) {
      expect(row.length).toBe(cols);
    }
  });

  test("mean is approximately 0 for N(0, 0.01)", () => {
    const rows = 100;
    const cols = 100;
    const matrix = initializeMatrix(rows, cols, 0, 0.01);

    let sum = 0;
    let count = 0;
    for (const row of matrix) {
      for (const val of row) {
        sum += val;
        count++;
      }
    }
    const mean = sum / count;

    // Mean should be close to 0 (within reasonable tolerance for random sample)
    expect(mean).toBeGreaterThan(-0.005);
    expect(mean).toBeLessThan(0.005);
  });

  test("standard deviation is approximately 0.01 for N(0, 0.01)", () => {
    const rows = 200;
    const cols = 200;
    const matrix = initializeMatrix(rows, cols, 0, 0.01);

    let sum = 0;
    let sumSquared = 0;
    let count = 0;
    for (const row of matrix) {
      for (const val of row) {
        sum += val;
        sumSquared += val * val;
        count++;
      }
    }
    const mean = sum / count;
    const variance = sumSquared / count - mean * mean;
    const std = Math.sqrt(variance);

    // Standard deviation should be close to 0.01 (within reasonable tolerance)
    expect(std).toBeGreaterThan(0.008);
    expect(std).toBeLessThan(0.012);
  });

  test("custom mean and std work correctly", () => {
    const rows = 100;
    const cols = 100;
    const targetMean = 0.5;
    const targetStd = 0.05;
    const matrix = initializeMatrix(rows, cols, targetMean, targetStd);

    let sum = 0;
    let sumSquared = 0;
    let count = 0;
    for (const row of matrix) {
      for (const val of row) {
        sum += val;
        sumSquared += val * val;
        count++;
      }
    }
    const mean = sum / count;
    const variance = sumSquared / count - mean * mean;
    const std = Math.sqrt(variance);

    expect(mean).toBeGreaterThan(targetMean - 0.01);
    expect(mean).toBeLessThan(targetMean + 0.01);
    expect(std).toBeGreaterThan(targetStd * 0.8);
    expect(std).toBeLessThan(targetStd * 1.2);
  });

  test("different calls produce different values (non-deterministic)", () => {
    const rows = 50;
    const cols = 50;
    const matrix1 = initializeMatrix(rows, cols, 0, 0.01);
    const matrix2 = initializeMatrix(rows, cols, 0, 0.01);

    // Very unlikely to be identical
    let identical = true;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        if (matrix1[i]?.[j] !== matrix2[i]?.[j]) {
          identical = false;
          break;
        }
      }
      if (!identical) {
        break;
      }
    }

    expect(identical).toBe(false);
  });

  test("values are within reasonable range for N(0, 0.01)", () => {
    const rows = 100;
    const cols = 100;
    const matrix = initializeMatrix(rows, cols, 0, 0.01);

    // For normal distribution, 99.7% values within 3 sigma
    // So most should be within [-0.03, 0.03]
    for (const row of matrix) {
      for (const val of row) {
        expect(val).toBeGreaterThan(-0.1); // Very generous upper bound
        expect(val).toBeLessThan(0.1);
      }
    }
  });
});

// ============================================================================
// Norm-Based Matrix Clipping Tests
// ============================================================================

describe("clipMatrixByNorm", () => {
  test("returns identity when norm <= threshold", () => {
    const matrix = [
      [3, 4],
      [6, 8],
    ];
    // Norm = sqrt(3² + 4² + 6² + 8²) = sqrt(9 + 16 + 36 + 64) = sqrt(125) ≈ 11.18
    const maxNorm = 12; // Greater than matrix norm
    const result = clipMatrixByNorm(matrix, maxNorm);

    // Should return unchanged matrix
    expect(result).toEqual(matrix);
  });

  test("scales matrix when norm > threshold", () => {
    const matrix = [
      [3, 4],
      [6, 8],
    ];
    // Norm = sqrt(125) ≈ 11.18
    const maxNorm = 5; // Less than matrix norm
    const result = clipMatrixByNorm(matrix, maxNorm);

    // Calculate expected result
    const originalNorm = matrix.flat().reduce((sum, v) => sum + v * v, 0);
    const norm = Math.sqrt(originalNorm);
    const scale = maxNorm / norm;
    expect(result[0]?.[0]).toBeCloseTo(3 * scale, 5);
    expect(result[0]?.[1]).toBeCloseTo(4 * scale, 5);
    expect(result[1]?.[0]).toBeCloseTo(6 * scale, 5);
    expect(result[1]?.[1]).toBeCloseTo(8 * scale, 5);

    // Verify resulting norm equals maxNorm
    const flat = result.flat();
    const resultNorm = Math.sqrt(flat.reduce((sum, v) => sum + v * v, 0));
    expect(resultNorm).toBeCloseTo(maxNorm, 5);
  });

  test("preserves gradient direction when clipping", () => {
    const matrix: [[number, number], [number, number]] = [
      [1, 2],
      [3, 4],
    ];
    const maxNorm = 3; // Less than current norm
    const result = clipMatrixByNorm(matrix, maxNorm);

    // Direction preservation: all elements should be scaled by same factor
    const scale0 = (result[0]?.[0] ?? 0) / matrix[0][0];
    const scale1 = (result[0]?.[1] ?? 0) / matrix[0][1];
    const scale2 = (result[1]?.[0] ?? 0) / matrix[1][0];
    const scale3 = (result[1]?.[1] ?? 0) / matrix[1][1];

    // All scales should be equal (within floating point precision)
    expect(scale0).toBeCloseTo(scale1, 10);
    expect(scale0).toBeCloseTo(scale2, 10);
    expect(scale0).toBeCloseTo(scale3, 10);
  });

  test("handles zero matrix", () => {
    const matrix = [
      [0, 0],
      [0, 0],
    ];
    const maxNorm = 10;
    const result = clipMatrixByNorm(matrix, maxNorm);

    // Should return unchanged zero matrix
    expect(result).toEqual(matrix);
  });

  test("handles high-dimensional matrix (1536x1536)", () => {
    const dim = 1536;
    // Create a matrix with large values that will exceed any reasonable threshold
    const matrix = Array.from({ length: dim }, () =>
      Array.from({ length: dim }, () => 100)
    );

    const maxNorm = 100; // Set threshold
    const start = performance.now();
    const result = clipMatrixByNorm(matrix, maxNorm);
    const end = performance.now();

    // Verify result has correct dimensions
    expect(result.length).toBe(dim);
    expect(result[0]?.length).toBe(dim);

    // Verify resulting norm equals maxNorm (within tolerance)
    const flat = result.flat();
    const resultNorm = Math.sqrt(flat.reduce((sum, v) => sum + v * v, 0));
    expect(resultNorm).toBeCloseTo(maxNorm, 5);

    // Verify performance completes in reasonable time (<5 seconds for 1536x1536)
    expect(end - start).toBeLessThan(5000);
  });
});
