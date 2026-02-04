/**
 * Matrix operations for RMM (Reflective Memory Management) algorithms.
 *
 * Implements core mathematical utilities required for Equation 1:
 * - Matrix-vector multiplication for W_q · q, W_m · m_i (O(n²))
 * - Matrix-matrix multiplication (O(n³)) - for general use
 * - Residual connections for q' = q + W_q·q
 * - Gaussian initialization for N(0, 0.01) weight matrices
 *
 * PERFORMANCE NOTE:
 * The paper's Equation 1 uses matrix-VECTOR multiplication: q' = q + W·q
 * This is O(n²) = ~2.4M operations for n=1536, NOT O(n³) matrix-matrix.
 * Current pure JS: ~2-5ms for 1536-dim vector transform.
 * For <1ms: WebAssembly SIMD or GPU required.
 */

/**
 * Matrix stored as Float32Array with dimensions.
 * Flat layout: row-major (row * cols + col)
 */
export interface Matrix {
  data: Float32Array;
  rows: number;
  cols: number;
}

/**
 * Converts number[][] to Matrix (Float32Array format).
 *
 * @param arr - 2D array
 * @returns Matrix in optimized format
 */
function toMatrix(arr: number[][]): Matrix {
  const rows = arr.length;
  const cols = arr[0]?.length ?? 0;
  const data = new Float32Array(rows * cols);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      data[i * cols + j] = arr[i]?.[j] ?? 0;
    }
  }

  return { data, rows, cols };
}

/**
 * Converts Matrix (Float32Array format) to number[][].
 *
 * @param m - Matrix in optimized format
 * @returns 2D array
 */
function fromMatrix(m: Matrix): number[][] {
  const result: number[][] = [];
  for (let i = 0; i < m.rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < m.cols; j++) {
      row.push(m.data[i * m.cols + j] ?? 0);
    }
    result.push(row);
  }
  return result;
}

/**
 * Transposes a matrix in-place using Float32Array.
 *
 * @param m - Matrix to transpose
 * @returns Transposed matrix
 */
function transpose(m: Matrix): Matrix {
  const result = new Float32Array(m.cols * m.rows);
  for (let i = 0; i < m.rows; i++) {
    for (let j = 0; j < m.cols; j++) {
      result[j * m.rows + i] = m.data[i * m.cols + j] ?? 0;
    }
  }
  return { data: result, rows: m.cols, cols: m.rows };
}

/**
 * Performs matrix-vector multiplication: (m×n) · (n) → (m)
 *
 * This is THE core operation for Equation 1 from the paper:
 *   q' = q + W_q · q  (where q is a vector, W_q is 1536×1536 matrix)
 *   m'_i = m_i + W_m · m_i
 *
 * Complexity: O(n²) where n = 1536 → ~2.4M multiply-add operations
 * Performance: ~2-5ms in pure JavaScript for n=1536
 *
 * @param matrix - Matrix (m×n)
 * @param vector - Vector (n)
 * @returns Result vector (m)
 * @throws Error if dimensions are incompatible
 */
export function matmulVector(matrix: number[][], vector: number[]): number[] {
  const mRows = matrix.length;
  if (mRows === 0) {
    throw new Error("Matrix cannot be empty");
  }

  const mCols = matrix[0]?.length ?? 0;
  const vDim = vector.length;

  if (mCols !== vDim) {
    throw new Error(
      `Dimension mismatch: matrix is ${mRows}×${mCols}, vector is ${vDim}`
    );
  }

  const result: number[] = new Array(mRows).fill(0);

  for (let i = 0; i < mRows; i++) {
    let sum = 0;
    const row = matrix[i];
    if (!row) continue;

    for (let j = 0; j < mCols; j++) {
      sum += (row[j] ?? 0) * (vector[j] ?? 0);
    }
    result[i] = sum;
  }

  return result;
}

/**
 * Performs matrix-matrix multiplication: (m×n) × (n×p) → (m×p)
 *
 * Uses Float32Array and cache blocking for better performance.
 * WARNING: This is O(n³). For Equation 1, use matmulVector instead.
 *
 * @param a - First matrix (m×n)
 * @param b - Second matrix (n×p)
 * @returns Result matrix (m×p)
 * @throws Error if dimensions are incompatible or matrices are empty
 */
