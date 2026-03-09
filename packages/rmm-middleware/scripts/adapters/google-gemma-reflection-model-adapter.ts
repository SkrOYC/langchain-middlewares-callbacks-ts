import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { AgentEvalMethod } from "../../src/evaluation/agent-longmemeval-evaluator.js";
import { createRotatingGemmaModel } from "./google-gemma-key-pool";

export function createModel(_method: AgentEvalMethod) {
  const modelName =
    process.env.EVAL_REFLECTION_MODEL ??
    process.env.EVAL_MODEL ??
    "gemma-3-27b-it";

  return createRotatingGemmaModel(
    (googleApiKey) =>
      new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: googleApiKey,
        temperature: Number(process.env.EVAL_REFLECTION_TEMPERATURE ?? "1"),
        maxRetries: Number(process.env.EVAL_MAX_RETRIES ?? "2"),
        maxOutputTokens: Number(process.env.EVAL_MAX_TOKENS ?? "16384"),
      }),
    {
      poolTag: `reflection:${modelName}`,
    }
  );
}
