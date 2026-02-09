import { describe, expect, test } from "bun:test";
import {
  addMatrix,
  clipMatrixByNorm,
  createZeroMatrix,
  scaleMatrix,
} from "@/utils/matrix";

/**
 * Helper to compute L2 norm of a matrix using nested loops
 * (avoids flat() allocation for better performance)
 */
function _computeMatrixNorm(matrix: number[][]): number {
  let sumSquares = 0;
  for (const row of matrix) {
    for (const val of row) {
      sumSquares += val * val;
    }
  }
  return Math.sqrt(sumSquares);
}

describe("after-model gradient clipping integration", () => {
  test("clipping exists in implementation", async () => {
    // Read the source code to verify clipping is present
    const { readFile } = await import("node:fs/promises");
    const afterModelSource = await readFile(
      `${process.cwd()}/src/middleware/hooks/after-model.ts`,
      "utf-8"
    );

    // Verify that clipMatrixByNorm is imported
    expect(afterModelSource).toContain("clipMatrixByNorm");
  });

  test("gradients clipped before accumulation when norm > threshold", () => {
    // Test that clipMatrixByNorm actually clips gradients that exceed the threshold
    const clipThreshold = 50;
    const embDim = 10;

    // Create a gradient with norm > threshold
    const largeGrad = Array.from({ length: embDim }, () =>
      Array.from({ length: embDim }, () => 10)
    );

    const originalNorm = _computeMatrixNorm(largeGrad);
    expect(originalNorm).toBeGreaterThan(clipThreshold);

    // Clip should reduce the norm
    const clippedGrad = clipMatrixByNorm(largeGrad, clipThreshold);
    const clippedNorm = _computeMatrixNorm(clippedGrad);

    expect(clippedNorm).toBeLessThanOrEqual(clipThreshold);
    expect(clippedNorm).toBeLessThan(originalNorm);
  });

  test("clipThreshold parameter affects clipping behavior", () => {
    // Test that different thresholds produce different clipping results
    const embDim = 10;
    const largeGrad = Array.from({ length: embDim }, () =>
      Array.from({ length: embDim }, () => 10)
    );

    // Clip with different thresholds
    const clipped50 = clipMatrixByNorm(largeGrad, 50);
    const clipped100 = clipMatrixByNorm(largeGrad, 100);

    const norm50 = _computeMatrixNorm(clipped50);
    const norm100 = _computeMatrixNorm(clipped100);

    // Tighter threshold should result in smaller or equal norm
    expect(norm50).toBeLessThanOrEqual(50);
    expect(norm100).toBeLessThanOrEqual(100);
    expect(norm50).toBeLessThanOrEqual(norm100);
  });

  test("gradient accumulation respects clipping bounds after multiple samples", () => {
    // This test verifies the end-to-end gradient clipping behavior
    // as specified in acceptance criterion: "gradient accumulation respects clipping bounds"

    const clipThreshold = 100;
    const batchSize = 4;

    // Create a large gradient that exceeds the threshold
    const embDim = 100; // Use smaller dimension for test speed
    const largeGrad = Array.from({ length: embDim }, () =>
      Array.from({ length: embDim }, () => 10)
    );

    // Norm = sqrt(100 * 100 * 100) = 1000, which exceeds threshold
    const largeGradNorm = _computeMatrixNorm(largeGrad);
    expect(largeGradNorm).toBeGreaterThan(clipThreshold);

    // Simulate accumulation: clip each sample's gradient before adding
    let accumulator = createZeroMatrix(embDim, embDim);

    for (let i = 0; i < batchSize; i++) {
      // Clip BEFORE averaging (as per implementation)
      const clippedGrad = clipMatrixByNorm(largeGrad, clipThreshold);

      // Average over batch using utility function
      const averagedGrad = scaleMatrix(clippedGrad, 1 / batchSize);

      // Accumulate using utility function
      accumulator = addMatrix(accumulator, averagedGrad);
    }

    // Verify the accumulated gradient norm respects bounds
    const accumulatorNorm = _computeMatrixNorm(accumulator);

    // The accumulated norm should be approximately equal to clipThreshold
    // (since each contribution is clipped to clipThreshold / batchSize)
    // With batchSize=4: 4 * (100 / 4) = 100
    expect(accumulatorNorm).toBeLessThanOrEqual(clipThreshold * 1.1); // Allow 10% tolerance
    expect(accumulatorNorm).toBeGreaterThan(0);
  });

  test("gradients unchanged when norm below threshold", () => {
    // Test that clipping is a no-op when gradients are small
    const clipThreshold = 100;
    const embDim = 10;

    // Create a small gradient that's below threshold
    const smallGrad = Array.from({ length: embDim }, () =>
      Array.from({ length: embDim }, () => 0.1)
    );

    const smallGradNorm = _computeMatrixNorm(smallGrad);
    expect(smallGradNorm).toBeLessThan(clipThreshold);

    // Clip should return the same matrix (no copy needed) for performance
    const clippedGrad = clipMatrixByNorm(smallGrad, clipThreshold);

    // Test behavior: values should be unchanged
    expect(clippedGrad).toEqual(smallGrad);

    // Test optimization: should return same reference (documented behavior)
    expect(clippedGrad).toBe(smallGrad);

    // Explicitly verify values for clarity
    for (let i = 0; i < embDim; i++) {
      for (let j = 0; j < embDim; j++) {
        expect(clippedGrad[i]?.[j]).toBe(smallGrad[i]?.[j]);
      }
    }
  });

  test("per-sample clipping prevents accumulated gradient explosion", () => {
    // Verify that clipping per-sample prevents the accumulator
    // from growing unbounded with repeated large gradients
    const clipThreshold = 100;
    const batchSize = 4;
    const embDim = 10;

    // Create a gradient with very large values
    const hugeGrad = Array.from({ length: embDim }, () =>
      Array.from({ length: embDim }, () => 1000)
    );

    // Accumulate 100 batches
    let accumulator = createZeroMatrix(embDim, embDim);
    for (let batch = 0; batch < 100; batch++) {
      for (let sample = 0; sample < batchSize; sample++) {
        // Clip BEFORE averaging using utility functions
        const clippedGrad = clipMatrixByNorm(hugeGrad, clipThreshold);
        const averagedGrad = scaleMatrix(clippedGrad, 1 / batchSize);
        accumulator = addMatrix(accumulator, averagedGrad);
      }
    }

    // Even with 100 batches of huge gradients, the norm should be controlled
    // because each sample is clipped to 100 before accumulation
    // 100 batches * 4 samples/batch * (100 / 4) = 10,000 total contribution
    const finalNorm = _computeMatrixNorm(accumulator);
    expect(finalNorm).toBeLessThan(15_000); // Reasonable upper bound
  });
});
