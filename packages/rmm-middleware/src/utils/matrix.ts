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
 }

/**
 * Transposes a matrix in-place using Float32Array.
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
    if (!row) {
      continue;
    }

    for (let j = 0; j < mCols; j++) {
      sum += (row[j] ?? 0) * (vector[j] ?? 0);
    }
    result[i] = sum;
  }

  return result;
}

/**
 * Validates input matrices for multiplication
 */
function validateMatmulInputs(
  a: number[][],
  b: number[][],
  aRows: number,
  aCols: number,
  bRows: number,
  bCols: number
): void {
  if (a.length === 0 || b.length === 0) {
    throw new Error("Matrices cannot be empty");
  }
  if (aCols !== bRows) {
    throw new Error(
      `Incompatible matrix dimensions: (${aRows}×${aCols}) × (${bRows}×${bCols}) - ` +
        `first matrix columns (${aCols}) must equal second matrix rows (${bRows})`
    );
  }
}

/**
 * Converts number matrices to Float32Array format
 */
interface Float32Matrices {
  aMat: Float32Array;
  bTransposed: Float32Array;
}

function convertToFloat32Matrices(
  a: number[][],
  b: number[][],
  _aCols: number,
  _bCols: number
): Float32Matrices {
  const aMat = toMatrix(a);
  const bMat = toMatrix(b);
  const bTransposed = transpose(bMat);
  return { aMat: aMat.data, bTransposed: bTransposed.data };
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
  const aRows = a.length;
  const aCols = a[0]?.length ?? 0;
  const bRows = b.length;
  const bCols = b[0]?.length ?? 0;

  validateMatmulInputs(a, b, aRows, aCols, bRows, bCols);

  const { aMat, bTransposed } = convertToFloat32Matrices(a, b, aCols, bCols);

  const result = multiplyBlocked(aMat, bTransposed, aRows, aCols, bCols);

  return convertToNumberArray(result, aRows, bCols);
}

/**
 * Cache block size - tuned for typical CPU cache sizes
 */
const BLOCK_SIZE = 32;

/**
 * Performs blocked matrix multiplication
 */
function multiplyBlocked(
  aMat: Float32Array,
  bTransposed: Float32Array,
  aRows: number,
  aCols: number,
  bCols: number
): Float32Array {
  const result = new Float32Array(aRows * bCols);
  const bRows = aCols; // bRows equals aCols due to dimension compatibility

  for (let ii = 0; ii < aRows; ii += BLOCK_SIZE) {
    for (let jj = 0; jj < bCols; jj += BLOCK_SIZE) {
      for (let kk = 0; kk < aCols; kk += BLOCK_SIZE) {
        multiplyTile(
          ii,
          jj,
          kk,
          aMat,
          bTransposed,
          result,
          aRows,
          aCols,
          bCols,
          bRows
        );
      }
    }
  }

  return result;
}

/**
 * Multiplies a single tile/block of the matrices
 */
function multiplyTile(
  ii: number,
  jj: number,
  kk: number,
  aMat: Float32Array,
  bTransposed: Float32Array,
  result: Float32Array,
  aRows: number,
  aCols: number,
  bCols: number,
  bRows: number
): void {
  const iEnd = Math.min(ii + BLOCK_SIZE, aRows);
  const jEnd = Math.min(jj + BLOCK_SIZE, bCols);
  const kEnd = Math.min(kk + BLOCK_SIZE, aCols);

  for (let i = ii; i < iEnd; i++) {
    const aRowOffset = i * aCols;
    const resultRowOffset = i * bCols;

    for (let k = kk; k < kEnd; k++) {
      const aVal = aMat[aRowOffset + k];
      if (aVal === 0 || aVal === undefined) {
        continue;
      }

      multiplyAccumulate(
        aVal,
        k,
        jj,
        jEnd,
        bTransposed,
        resultRowOffset,
        result,
        bRows
      );
    }
  }
}

/**
 * Multiplies and accumulates a single value across a row
 */
function multiplyAccumulate(
  aVal: number,
  k: number,
  colStart: number,
  colEnd: number,
  bTransposed: Float32Array,
  resultRowOffset: number,
  result: Float32Array,
  bCols: number
): void {
  let j = colStart;
  const jLimit = colEnd - 3;

  // 4x unrolled loop
  for (; j < jLimit; j += 4) {
    const idx0 = j * bCols + k;
    const idx1 = (j + 1) * bCols + k;
    const idx2 = (j + 2) * bCols + k;
    const idx3 = (j + 3) * bCols + k;

    // Float32Array indexed access always returns number at runtime
    const b0 = bTransposed[idx0] as number;
    const b1 = bTransposed[idx1] as number;
    const b2 = bTransposed[idx2] as number;
    const b3 = bTransposed[idx3] as number;

    result[resultRowOffset + j] =
      (result[resultRowOffset + j] as number) + aVal * b0;
    result[resultRowOffset + j + 1] =
      (result[resultRowOffset + j + 1] as number) + aVal * b1;
    result[resultRowOffset + j + 2] =
      (result[resultRowOffset + j + 2] as number) + aVal * b2;
    result[resultRowOffset + j + 3] =
      (result[resultRowOffset + j + 3] as number) + aVal * b3;
  }

  // Remaining elements
  for (; j < colEnd; j++) {
    const bVal = bTransposed[j * bCols + k] as number;
    result[resultRowOffset + j] =
      (result[resultRowOffset + j] as number) + aVal * bVal;
  }
}

