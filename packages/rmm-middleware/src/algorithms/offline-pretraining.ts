/**
 * Offline Supervised Pretraining for Retriever Enhancement
 *
 * Implements supervised contrastive learning (Section 8.6) for
 * improving retrieval quality before online RL refinement.
 *
 * Key features:
 * - InfoNCE loss for contrastive learning
 * - Analytical gradient computation for weight updates
 * - Support for multiple embedding dimensions (768, 1536, 256, 512)
 * - Integration with existing RerankerState for weight storage
 *
 * Paper: "In Prospect and Retrospect: Reflective Memory Management for
 * Long-term Personalized Dialogue Agents" (ACL 2025)
 */

import type { RerankerState } from "@/schemas/index";

/**
 * Single contrastive training pair
 */
export interface ContrastivePair {
  query: number[];
  positive: number[];
  negatives: number[][];
}

/**
 * Configuration for offline pretraining
 */
export interface PretrainingConfig {
  temperature: number;
  learningRate: number;
  epochs: number;
  /**
   * Embedding dimension for the reranker matrices.
   * Must match the output dimension of your embeddings model.
   * - OpenAI ada-002: 1536
   * - Contriever: 768
   * - Stella: 256 or 512
   * - GTE: 768 or 1024
   */
  embeddingDimension?: number;
}

/**
 * Result of a training epoch
 */
export interface TrainingResult {
  epoch: number;
  loss: number;
  rerankerState: RerankerState;
}

/**
 * Computes cosine similarity between two vectors
 *
 * cos(a, b) = (a · b) / (||a|| * ||b||)
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity in range [-1, 1]
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  if (a.length === 0) {
    throw new Error("Cannot compute similarity for empty embeddings");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const normProduct = Math.sqrt(normA) * Math.sqrt(normB);

  if (normProduct === 0) {
    throw new Error("Zero norm embedding detected");
  }

  return dotProduct / normProduct;
}

/**
 * InfoNCE Loss for contrastive learning
 *
 * L = -log(exp(sim(q, p)/τ) / (exp(sim(q, p)/τ) + Σ exp(sim(q, n)/τ))
 *
 * This loss encourages:
 * - Positive pairs (q, p) to have high similarity
 * - Negative pairs (q, n) to have low similarity
 *
 * @param query - Query embedding vector (anchor)
 * @param positive - Positive memory embedding (relevant)
 * @param negatives - Array of negative memory embeddings (irrelevant)
 * @param temperature - Temperature scaling parameter τ (default: 0.07)
 * @returns InfoNCE loss value (lower is better)
 */
export function InfoNCE(
  query: number[],
  positive: number[],
  negatives: number[][],
  temperature = 0.07
): number {
  // Validate inputs
  if (query.length === 0) {
    throw new Error("Query embedding cannot be empty");
  }

  if (positive.length === 0) {
    throw new Error("Positive embedding cannot be empty");
  }

  if (negatives.length === 0) {
    throw new Error("At least one negative sample is required");
  }

  if (query.length !== positive.length) {
    throw new Error(
      `Query and positive embedding dimension mismatch: ${query.length} vs ${positive.length}`
    );
  }

  for (let i = 0; i < negatives.length; i++) {
    const neg = negatives[i];
    if (neg === undefined || neg.length !== query.length) {
      throw new Error(
        `Negative embedding ${i} dimension mismatch: expected ${query.length}, got ${neg?.length ?? 0}`
      );
    }
  }

  if (temperature <= 0) {
    throw new Error(`Temperature must be positive, got ${temperature}`);
  }

  // Compute similarities
  const posSim = cosineSimilarity(query, positive);
  const negSims = negatives.map((neg) => cosineSimilarity(query, neg));

  // Apply temperature scaling
  const scaledPosSim = posSim / temperature;
  const scaledNegSims = negSims.map((sim) => sim / temperature);

  // Compute log-softmax (numerically stable)
  // log(Σ exp(scaled_i)) = max_scaled + log(Σ exp(scaled_i - max_scaled))
  const maxScaled = Math.max(scaledPosSim, ...scaledNegSims);
  let sumExp = Math.exp(scaledPosSim - maxScaled);

  for (const scaledNeg of scaledNegSims) {
    sumExp += Math.exp(scaledNeg - maxScaled);
  }

  // Loss = -log(exp(pos) / Σ exp(all))
  // = -(pos - log(Σ exp(all)))
  // = log(Σ exp(all)) - pos
  const logSumExp = maxScaled + Math.log(sumExp);
  const loss = logSumExp - scaledPosSim;

  return loss;
}

