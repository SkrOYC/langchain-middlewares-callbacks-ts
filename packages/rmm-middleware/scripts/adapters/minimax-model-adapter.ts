import { ChatAnthropic } from "@langchain/anthropic";
import type { AgentEvalMethod } from "../../src/evaluation/agent-longmemeval-evaluator.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createModel(_method: AgentEvalMethod) {
  const anthropicApiKey = requiredEnv("MINIMAX_API_KEY");
  const anthropicApiUrl = "https://api.minimax.io/anthropic";

  return new ChatAnthropic({
    anthropicApiKey,
    anthropicApiUrl,
    model: process.env.EVAL_MODEL ?? "MiniMax-M2.1",
    temperature: Number(process.env.EVAL_TEMPERATURE ?? "0"),
    maxRetries: Number(process.env.EVAL_MAX_RETRIES ?? "2"),
    maxTokens: Number(process.env.EVAL_MAX_TOKENS ?? "16384"),
  });
}
