import { ChatOpenAI } from "@langchain/openai";
import type { AgentEvalMethod } from "../../src/evaluation/agent-longmemeval-evaluator.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createModel(_method: AgentEvalMethod) {
  const openRouterApiKey = requiredEnv("OPENROUTER_API_KEY");

  return new ChatOpenAI({
    openAIApiKey: openRouterApiKey,
    model: process.env.EVAL_MODEL ?? "nvidia/nemotron-3-nano-30b-a3b",
    temperature: Number(process.env.EVAL_TEMPERATURE ?? "0"),
    maxTokens: Number(process.env.EVAL_MAX_TOKENS ?? "16384"),
    maxRetries: Number(process.env.EVAL_MAX_RETRIES ?? "2"),
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
    },
  });
}
