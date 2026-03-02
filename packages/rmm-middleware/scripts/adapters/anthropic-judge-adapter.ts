import { ChatAnthropic } from "@langchain/anthropic";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const judgeModel = (() => {
  const anthropicApiKey = requiredEnv("ANTHROPIC_API_KEY");
  const anthropicApiUrl =
    process.env.ANTHROPIC_API_URL ?? process.env.ANTHROPIC_BASE_URL;

  return new ChatAnthropic({
    anthropicApiKey,
    anthropicApiUrl,
    model:
      process.env.EVAL_JUDGE_MODEL ??
      process.env.EVAL_MODEL ??
      "claude-3-5-sonnet-latest",
    temperature: Number(process.env.EVAL_JUDGE_TEMPERATURE ?? "0"),
    maxRetries: Number(process.env.EVAL_MAX_RETRIES ?? "2"),
    maxTokens: Number(process.env.EVAL_JUDGE_MAX_TOKENS ?? "256"),
  });
})();

export async function judgePrompt(prompt: string): Promise<string> {
  const response = await judgeModel.invoke(prompt);

  if (typeof response.content === "string") {
    return response.content;
  }

  if (Array.isArray(response.content)) {
    return response.content
      .filter((part) => part.type === "text")
      .map((part) => ("text" in part ? part.text : ""))
      .join("\n");
  }

  return "NO";
}
