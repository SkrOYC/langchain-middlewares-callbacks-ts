/**
 * Answer judge interfaces and adapters for LongMemEval evaluations.
 */

/**
 * Input payload for answer correctness judgement.
 */
export interface AnswerJudgeInput {
  question: string;
  referenceAnswer: string;
  predictedAnswer: string;
}

/**
 * Decision returned by an answer judge.
 */
export interface AnswerJudgeDecision {
  correct: boolean;
  rawDecision?: string;
  rawResponse?: string;
}

/**
 * Judge interface used by agent-level evaluation.
 */
export interface AnswerJudge {
  judge(input: AnswerJudgeInput): Promise<AnswerJudgeDecision>;
}

/**
 * Callback used by prompt-based judge adapters.
 */
export type PromptJudgeRunner = (
  prompt: string,
  input: AnswerJudgeInput
) => Promise<string | AnswerJudgeDecision>;
const VERDICT_YES_REGEX = /\bverdict\s*:\s*yes\b/i;
const VERDICT_NO_REGEX = /\bverdict\s*:\s*no\b/i;

/**
 * Builds a LongMemEval-style binary judgement prompt.
 */
export function buildLongMemEvalJudgePrompt(input: AnswerJudgeInput): string {
  return [
    "You are an expert language model evaluator. I will provide you with a question, a",
    "ground-truth answer, and a model-generated response. Your task is to determine whether",
    "the response correctly answers the question by following these evaluation rules:",
    "",
    "* Answer Yes if the response contains or directly matches the correct answer.",
    "* Answer Yes if the response includes all necessary intermediate steps leading to the",
    "  correct answer.",
    "* Answer No if the response provides only a partial answer or omits essential",
    "  information.",
    "* Answer No if the response does not sufficiently address the question.",
    "",
    "Additional Instructions:",
    "* Apply the evaluation criteria consistently.",
    "* Base your decision strictly on the information in the response.",
    "* Avoid subjective interpretations and adhere to the provided examples.",
    "",
    "Input:",
    `* Question: ${input.question}`,
    `* Ground-truth Answer: ${input.referenceAnswer}`,
    `* Response: ${input.predictedAnswer}`,
    "",
    "Output:",
    "Respond with exactly one token: Yes or No.",
  ].join("\n");
}

/**
 * Creates a provider-agnostic prompt judge adapter.
 */
export function createPromptJudge(runner: PromptJudgeRunner): AnswerJudge {
  return {
    async judge(input: AnswerJudgeInput): Promise<AnswerJudgeDecision> {
      const prompt = buildLongMemEvalJudgePrompt(input);
      const raw = await runner(prompt, input);

      if (typeof raw !== "string") {
        return {
          correct: raw.correct,
          rawDecision: raw.rawDecision,
          rawResponse: raw.rawResponse,
        };
      }

      const parsed = parseBinaryDecision(raw);
      const rawDecision = toRawDecision(parsed);
      return {
        correct: parsed ?? false,
        rawDecision,
        rawResponse: raw,
      };
    },
  };
}

/**
 * Creates a deterministic mock judge for tests.
 */
export function createMockJudge(
  resolver?: (input: AnswerJudgeInput) => boolean
): AnswerJudge {
  return {
    judge(input: AnswerJudgeInput): Promise<AnswerJudgeDecision> {
      return Promise.resolve({
        correct: resolver ? resolver(input) : true,
        rawDecision: "MOCK",
        rawResponse: "mock",
      });
    },
  };
}

/**
 * Creates a strict exact-match baseline judge.
 */
export function createExactMatchJudge(): AnswerJudge {
  return {
    judge(input: AnswerJudgeInput): Promise<AnswerJudgeDecision> {
      const normalize = (value: string) => value.trim().toLowerCase();
      const correct =
        normalize(input.referenceAnswer).length > 0 &&
        normalize(input.referenceAnswer) === normalize(input.predictedAnswer);
      return Promise.resolve({
        correct,
        rawDecision: correct ? "YES" : "NO",
        rawResponse: "exact-match",
      });
    },
  };
}

function parseBinaryDecision(raw: string): boolean | undefined {
  const normalized = raw.trim().toLowerCase();

  if (normalized === "yes" || normalized.startsWith("yes\n")) {
    return true;
  }

  if (normalized === "no" || normalized.startsWith("no\n")) {
    return false;
  }

  if (VERDICT_YES_REGEX.test(raw)) {
    return true;
  }

  if (VERDICT_NO_REGEX.test(raw)) {
    return false;
  }

  return undefined;
}

function toRawDecision(
  parsed: boolean | undefined
): "YES" | "NO" | "UNPARSEABLE" {
  if (parsed === undefined) {
    return "UNPARSEABLE";
  }
  return parsed ? "YES" : "NO";
}
