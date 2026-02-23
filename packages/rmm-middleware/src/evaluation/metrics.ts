/**
 * Evaluation Metrics for RMM (Reflective Memory Management)
 *
 * Provides standard information retrieval metrics for evaluating
 * memory retrieval quality on LongMemEval benchmark.
 */

/**
 * Complete evaluation metrics for a retrieval system
 */
export interface EvaluationMetrics {
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  ndcgAt1: number;
  ndcgAt5: number;
  ndcgAt10: number;
  mrr: number;
  sessionAccuracy: number;
  recallAtTurnK: number;
}

/**
 * Result of Recall@K computation
 */
export interface RecallResult {
  recall: number;
  retrievedCount: number;
  relevantCount: number;
  hits: string[];
}

/**
 * Result of MRR computation
 */
export interface MRRResult {
  mrr: number;
  reciprocalRanks: number[];
}

/**
 * Computes Recall@K for a single query
 *
 * Recall@K = |Relevant ∩ Retrieved@K| / |Relevant|
 *
 * Measures the proportion of relevant items that appear in the
 * top-K retrieved results.
 *
 * @param retrieved - Ordered list of retrieved document/session IDs
 * @param relevant - Set of relevant document/session IDs
 * @param k - Number of top results to consider
 * @returns Recall value in range [0, 1]
 */
export function computeRecallAtK(
  retrieved: string[],
  relevant: string[],
  k: number
): number {
  if (relevant.length === 0) {
    return 0;
  }

  // Limit to top K results
  const topK = retrieved.slice(0, k);

  // Create set for O(1) lookup (deduplicates retrieved IDs)
  const relevantSet = new Set(relevant);
  const retrievedSet = new Set(topK);

  // Count hits: relevant items found in retrieved (deduplicated)
  const hits = [...retrievedSet].filter((id) => relevantSet.has(id)).length;

  // Recall = hits / total relevant
  return hits / relevant.length;
}

/**
 * Computes Mean Reciprocal Rank (MRR)
 *
 * MRR = (1/Q) * Σ(1/rank_i)
 *
 * Where rank_i is the position of the first relevant item for query i.
 * Measures how quickly the retriever finds relevant items.
 *
 * @param retrieved - Array of retrieved lists (one per query)
 * @param relevant - Array of relevant sets (one per query)
 * @returns MRR value in range [0, 1]
 */
export function computeMeanReciprocalRank(
  retrieved: string[][],
  relevant: string[][]
): number {
  if (retrieved.length === 0) {
    return 0;
  }

  const reciprocalRanks: number[] = [];

  for (let i = 0; i < retrieved.length; i++) {
    const queryRetrieved = retrieved[i];
    const queryRelevantArr = relevant[i];

    if (queryRetrieved === undefined || queryRelevantArr === undefined) {
      reciprocalRanks.push(0);
      continue;
    }

    const queryRelevant = new Set(queryRelevantArr);

    // Find rank of first relevant item
    let rank = 0;
    for (let j = 0; j < queryRetrieved.length; j++) {
      const retrievedId = queryRetrieved[j];
      if (retrievedId !== undefined && queryRelevant.has(retrievedId)) {
        rank = j + 1; // 1-indexed
        break;
      }
    }

    // Reciprocal rank: 1/rank (or 0 if not found)
    reciprocalRanks.push(rank > 0 ? 1 / rank : 0);
  }

  // Mean of reciprocal ranks
  const sum = reciprocalRanks.reduce((acc, rr) => acc + rr, 0);
  return sum / retrieved.length;
}

/**
 * Computes NDCG@K for a single query with binary relevance.
 *
 * NDCG@K = DCG@K / IDCG@K
 *
 * With binary relevance labels:
 * DCG@K = Σ((rel_i) / log2(i + 1)), i starts at rank 1
 *
 * @param retrieved - Ordered list of retrieved IDs
 * @param relevant - Set of relevant IDs
 * @param k - Number of top results to consider
 * @returns NDCG value in range [0, 1]
 */
export function computeNdcgAtK(
  retrieved: string[],
  relevant: string[],
  k: number
): number {
  if (k <= 0 || relevant.length === 0) {
    return 0;
  }

  const relevantSet = new Set(relevant);
  const topK = retrieved.slice(0, k);
  let dcg = 0;

  for (let index = 0; index < topK.length; index++) {
    const retrievedId = topK[index];
    if (retrievedId !== undefined && relevantSet.has(retrievedId)) {
      const rank = index + 1;
      dcg += 1 / Math.log2(rank + 1);
    }
  }

  const idealCount = Math.min(k, relevantSet.size);
  let idcg = 0;
  for (let index = 1; index <= idealCount; index++) {
    idcg += 1 / Math.log2(index + 1);
  }

  if (idcg === 0) {
    return 0;
  }

  return dcg / idcg;
}

/**
 * Computes session-level accuracy for LongMemEval
 *
 * Session Accuracy = |Retrieved ∩ AnswerSessions| / |AnswerSessions|
 *
 * Measures how well the retriever finds the evidence sessions
 * that contain the answer to the question.
 *
 * @param retrievedSessions - Sessions retrieved by the system
 * @param answerSessionIds - Ground-truth evidence sessions
 * @returns Accuracy value in range [0, 1]
 */
export function computeSessionAccuracy(
  retrievedSessions: string[],
  answerSessionIds: string[]
): number {
  if (answerSessionIds.length === 0) {
    return 0;
  }

  const retrievedSet = new Set(retrievedSessions);
  const answerSet = new Set(answerSessionIds);

  // Count intersection
  let intersection = 0;
  for (const session of answerSet) {
    if (retrievedSet.has(session)) {
      intersection++;
    }
  }

  // Accuracy = intersection / answer sessions
  return intersection / answerSessionIds.length;
}

