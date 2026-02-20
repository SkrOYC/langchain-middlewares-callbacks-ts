/**
 * LongMemEval Benchmark Evaluator
 *
 * Provides evaluation capabilities for the LongMemEval benchmark,
 * reproducing Table 1 results from the paper.
 */

import type { VectorStoreInterface } from "@langchain/core/vectorstores";
import {
  computeMeanReciprocalRank,
  computeRecallAtK,
  computeSessionAccuracy,
} from "@/evaluation/metrics";
import {
  type LongMemEvalInstance,
  type LongMemEvalTurn,
  parseSessionIndex,
} from "@/retrievers/oracle-retriever";

/**
 * Complete evaluation result for a retrieval run
 */
export interface EvaluationResult {
  recallAt5: number;
  accuracy: number;
  sessionAccuracy: number;
  turnAccuracy: number;
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
  accuracy: number;
  sessionAccuracy: number;
  turnAccuracy: number;
}

/**
 * Configuration for LongMemEval Evaluator
 */
export interface LongMemEvalEvaluatorConfig {
  dataset: LongMemEvalInstance[];
  retriever: VectorStoreInterface;
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
  private lastResults?: EvaluationResult;

  constructor(config: LongMemEvalEvaluatorConfig) {
    this.dataset = config.dataset;
    this.retriever = config.retriever;
  }

  /**
   * Evaluates the configured retriever on the dataset
   *
   * @returns EvaluationResult with all metrics
   */
  async evaluate(): Promise<EvaluationResult> {
    let totalRecall5 = 0;
    let totalSessionAccuracy = 0;
    let totalTurnAccuracy = 0;
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
        10
      );

      // Extract retrieved session IDs
      const retrievedSessionIds = retrieved
        .map((r) => r.metadata?.sessionId)
        .filter((id): id is string => id !== undefined);

      // Compute Recall@5
      const recall5 = computeRecallAtK(
        retrievedSessionIds,
        instance.answer_session_ids,
        5
      );
      totalRecall5 += recall5;

      // Compute session accuracy
      const sessionAcc = computeSessionAccuracy(
        retrievedSessionIds,
        instance.answer_session_ids
      );
      totalSessionAccuracy += sessionAcc;

      // Compute turn accuracy
      const turnAcc = computeTurnAccuracyForInstance(
        instance,
        retrievedSessionIds
      );
      totalTurnAccuracy += turnAcc;

      // Compute MRR
      const mrr = computeMeanReciprocalRank(
        [retrievedSessionIds],
        [instance.answer_session_ids]
      );
      totalMRR += mrr;

      questionCount++;
    }

    // accuracy = turn-level accuracy (proportion of answer-containing turns retrieved)
    // This matches the paper's Table 1 "Accuracy" metric
    const avgTurnAccuracy =
      questionCount > 0 ? totalTurnAccuracy / questionCount : 0;

    this.lastResults = {
      recallAt5: questionCount > 0 ? totalRecall5 / questionCount : 0,
      accuracy: avgTurnAccuracy, // Turn-level accuracy per paper definition
      sessionAccuracy:
        questionCount > 0 ? totalSessionAccuracy / questionCount : 0,
      turnAccuracy: avgTurnAccuracy,
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
      accuracy: this.lastResults.accuracy,
      sessionAccuracy: this.lastResults.sessionAccuracy,
      turnAccuracy: this.lastResults.turnAccuracy,
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
  haystack: LongMemEvalTurn[][]
): LongMemEvalTurn[] | undefined {
  const sessionIndex = parseSessionIndex(sessionId);
  if (sessionIndex >= 0 && sessionIndex < haystack.length) {
    return haystack[sessionIndex];
  }
  return undefined;
}

/**
 * Counts total has_answer turns in ground truth sessions
 */
function countGroundTruthHasAnswerTurns(
  answerSessionIds: string[],
  haystack: LongMemEvalTurn[][]
): number {
  let count = 0;
  for (const sessionId of answerSessionIds) {
    const session = getSessionById(sessionId, haystack);
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
  haystack: LongMemEvalTurn[][]
): number {
  let count = 0;
  for (const sessionId of retrievedSessionIds) {
    if (!relevantSessions.has(sessionId)) {
      continue;
    }
    const session = getSessionById(sessionId, haystack);
    if (session !== undefined) {
      count += countHasAnswerTurns(session);
    }
  }
  return count;
}

/**
 * Helper to compute turn accuracy for a single instance
 *
 * Turn accuracy measures the proportion of answer-containing turns
 * that are successfully retrieved, using the `has_answer` field from
 * the LongMemEval dataset.
 *
 * Per the LongMemEval paper:
 * - Turns that contain the required evidence have `has_answer: true`
 * - Turn-level accuracy = (retrieved turns with has_answer) / (total turns with has_answer)
 *
 * Since we retrieve at the session level, we consider all has_answer
 * turns in the retrieved sessions as "retrieved".
 *
 * @param instance - LongMemEval instance with haystack_sessions
 * @param retrievedSessionIds - IDs of sessions that were retrieved
 * @returns Turn accuracy in range [0, 1]
 */
function computeTurnAccuracyForInstance(
  instance: LongMemEvalInstance,
  retrievedSessionIds: string[]
): number {
  // Build set of ground-truth sessions that contain has_answer turns
  const relevantSessions = new Set(instance.answer_session_ids);

  // Count total has_answer turns in ground truth
  const totalHasAnswerTurns = countGroundTruthHasAnswerTurns(
    instance.answer_session_ids,
    instance.haystack_sessions
  );

  if (totalHasAnswerTurns === 0) {
    return 0;
  }

  // Count has_answer turns in retrieved sessions
  const retrievedHasAnswerTurns = countRetrievedHasAnswerTurns(
    retrievedSessionIds,
    relevantSessions,
    instance.haystack_sessions
  );

  return retrievedHasAnswerTurns / totalHasAnswerTurns;
}
