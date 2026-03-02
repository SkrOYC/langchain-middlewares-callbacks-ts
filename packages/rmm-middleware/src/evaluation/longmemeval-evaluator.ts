/**
 * LongMemEval Benchmark Evaluator
 *
 * Provides evaluation capabilities for the LongMemEval benchmark,
 * reproducing Table 1 results from the paper.
 */

import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import {
  computeMeanReciprocalRank,
  computeNdcgAtK,
  computeRecallAtK,
  computeSessionAccuracy,
} from "@/evaluation/metrics";
import {
  type LongMemEvalInstance,
  type LongMemEvalTurn,
  resolveSessionIndex,
} from "@/retrievers/oracle-retriever";

/**
 * Complete evaluation result for a retrieval run
 */
export interface EvaluationResult {
  recallAt5: number;
  ndcgAt5: number;
  accuracy: number;
  sessionAccuracy: number;
  recallAtTurnK: number;
  mrr: number;
  totalQuestions: number;
  abstentionCount: number;
  /** Number of instances that were actually evaluated (non-abstention) */
  evaluatedInstances: number;
  /** Number of instances that were skipped (abstention questions) */
  skippedInstances: number;
}

/**
 * Table 1 format metrics for comparison
 */
export interface Table1Metrics {
  retriever: string;
  recallAt5: number;
  ndcgAt5: number;
  accuracy: number;
  sessionAccuracy: number;
  recallAtTurnK: number;
}

/**
 * Configuration for LongMemEval Evaluator
 */
export interface LongMemEvalEvaluatorConfig {
  dataset: LongMemEvalInstance[];
  retriever: VectorStoreInterface;
  topK?: number;
  topM?: number;
}

/**
 * LongMemEval Benchmark Evaluator
 *
 * Evaluates retrieval systems on the LongMemEval benchmark,
 * providing metrics that can be compared against Table 1 results.
 */
export class LongMemEvalEvaluator {
  private readonly dataset: LongMemEvalInstance[];
  private readonly retriever: VectorStoreInterface;
  private readonly topK: number;
  private readonly topM: number;
  private lastResults?: EvaluationResult;

  constructor(config: LongMemEvalEvaluatorConfig) {
    this.dataset = config.dataset;
    this.retriever = config.retriever;
    this.topK = config.topK ?? 20;
    this.topM = config.topM ?? 5;
  }

  /**
   * Evaluates the configured retriever on the dataset
   *
   * @returns EvaluationResult with all metrics
   */
  async evaluate(): Promise<EvaluationResult> {
    let totalRecall5 = 0;
    let totalNdcg5 = 0;
    let totalSessionAccuracy = 0;
    let totalRecallAtTurnK = 0;
    let totalMRR = 0;
    let questionCount = 0;
    let abstentionCount = 0;

    for (const instance of this.dataset) {
      // Skip abstention questions (no ground truth)
      if (this.isAbstention(instance)) {
        abstentionCount++;
        continue;
      }

      // Retrieve memories for this question
      const retrieved = await this.retriever.similaritySearch(
        instance.question,
        this.topK
      );

      // Extract and apply final Top-M selection used for generation and metrics.
      const topKRetrievedSessionIds = retrieved
        .map((r) => r.metadata?.sessionId)
        .filter((id): id is string => id !== undefined);
      const topMRetrievedSessionIds = topKRetrievedSessionIds.slice(
        0,
        this.topM
      );

      // Compute Recall@5
      const recall5 = computeRecallAtK(
        topMRetrievedSessionIds,
        instance.answer_session_ids,
        5
      );
      totalRecall5 += recall5;

      // Compute NDCG@5
      const ndcg5 = computeNdcgAtK(
        topMRetrievedSessionIds,
        instance.answer_session_ids,
        5
      );
      totalNdcg5 += ndcg5;

      // Compute session accuracy
      const sessionAcc = computeSessionAccuracy(
        topMRetrievedSessionIds,
        instance.answer_session_ids
      );
      totalSessionAccuracy += sessionAcc;

      // Compute turn-level recall
      const turnRecall = computeRecallAtTurnKForInstance(
        instance,
        topMRetrievedSessionIds
      );
      totalRecallAtTurnK += turnRecall;

      // Compute MRR
      const mrr = computeMeanReciprocalRank(
        [topMRetrievedSessionIds],
        [instance.answer_session_ids]
      );
      totalMRR += mrr;

      questionCount++;
    }

    // accuracy = turn-level recall (proportion of answer-containing turns retrieved)
    // This matches the paper's Table 1 "Accuracy" metric
    const avgRecallAtTurnK =
      questionCount > 0 ? totalRecallAtTurnK / questionCount : 0;

    this.lastResults = {
      recallAt5: questionCount > 0 ? totalRecall5 / questionCount : 0,
      ndcgAt5: questionCount > 0 ? totalNdcg5 / questionCount : 0,
      accuracy: avgRecallAtTurnK, // Turn-level recall per paper definition
      sessionAccuracy:
        questionCount > 0 ? totalSessionAccuracy / questionCount : 0,
      recallAtTurnK: avgRecallAtTurnK,
      mrr: questionCount > 0 ? totalMRR / questionCount : 0,
      totalQuestions: questionCount,
      abstentionCount,
      evaluatedInstances: questionCount,
      skippedInstances: abstentionCount,
    };

    return this.lastResults;
  }

