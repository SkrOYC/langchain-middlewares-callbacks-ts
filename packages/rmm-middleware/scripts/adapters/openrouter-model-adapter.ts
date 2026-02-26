import { ChatOpenAI } from "@langchain/openai";
import type { AgentEvalMethod } from "../../src/evaluation/agent-longmemeval-evaluator.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Map OPENROUTER_API_KEY to OPENAI_API_KEY for langchain/openai compatibility
const _openRouterApiKey = requiredEnv("OPENROUTER_API_KEY");
process.env.OPENAI_API_KEY = _openRouterApiKey;

export function createModel(_method: AgentEvalMethod) {
  return new ChatOpenAI({
    model: process.env.EVAL_MODEL ?? "nvidia/nemotron-3-nano-30b-a3b:free",
    temperature: Number(process.env.EVAL_TEMPERATURE ?? "0"),
    maxTokens: Number(process.env.EVAL_MAX_TOKENS ?? "16384"),
    maxRetries: Number(process.env.EVAL_MAX_RETRIES ?? "2"),
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
    },
  });
}