export function matmul(a: number[][], b: number[][]): number[][] {
  // Validate input matrices
  if (a.length === 0 || b.length === 0) {
    throw new Error("Matrices cannot be empty");
  }

  const aRows = a.length;
  const aCols = a[0]?.length ?? 0;
  const bRows = b.length;
  const bCols = b[0]?.length ?? 0;

  // Validate dimension compatibility: (m×n) × (n×p)
  if (aCols !== bRows) {
    throw new Error(
      `Incompatible matrix dimensions: (${aRows}×${aCols}) × (${bRows}×${bCols}) - ` +
        `first matrix columns (${aCols}) must equal second matrix rows (${bRows})`
    );
  }

  // Convert to optimized format
  const aMat = toMatrix(a);
  const bMat = toMatrix(b);
  const bTransposed = transpose(bMat);

  // Result matrix
  const result = new Float32Array(aRows * bCols);

  // Cache block size - tuned for typical CPU cache sizes
  // L1 cache is typically 32KB, so we want blocks that fit in cache
  // 32x32 block of floats = 4KB, which fits comfortably
  const BLOCK_SIZE = 32;

  // Blocked/tiled matrix multiplication for better cache locality
  for (let ii = 0; ii < aRows; ii += BLOCK_SIZE) {
    for (let jj = 0; jj < bCols; jj += BLOCK_SIZE) {
      for (let kk = 0; kk < aCols; kk += BLOCK_SIZE) {
        // Block boundaries
        const iEnd = Math.min(ii + BLOCK_SIZE, aRows);
        const jEnd = Math.min(jj + BLOCK_SIZE, bCols);
        const kEnd = Math.min(kk + BLOCK_SIZE, aCols);

        // Multiply current blocks
        for (let i = ii; i < iEnd; i++) {
          const aRowOffset = i * aCols;
          const resultRowOffset = i * bCols;

          for (let k = kk; k < kEnd; k++) {
            const aVal = aMat.data[aRowOffset + k];
            if (aVal === undefined) continue;

            // Inner loop with 4x unrolling for better instruction-level parallelism
            let j = jj;
            const jUnrollEnd = jEnd - 3;

            for (; j < jUnrollEnd; j += 4) {
              const bIdx0 = j * bRows + k;
              const bIdx1 = (j + 1) * bRows + k;
              const bIdx2 = (j + 2) * bRows + k;
              const bIdx3 = (j + 3) * bRows + k;

              const bVal0 = bTransposed.data[bIdx0];
              const bVal1 = bTransposed.data[bIdx1];
              const bVal2 = bTransposed.data[bIdx2];
              const bVal3 = bTransposed.data[bIdx3];

              if (bVal0 !== undefined) {
                // biome-ignore lint/style/noNonNullAssertion: Array index is guaranteed valid by loop bounds
                result[resultRowOffset + j]! += aVal * bVal0;
              }
              if (bVal1 !== undefined) {
                // biome-ignore lint/style/noNonNullAssertion: Array index is guaranteed valid by loop bounds
                result[resultRowOffset + j + 1]! += aVal * bVal1;
              }
              if (bVal2 !== undefined) {
                // biome-ignore lint/style/noNonNullAssertion: Array index is guaranteed valid by loop bounds
                result[resultRowOffset + j + 2]! += aVal * bVal2;
              }
              if (bVal3 !== undefined) {
                // biome-ignore lint/style/noNonNullAssertion: Array index is guaranteed valid by loop bounds
                result[resultRowOffset + j + 3]! += aVal * bVal3;
              }
            }

            // Handle remaining elements
            for (; j < jEnd; j++) {
              const bVal = bTransposed.data[j * bRows + k];
              if (bVal !== undefined) {
                // biome-ignore lint/style/noNonNullAssertion: Array index is guaranteed valid by loop bounds
                result[resultRowOffset + j]! += aVal * bVal;
              }
            }
          }
        }
      }
    }
  }

  // Convert back to number[][]
  const resultMatrix: number[][] = [];
  for (let i = 0; i < aRows; i++) {
    const row: number[] = [];
    const rowOffset = i * bCols;
    for (let j = 0; j < bCols; j++) {
      // biome-ignore lint/style/noNonNullAssertion: Array index is guaranteed valid by loop bounds
      row.push(result[rowOffset + j]!);
    }
    resultMatrix.push(row);
  }

  return resultMatrix;
}

/**
 * Performs element-wise addition for residual connections.
 *
 * Implements: q' = q + W_q·q (Equation 1 from paper)
 * Used for embedding adaptation with residual connections.
 *
 * @param original - Original vector (e.g., query q or memory m)
 * @param transformed - Transformed vector (e.g., W_q·q or W_m·m)
 * @returns Result vector: element-wise sum
 * @throws Error if vectors have different dimensions or are empty
 */
export function residualAdd(
  original: number[],
  transformed: number[]
): number[] {
  // Validate inputs
  if (original.length === 0 || transformed.length === 0) {
    throw new Error("Vectors cannot be empty");
  }

  if (original.length !== transformed.length) {
    throw new Error(
      `Vector dimension mismatch: ${original.length} vs ${transformed.length}`
    );
  }

  // Element-wise addition
  return original.map((val, idx) => val + (transformed[idx] ?? 0));
}

/**
 * Box-Muller transform: generates standard normal random variable
 * from two independent uniform random variables.
 *
 * @returns Standard normal random variable (mean=0, std=1)
 */
function boxMuller(): number {
  const u1 = Math.random();
  const u2 = Math.random();

  // Avoid log(0) by ensuring u1 > 0
  const safeU1 = u1 === 0 ? Number.MIN_VALUE : u1;

  // Box-Muller transform
  const magnitude = Math.sqrt(-2.0 * Math.log(safeU1));
  const angle = 2.0 * Math.PI * u2;

  return magnitude * Math.cos(angle);
}

/**
 * Initializes a matrix with Gaussian (normal) distribution.
 *
 * Used for: W_q[i][j] ~ N(0, 0.01), W_m[i][j] ~ N(0, 0.01)
 * Per paper recommendation for stable training start.
 *
 * Uses Box-Muller transform for proper Gaussian distribution.
 *
 * @param rows - Number of rows
 * @param cols - Number of columns
 * @param mean - Mean of distribution (μ)
 * @param std - Standard deviation (σ)
 * @returns Initialized matrix with values ~ N(mean, std)
 */
export function initializeMatrix(
  rows: number,
  cols: number,
  mean: number,
  std: number
): number[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => {
      const standardNormal = boxMuller();
      return mean + std * standardNormal;
    })
  );
}