/**
 * Supervised Contrastive Loss with batch support
 *
 * Extends InfoNCE to handle multiple positive pairs in a batch,
 * where positives are other samples with the same label.
 *
 * @param features - Normalized embedding vectors [batchSize, dim]
 * @param labels - Sample labels for supervised grouping
 * @param temperature - Temperature scaling parameter
 * @returns Supervised contrastive loss
 */
export function SupervisedContrastiveLoss(
  features: number[][],
  labels: number[],
  temperature = 0.07
): number {
  if (features.length === 0) {
    throw new Error("Features array cannot be empty");
  }

  if (features.length !== labels.length) {
    throw new Error(
      `Features and labels length mismatch: ${features.length} vs ${labels.length}`
    );
  }

  if (temperature <= 0) {
    throw new Error(`Temperature must be positive, got ${temperature}`);
  }

  const batchSize = features.length;
  let totalLoss = 0;
  let numPairs = 0;

  // For each sample, compute loss relative to other samples with same label
  for (let i = 0; i < batchSize; i++) {
    const anchor = features[i];
    if (anchor === undefined) {
      continue;
    }
    const anchorLabel = labels[i];

    // Find positives (other samples with same label)
    const positives: number[] = [];
    const negatives: number[] = [];

    for (let j = 0; j < batchSize; j++) {
      if (i === j) {
        continue;
      }

      const feature = features[j];
      if (feature === undefined) {
        continue;
      }

      const sim = cosineSimilarity(anchor, feature);
      const label = labels[j];

      if (label === anchorLabel) {
        positives.push(sim);
      } else {
        negatives.push(sim);
      }
    }

    // Skip if no positives or no negatives in batch
    if (positives.length === 0 || negatives.length === 0) {
      continue;
    }

    // Compute supervised contrastive loss for this anchor
    // For each positive, compute InfoNCE loss against all negatives
    for (const posSim of positives) {
      // InfoNCE: -log(exp(pos/τ) / (exp(pos/τ) + Σ exp(neg/τ)))
      const scaledPos = posSim / temperature;
      const scaledNegs = negatives.map((s) => s / temperature);

      // Numerically stable softmax computation
      const maxScaled = Math.max(scaledPos, ...scaledNegs);
      const posExp = Math.exp(scaledPos - maxScaled);
      const negExpSum = scaledNegs.reduce(
        (sum, s) => sum + Math.exp(s - maxScaled),
        0
      );

      // Loss = -log(p_pos) = log(Σ exp) - log(exp(pos))
      const loss = Math.log(posExp + negExpSum) - Math.log(posExp);
      totalLoss += loss;
      numPairs++;
    }
  }

  return numPairs > 0 ? totalLoss / numPairs : 0;
}

/**
 * Offline Pretrainer for retriever enhancement
 *
 * Implements supervised contrastive pretraining as described in Section 8.6
 * to improve retrieval quality before online RL refinement.
 *
 * Uses analytical gradients for the InfoNCE loss:
 * - Computes ∂L/∂q and ∂L/∂m using similarity gradients
 * - Updates W_q and W_m using outer product approximation
 * - Applies gradient descent with learning rate
 */
export class OfflinePretrainer {
  private readonly config: PretrainingConfig;
  private readonly rerankerState: RerankerState;

  constructor(config: PretrainingConfig) {
    this.config = config;
    this.rerankerState = this.createInitialState();
  }

  /**
   * Creates initial reranker state with small random weights
   *
   * @param dim - Embedding dimension (inferred from config or defaults to 768)
   */
  private createInitialState(): RerankerState {
    const dim = this.config.embeddingDimension ?? 768;

    // Initialize with small random values per paper recommendation
    // queryTransform[i][j] ~ N(0, 0.01), memoryTransform[i][j] ~ N(0, 0.01)
    const initializeMatrix = (size: number): number[][] =>
      Array.from({ length: size }, () =>
        Array.from({ length: size }, () => this.gaussianRandom(0, 0.01))
      );

    return {
      weights: {
        queryTransform: initializeMatrix(dim),
        memoryTransform: initializeMatrix(dim),
      },
      config: {
        topK: 20,
        topM: 5,
        temperature: 0.5,
        learningRate: this.config.learningRate,
        baseline: 0.5,
      },
    };
  }