/**
 * Computes turn-level recall for LongMemEval
 *
 * Recall@TurnK = (retrieved turns with has_answer) / (total turns with has_answer)
 *
 * Measures fine-grained recall at the turn level within sessions.
 * Only counts turns that are present in both the retrieved set and have answers.
 *
 * @param retrievedTurns - Array of turns that were retrieved
 * @param allTurns - Array of all turns in the ground truth with has_answer flags
 * @param hasAnswer - Boolean array indicating which turns contain the answer
 * @returns Recall value in range [0, 1]
 */
export function computeRecallAtTurnK(
  retrievedTurns: Array<{ role: string; content: string }>,
  allTurns: Array<{ role: string; content: string }>,
  hasAnswer: boolean[]
): number {
  if (allTurns.length === 0 || hasAnswer.length === 0) {
    return 0;
  }

  // Count total turns with has_answer in ground truth
  const totalAnswerTurns = hasAnswer.filter((has) => has).length;
  if (totalAnswerTurns === 0) {
    return 0;
  }

  // Count how many retrieved turns have answers
  // We match by content since we don't have turn IDs
  let retrievedAnswerTurns = 0;

  // Create a Set of retrieved turns for efficient O(1) lookups.
  // We use role:content as canonical key instead of JSON.stringify for robustness
  const retrievedTurnsSet = new Set(
    retrievedTurns.map((turn) => `${turn.role}:${turn.content}`)
  );

  for (let i = 0; i < Math.min(allTurns.length, hasAnswer.length); i++) {
    if (hasAnswer[i]) {
      const groundTruthTurn = allTurns[i];
      // Check if this turn is in the retrieved set
      if (
        groundTruthTurn &&
        retrievedTurnsSet.has(
          `${groundTruthTurn.role}:${groundTruthTurn.content}`
        )
      ) {
        retrievedAnswerTurns++;
      }
    }
  }

  return retrievedAnswerTurns / totalAnswerTurns;
}

/**
 * @deprecated Use computeRecallAtTurnK instead.
 */
export function computeTurnAccuracy(
  retrievedTurns: Array<{ role: string; content: string }>,
  allTurns: Array<{ role: string; content: string }>,
  hasAnswer: boolean[]
): number {
  return computeRecallAtTurnK(retrievedTurns, allTurns, hasAnswer);
}

/**
 * Computes all evaluation metrics for a retrieval run
 *
 * @param results - Array of retrieval results to evaluate
 * @returns Complete EvaluationMetrics object
 */
export function computeAllMetrics(
  results: Array<{
    retrieved: string[];
    relevant: string[];
    retrievedSessions?: string[];
    answerSessions?: string[];
    retrievedTurns?: Array<{ role: string; content: string }>;
    allTurns?: Array<{ role: string; content: string }>;
    hasAnswer?: boolean[];
  }>
): EvaluationMetrics {
  const allRetrieved: string[][] = [];
  const allRelevant: string[][] = [];
  let totalSessionAccuracy = 0;
  let totalRecallAtTurnK = 0;
  let sessionCount = 0;
  let turnCount = 0;

  for (const result of results) {
    allRetrieved.push(result.retrieved);
    allRelevant.push(result.relevant);

    if (result.retrievedSessions && result.answerSessions) {
      totalSessionAccuracy += computeSessionAccuracy(
        result.retrievedSessions,
        result.answerSessions
      );
      sessionCount++;
    }

    if (result.retrievedTurns && result.allTurns && result.hasAnswer) {
      totalRecallAtTurnK += computeRecallAtTurnK(
        result.retrievedTurns,
        result.allTurns,
        result.hasAnswer
      );
      turnCount++;
    }
  }

  return {
    recallAt1: computeMeanRecallAtK(allRetrieved, allRelevant, 1),
    recallAt5: computeMeanRecallAtK(allRetrieved, allRelevant, 5),
    recallAt10: computeMeanRecallAtK(allRetrieved, allRelevant, 10),
    ndcgAt1: computeMeanNdcgAtK(allRetrieved, allRelevant, 1),
    ndcgAt5: computeMeanNdcgAtK(allRetrieved, allRelevant, 5),
    ndcgAt10: computeMeanNdcgAtK(allRetrieved, allRelevant, 10),
    mrr: computeMeanReciprocalRank(allRetrieved, allRelevant),
    sessionAccuracy: sessionCount > 0 ? totalSessionAccuracy / sessionCount : 0,
    recallAtTurnK: turnCount > 0 ? totalRecallAtTurnK / turnCount : 0,
  };
}

/**
 * Helper: computes mean recall across multiple queries
 */
function computeMeanRecallAtK(
  retrieved: string[][],
  relevant: string[][],
  k: number
): number {
  if (retrieved.length === 0) {
    return 0;
  }

  let totalRecall = 0;
  for (let i = 0; i < retrieved.length; i++) {
    const queryRetrieved = retrieved[i];
    const queryRelevant = relevant[i];
    if (queryRetrieved === undefined || queryRelevant === undefined) {
      continue;
    }
    totalRecall += computeRecallAtK(queryRetrieved, queryRelevant, k);
  }

  return totalRecall / retrieved.length;
}

function computeMeanNdcgAtK(
  retrieved: string[][],
  relevant: string[][],
  k: number
): number {
  if (retrieved.length === 0) {
    return 0;
  }

  let totalNdcg = 0;
  for (let i = 0; i < retrieved.length; i++) {
    const queryRetrieved = retrieved[i];
    const queryRelevant = relevant[i];
    if (queryRetrieved === undefined || queryRelevant === undefined) {
      continue;
    }
    totalNdcg += computeNdcgAtK(queryRetrieved, queryRelevant, k);
  }

  return totalNdcg / retrieved.length;
}
