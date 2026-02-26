import { ChatOpenAI } from "@langchain/openai";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const judgeModel = new ChatOpenAI({
  openAIApiKey: requiredEnv("OPENROUTER_API_KEY"),
  model:
    process.env.EVAL_JUDGE_MODEL ??
    process.env.EVAL_MODEL ??
    "nvidia/nemotron-3-nano-30b-a3b:free",
  temperature: 0,
  maxRetries: Number(process.env.EVAL_MAX_RETRIES ?? "2"),
  maxTokens: Number(process.env.EVAL_JUDGE_MAX_TOKENS ?? "256"),
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
});

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
