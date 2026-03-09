import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createRotatingGemmaModel } from "./google-gemma-key-pool";

const judgeModelName =
  process.env.EVAL_JUDGE_MODEL ?? process.env.EVAL_MODEL ?? "gemma-3-27b-it";

const judgeModel = createRotatingGemmaModel(
  (googleApiKey) =>
    new ChatGoogleGenerativeAI({
      model: judgeModelName,
      apiKey: googleApiKey,
      temperature: 0,
      maxRetries: Number(process.env.EVAL_MAX_RETRIES ?? "2"),
      maxOutputTokens: Number(process.env.EVAL_JUDGE_MAX_TOKENS ?? "16384"),
    }),
  {
    poolTag: `judge:${judgeModelName}`,
  }
);

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
