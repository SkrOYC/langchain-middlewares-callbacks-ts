import { ChatAnthropic } from "@langchain/anthropic";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createModel() {
  const anthropicApiKey = requiredEnv("ANTHROPIC_API_KEY");
  const anthropicApiUrl =
    process.env.ANTHROPIC_API_URL ?? process.env.ANTHROPIC_BASE_URL;

  return new ChatAnthropic({
    anthropicApiKey,
    anthropicApiUrl,
    model: process.env.EVAL_MODEL ?? "claude-3-5-sonnet-latest",
    temperature: Number(process.env.EVAL_TEMPERATURE ?? "1"),
    maxRetries: Number(process.env.EVAL_MAX_RETRIES ?? "2"),
    maxTokens: Number(process.env.EVAL_MAX_TOKENS ?? "16384"),
  });
}