  /**
   * Gets metrics in Table 1 format
   *
   * Requires that evaluate() has been called first to generate metrics.
   *
   * @param retrieverName - Name of the retriever for display
   * @returns Table1Metrics ready for comparison
   * @throws Error if evaluate() has not been called
   */
  getTable1Metrics(retrieverName: string): Table1Metrics {
    if (!this.lastResults) {
      throw new Error(
        "No evaluation results available. Call evaluate() first."
      );
    }

    return {
      retriever: retrieverName,
      recallAt5: this.lastResults.recallAt5,
      ndcgAt5: this.lastResults.ndcgAt5,
      accuracy: this.lastResults.accuracy,
      sessionAccuracy: this.lastResults.sessionAccuracy,
      recallAtTurnK: this.lastResults.recallAtTurnK,
    };
  }

  /**
   * Checks if a question is an abstention question
   *
   * Abstention questions have question_id ending with "_abs" or
   * empty answer_session_ids, indicating no known answer.
   */
  private isAbstention(instance: LongMemEvalInstance): boolean {
    return (
      instance.question_id.endsWith("_abs") ||
      instance.question_type.endsWith("_abs") ||
      instance.answer_session_ids.length === 0
    );
  }

  /**
   * Gets the number of non-abstention questions
   */
  getQuestionCount(): number {
    return this.dataset.filter((i) => !this.isAbstention(i)).length;
  }

  /**
   * Gets the number of abstention questions
   */
  getAbstentionCount(): number {
    return this.dataset.filter((i) => this.isAbstention(i)).length;
  }
}

/**
 * Counts has_answer turns in a session
 */
function countHasAnswerTurns(session: LongMemEvalTurn[]): number {
  let count = 0;
  for (const turn of session) {
    if (turn.has_answer === true) {
      count++;
    }
  }
  return count;
}

/**
 * Gets session by ID from haystack
 */
function getSessionById(
  sessionId: string,
  instance: LongMemEvalInstance
): LongMemEvalTurn[] | undefined {
  const sessionIndex = resolveSessionIndex(sessionId, instance);
  if (sessionIndex >= 0 && sessionIndex < instance.haystack_sessions.length) {
    return instance.haystack_sessions[sessionIndex];
  }
  return undefined;
}

/**
 * Counts total has_answer turns in ground truth sessions
 */
function countGroundTruthHasAnswerTurns(instance: LongMemEvalInstance): number {
  let count = 0;
  for (const sessionId of instance.answer_session_ids) {
    const session = getSessionById(sessionId, instance);
    if (session !== undefined) {
      count += countHasAnswerTurns(session);
    }
  }
  return count;
}

/**
 * Counts has_answer turns in retrieved sessions that are in ground truth
 */
function countRetrievedHasAnswerTurns(
  retrievedSessionIds: string[],
  relevantSessions: Set<string>,
  instance: LongMemEvalInstance
): number {
  let count = 0;
  for (const sessionId of retrievedSessionIds) {
    if (!relevantSessions.has(sessionId)) {
      continue;
    }
    const session = getSessionById(sessionId, instance);
    if (session !== undefined) {
      count += countHasAnswerTurns(session);
    }
  }
  return count;
}

/**
 * Helper to compute turn-level recall for a single instance
 *
 * Turn-level recall measures the proportion of answer-containing turns
 * that are successfully retrieved, using the `has_answer` field from
 * the LongMemEval dataset.
 *
 * Per the LongMemEval paper:
 * - Turns that contain the required evidence have `has_answer: true`
 * - Turn-level recall = (retrieved turns with has_answer) / (total turns with has_answer)
 *
 * Since we retrieve at the session level, we consider all has_answer
 * turns in the retrieved sessions as "retrieved".
 *
 * @param instance - LongMemEval instance with haystack_sessions
 * @param retrievedSessionIds - IDs of sessions that were retrieved
 * @returns Turn-level recall in range [0, 1]
 */
function computeRecallAtTurnKForInstance(
  instance: LongMemEvalInstance,
  retrievedSessionIds: string[]
): number {
  // Build set of ground-truth sessions that contain has_answer turns
  const relevantSessions = new Set(instance.answer_session_ids);

  // Count total has_answer turns in ground truth
  const totalHasAnswerTurns = countGroundTruthHasAnswerTurns(instance);

  if (totalHasAnswerTurns === 0) {
    return 0;
  }

  // Count has_answer turns in retrieved sessions
  const retrievedHasAnswerTurns = countRetrievedHasAnswerTurns(
    retrievedSessionIds,
    relevantSessions,
    instance
  );

  return retrievedHasAnswerTurns / totalHasAnswerTurns;
}