  /**
   * Box-Muller transform for Gaussian random numbers
   */
  private gaussianRandom(mean: number, std: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const safeU1 = u1 === 0 ? Number.MIN_VALUE : u1;
    const magnitude = Math.sqrt(-2.0 * Math.log(safeU1));
    const angle = 2.0 * Math.PI * u2;
    return mean + std * magnitude * Math.cos(angle);
  }

  /**
   * Trains the reranker on contrastive pairs using analytical gradients
   *
   * Implements gradient-based weight updates for the reranker:
   * 1. Compute InfoNCE loss and similarity gradients
   * 2. Compute embedding adaptation gradients (Equation 1)
   * 3. Apply gradient descent to W_q and W_m matrices
   *
   * @param pairs - Array of (query, positive, negatives) triples
   * @returns Training history with loss per epoch
   */
  async train(pairs: ContrastivePair[]): Promise<TrainingResult[]> {
    if (pairs.length === 0) {
      throw new Error("Training pairs cannot be empty");
    }

    // Validate embedding dimensions
    const dim = this.rerankerState.weights.queryTransform.length;
    for (const pair of pairs) {
      if (pair.query.length !== dim) {
        throw new Error(
          `Embedding dimension mismatch: expected ${dim}, got query=${pair.query.length}`
        );
      }
    }

    const history: TrainingResult[] = [];

    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      let epochLoss = 0;
      let numSamples = 0;

      // Accumulate gradients across batch
      const gradWQ = this.createZeroMatrix(dim, dim);
      const gradWM = this.createZeroMatrix(dim, dim);

      for (const pair of pairs) {
        // Compute loss and gradients for this sample
        const result = this.computeGradient(pair);

        epochLoss += result.loss;
        numSamples++;

        // Accumulate gradients (batch gradient descent)
        this.addToMatrix(
          gradWQ,
          this.scaleMatrix(result.gradWQ, 1 / pairs.length)
        );
        this.addToMatrix(
          gradWM,
          this.scaleMatrix(result.gradWM, 1 / pairs.length)
        );
      }

      // Apply gradients to weights
      const avgLoss = epochLoss / numSamples;

      // Gradient descent: W ← W - η * ∇W
      this.applyGradientDescent(gradWQ, gradWM);

      history.push({
        epoch,
        loss: avgLoss,
        rerankerState: this.deepCloneRerankerState(),
      });
    }

