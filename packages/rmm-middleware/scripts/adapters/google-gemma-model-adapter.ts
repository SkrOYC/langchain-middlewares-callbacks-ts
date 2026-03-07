import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { AgentEvalMethod } from "../../src/evaluation/agent-longmemeval-evaluator.js";
import { createRotatingGemmaModel } from "./google-gemma-key-pool";

export function createModel(_method: AgentEvalMethod) {
  return createRotatingGemmaModel(
    (googleApiKey) =>
      new ChatGoogleGenerativeAI({
        model: process.env.EVAL_MODEL ?? "gemma-3-27b-it",
        apiKey: googleApiKey,
        temperature: Number(process.env.EVAL_TEMPERATURE ?? "0"),
        maxRetries: Number(process.env.EVAL_MAX_RETRIES ?? "2"),
        maxOutputTokens: Number(process.env.EVAL_MAX_TOKENS ?? "16384"),
      })
  );
}
