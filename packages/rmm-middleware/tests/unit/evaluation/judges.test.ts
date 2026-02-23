import { describe, expect, test } from "bun:test";
import {
  buildLongMemEvalJudgePrompt,
  createExactMatchJudge,
  createMockJudge,
  createPromptJudge,
} from "@/evaluation/judges";

describe("judge adapters", () => {
  test("buildLongMemEvalJudgePrompt includes required fields", () => {
    const prompt = buildLongMemEvalJudgePrompt({
      question: "What is the favorite color?",
      referenceAnswer: "Blue",
      predictedAnswer: "It is blue",
    });

    expect(prompt).toContain("Question: What is the favorite color?");
    expect(prompt).toContain("Ground-truth Answer: Blue");
    expect(prompt).toContain("Response: It is blue");
  });

  test("createPromptJudge parses YES/NO responses", async () => {
    const yesJudge = createPromptJudge(async () => "YES");
    const noJudge = createPromptJudge(async () => "No");

    const yes = await yesJudge.judge({
      question: "Q",
      referenceAnswer: "A",
      predictedAnswer: "A",
    });
    const no = await noJudge.judge({
      question: "Q",
      referenceAnswer: "A",
      predictedAnswer: "B",
    });

    expect(yes.correct).toBe(true);
    expect(no.correct).toBe(false);
  });

  test("createPromptJudge accepts structured runner output", async () => {
    const judge = createPromptJudge(async () => ({
      correct: true,
      rawDecision: "YES",
      rawResponse: "yes",
    }));

    const decision = await judge.judge({
      question: "Q",
      referenceAnswer: "A",
      predictedAnswer: "A",
    });

    expect(decision.correct).toBe(true);
    expect(decision.rawDecision).toBe("YES");
  });

  test("createMockJudge allows deterministic resolver", async () => {
    const judge = createMockJudge((input) =>
      input.predictedAnswer.includes(input.referenceAnswer)
    );

    const yes = await judge.judge({
      question: "Q",
      referenceAnswer: "Blue",
      predictedAnswer: "Blue sky",
    });
    const no = await judge.judge({
      question: "Q",
      referenceAnswer: "Blue",
      predictedAnswer: "Green",
    });

    expect(yes.correct).toBe(true);
    expect(no.correct).toBe(false);
  });

  test("createExactMatchJudge enforces strict normalized equality", async () => {
    const judge = createExactMatchJudge();

    const yes = await judge.judge({
      question: "Q",
      referenceAnswer: " Blue ",
      predictedAnswer: "blue",
    });
    const no = await judge.judge({
      question: "Q",
      referenceAnswer: "Blue",
      predictedAnswer: "blue-ish",
    });

    expect(yes.correct).toBe(true);
    expect(no.correct).toBe(false);
  });
});