    return history;
  }

  /**
   * Computes analytical gradients for InfoNCE loss
   *
   * For InfoNCE: L = -log(exp(sim(q,p)/τ) / Σ exp(sim(q,n)/τ))
   *
   * Gradient w.r.t. positive similarity:
   * ∂L/∂sim(q,p) = softmax(sim(q,p)/τ) - 1
   *
   * Using chain rule and embedding adaptation:
   * ∂L/∂q = (∂L/∂sim) * ∂sim/∂q ≈ (∂L/∂sim) * m'
   * ∂L/∂m = (∂L/∂sim) * ∂sim/∂m ≈ (∂L/∂sim) * q'
   *
   * Weight gradients (outer product approximation):
   * ∂L/∂W_q ≈ ∂L/∂q * q^T
   * ∂L/∂W_m ≈ ∂L/∂m * m^T
   */
  private computeGradient(pair: ContrastivePair): {
    loss: number;
    gradWQ: number[][];
    gradWM: number[][];
  } {
    // Apply embedding adaptation: q' = q + W_q·q, m' = m + W_m·m
    const queryAdapted = this.applyTransformation(
      pair.query,
      this.rerankerState.weights.queryTransform
    );
    const posAdapted = this.applyTransformation(
      pair.positive,
      this.rerankerState.weights.memoryTransform
    );
    const negsAdapted = pair.negatives.map((neg) =>
      this.applyTransformation(neg, this.rerankerState.weights.memoryTransform)
    );

    // Compute similarities with adapted embeddings
    const posSim = cosineSimilarity(queryAdapted, posAdapted);
    const negSims = negsAdapted.map((neg) =>
      cosineSimilarity(queryAdapted, neg)
    );

    // Compute softmax probabilities
    const scaledPos = posSim / this.config.temperature;
    const scaledNegs = negSims.map((s) => s / this.config.temperature);
    const allScaled = [scaledPos, ...scaledNegs];

    // Softmax: p_i = exp(s_i/τ) / Σ exp(s_j/τ)
    const maxScaled = Math.max(...allScaled);
    const negExpSum = scaledNegs.map((s) => Math.exp(s - maxScaled));
    const sumExp =
      Math.exp(scaledPos - maxScaled) + negExpSum.reduce((a, b) => a + b, 0);

    const probs = allScaled.map((s) => Math.exp(s - maxScaled) / sumExp);
    const posProb = probs[0] ?? 0;

    if (posProb <= 0) {
      throw new Error("Invalid probability distribution in InfoNCE");
    }

    // InfoNCE loss
    const loss = -Math.log(posProb);

    // Gradient w.r.t. positive similarity
    // ∂L/∂sim = p_pos - 1
    const gradPosSim = posProb - 1;

    // Compute gradient vectors using the full derivative of cosine similarity.
    // The derivative of cos(u,v) w.r.t u is (v/|v| - cos(u,v)*u/|u|) / |u|.
    const queryNorm = this.vectorNorm(queryAdapted);
    const posNorm = this.vectorNorm(posAdapted);

    // Handle zero norm vectors to prevent division by zero.
    if (queryNorm === 0 || posNorm === 0) {
      const dim = pair.query.length;
      const zeroMatrix = this.createZeroMatrix(dim, dim);
      return { loss, gradWQ: zeroMatrix, gradWM: zeroMatrix };
    }

    const sim = posSim;

    // ∂L/∂q' = (∂L/∂sim) * (∂sim/∂q')
    // ∂sim/∂q = (p/|p| - sim*q/|q|) / |q|
    // Optimized: (p*|q| - sim*q*|p|) / (|q|^2 * |p|)
    const gradQuery = queryAdapted.map((q_i, i) => {
      const p_i = posAdapted[i] ?? 0;
      const gradSim = (p_i / posNorm - (sim * q_i) / queryNorm) / queryNorm;
      return gradPosSim * gradSim;
    });

    // ∂L/∂p' = (∂L/∂sim) * (∂sim/∂p')
    const gradPosMemory = posAdapted.map((p_i, i) => {
      const q_i = queryAdapted[i] ?? 0;
      const gradSim = (q_i / queryNorm - (sim * p_i) / posNorm) / posNorm;
      return gradPosSim * gradSim;
    });

    // Weight gradients using outer product approximation
    // ∂L/∂W_q ≈ ∂L/∂q * q^T
    const gradWQ = this.outerProduct(gradQuery, pair.query);

    // ∂L/∂W_m ≈ ∂L/∂m * m^T
    const gradWM = this.outerProduct(gradPosMemory, pair.positive);

    return { loss, gradWQ, gradWM };
  }

  /**
   * Applies linear transformation with residual: x' = x + W·x
   */
  private applyTransformation(x: number[], W: number[][]): number[] {
    const dim = W.length;
    const wx: number[] = new Array(dim).fill(0);

    // W · x
    for (let i = 0; i < dim; i++) {
      const row = W[i];
      if (row === undefined) {
        continue;
      }
      for (let j = 0; j < dim; j++) {
        const xVal = x[j];
        const rowVal = row[j];
        if (xVal !== undefined && rowVal !== undefined) {
          wx[i] += rowVal * xVal;
        }
      }
    }

    // x' = x + W·x
    return x.map((val, i) => val + (wx[i] ?? 0));
  }

  /**
   * Computes L2 norm of a vector
   */
  private vectorNorm(v: number[]): number {
    let sum = 0;
    for (let i = 0; i < v.length; i++) {
      const val = v[i] ?? 0;
      sum += val * val;
    }
    return Math.sqrt(sum);
  }

  /**
   * Scales a vector by a scalar
   */
  private scaleVector(v: number[], scalar: number): number[] {
    return v.map((val) => val * scalar);
  }

  /**
   * Creates a zero matrix
   */
  private createZeroMatrix(rows: number, cols: number): number[][] {
    return Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => 0)
    );
  }

  /**
   * Scales a matrix by a scalar
   */
  private scaleMatrix(m: number[][], scalar: number): number[][] {
    return m.map((row) =>
      row === undefined ? [] : row.map((val) => val * scalar)
    );
  }

  /**
   * Adds two matrices element-wise
   */
  private addToMatrix(a: number[][], b: number[][]): void {
    for (let i = 0; i < a.length; i++) {
      const rowA = a[i];
      const rowB = b[i];
      if (rowA === undefined || rowB === undefined) {
        continue;
      }
      for (let j = 0; j < rowA.length; j++) {
        const valA = rowA[j];
        const valB = rowB[j];
        if (valA !== undefined && valB !== undefined) {
          rowA[j] = valA + valB;
        }
      }
    }
  }

  /**
   * Computes outer product: u ⊗ v = [u_i * v_j]
   */
  private outerProduct(u: number[], v: number[]): number[][] {
    return u.map((ui) => v.map((vj) => ui * vj));
  }

  /**
   * Applies gradient descent to update weights
   */
  private applyGradientDescent(gradWQ: number[][], gradWM: number[][]): void {
    const lr = this.config.learningRate;

    // Update queryTransform (W_q)
    for (let i = 0; i < this.rerankerState.weights.queryTransform.length; i++) {
      const row = this.rerankerState.weights.queryTransform[i];
      const gradRow = gradWQ[i];
      if (row === undefined || gradRow === undefined) {
        continue;
      }
      for (let j = 0; j < row.length; j++) {
        const rowVal = row[j];
        const gradVal = gradRow[j];
        if (rowVal !== undefined && gradVal !== undefined) {
          row[j] = rowVal - lr * gradVal;
        }
      }
    }

    // Update memoryTransform (W_m)
    for (
      let i = 0;
      i < this.rerankerState.weights.memoryTransform.length;
      i++
    ) {
      const row = this.rerankerState.weights.memoryTransform[i];
      const gradRow = gradWM[i];
      if (row === undefined || gradRow === undefined) {
        continue;
      }
      for (let j = 0; j < row.length; j++) {
        const rowVal = row[j];
        const gradVal = gradRow[j];
        if (rowVal !== undefined && gradVal !== undefined) {
          row[j] = rowVal - lr * gradVal;
        }
      }
    }
  }

  /**
   * Creates a deep clone of the current reranker state
   * Used to capture state at each epoch for training history
   */
  private deepCloneRerankerState(): RerankerState {
    return {
      weights: {
        queryTransform: this.rerankerState.weights.queryTransform.map((row) => [
          ...row,
        ]),
        memoryTransform: this.rerankerState.weights.memoryTransform.map(
          (row) => [...row]
        ),
      },
      config: { ...this.rerankerState.config },
    };
  }

  /**
   * Gets the current reranker state (pretrained weights)
   */
  getRerankerState(): RerankerState {
    return this.deepCloneRerankerState();
  }

  /**
   * Evaluates the pretrained reranker on a test set
   *
   * @param pairs - Array of (query, positive, negatives) triples
   * @returns Mean loss and Recall@5 metric
   */
  async evaluate(pairs: ContrastivePair[]): Promise<{
    meanLoss: number;
    recallAt5: number;
  }> {
    let totalLoss = 0;
    let recallAt5Count = 0;

    for (const pair of pairs) {
      // Compute loss
      totalLoss += InfoNCE(
        pair.query,
        pair.positive,
        pair.negatives,
        this.config.temperature
      );

      // Compute Recall@5
      // Apply transformation to query and all memories
      const queryAdapted = this.applyTransformation(
        pair.query,
        this.rerankerState.weights.queryTransform
      );
      const posAdapted = this.applyTransformation(
        pair.positive,
        this.rerankerState.weights.memoryTransform
      );
      const negsAdapted = pair.negatives.map((neg) =>
        this.applyTransformation(neg, this.rerankerState.weights.memoryTransform)
      );

      // Compute similarities
      const posSim = cosineSimilarity(queryAdapted, posAdapted);
      const negSims = negsAdapted.map((neg) =>
        cosineSimilarity(queryAdapted, neg)
      );

      // Check if positive is in top-5
      // Count how many negatives have higher similarity than positive
      const higherNegs = negSims.filter((sim) => sim > posSim).length;

      // Positive is in top-5 if fewer than 5 negatives are more similar
      if (higherNegs < 5) {
        recallAt5Count++;
      }
    }

    return {
      meanLoss: totalLoss / pairs.length,
      recallAt5: pairs.length > 0 ? recallAt5Count / pairs.length : 0,
    };
  }
}