/**
 * Converts Float32Array result to number[][]
 */
function convertToNumberArray(
  result: Float32Array,
  aRows: number,
  bCols: number
): number[][] {
  const resultMatrix: number[][] = [];
  for (let i = 0; i < aRows; i++) {
    const row: number[] = [];
    const rowOffset = i * bCols;
    for (let j = 0; j < bCols; j++) {
      // Float32Array always returns number, never undefined
      const value = result[rowOffset + j];
      if (value !== undefined) {
        row.push(value);
      }
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

// ============================================================================
// Gradient Computation Utilities
// ============================================================================

/**
 * Performs element-wise addition of two matrices.
 * Used for accumulating gradients across batch samples.
 *
 * @param a - First matrix
 * @param b - Second matrix
 * @returns Matrix with element-wise sum
 * @throws Error if matrices have different dimensions
 */
export function addMatrix(a: number[][], b: number[][]): number[][] {
  if (a.length !== b.length || a[0]?.length !== b[0]?.length) {
    throw new Error(
      `Matrix dimension mismatch: (${a.length}×${a[0]?.length}) vs (${b.length}×${b[0]?.length})`
    );
  }

  return a.map((row, i) => row.map((val, j) => val + (b[i]?.[j] ?? 0)));
}

/**
 * Performs element-wise subtraction of two matrices.
 * Used for gradient accumulation (accumulated - new) or computing differences.
 *
 * @param a - First matrix (minuend)
 * @param b - Second matrix (subtrahend)
 * @returns Matrix with element-wise difference (a - b)
 * @throws Error if matrices have different dimensions
 */
export function subtractMatrix(a: number[][], b: number[][]): number[][] {
  if (a.length !== b.length || a[0]?.length !== b[0]?.length) {
    throw new Error(
      `Matrix dimension mismatch: (${a.length}×${a[0]?.length}) vs (${b.length}×${b[0]?.length})`
    );
  }

  return a.map((row, i) => row.map((val, j) => val - (b[i]?.[j] ?? 0)));
}

/**
 * Multiplies a matrix by a scalar.
 * Used for scaling gradients by learning rate or advantage.
 *
 * @param matrix - Matrix to scale
 * @param scalar - Scalar multiplier
 * @returns Scaled matrix
 */
export function scaleMatrix(matrix: number[][], scalar: number): number[][] {
  if (scalar === 0) {
    // Return zero matrix of same dimensions
    return matrix.map((row) => row.map(() => 0));
  }

  if (scalar === 1) {
    // Return copy of original matrix
    return matrix.map((row) => [...row]);
  }

  return matrix.map((row) => row.map((val) => val * scalar));
}

/**
 * Computes the outer product of two vectors.
 * Result: (n×1) × (1×m) → (n×m)
 *
 * Used in simplified gradient approximations where:
 * ∇W ≈ η·(R-b)·q·q^T or η·(R-b)·m·m^T
 *
 * For exact REINFORCE, this may be used for initialization or simplifications.
 *
 * @param a - First vector (column vector, size n)
 * @param b - Second vector (row vector, size m)
 * @returns Outer product matrix (n×m)
 */
export function outerProduct(a: number[], b: number[]): number[][] {
  return a.map((aVal) => b.map((bVal) => aVal * bVal));
}

/**
 * Creates a zero matrix of specified dimensions.
 * Used for initializing gradient accumulators.
 *
 * @param rows - Number of rows
 * @param cols - Number of columns
 * @returns Zero matrix
 */
export function createZeroMatrix(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 0)
  );
}

/**
 * Clips matrix values to specified bounds.
 * Used to prevent gradient explosion in training.
 *
 * @param matrix - Matrix to clip
 * @param minVal - Minimum allowed value (default: -100)
 * @param maxVal - Maximum allowed value (default: 100)
 * @returns Clipped matrix
 */
export function clipMatrix(
  matrix: number[][],
  minVal = -100,
  maxVal = 100
): number[][] {
  return matrix.map((row) =>
    row.map((val) => Math.max(minVal, Math.min(maxVal, val)))
  );
}
