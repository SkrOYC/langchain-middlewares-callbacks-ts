import type { AsyncCaller } from "@langchain/core/utils/async_caller";
import { OpenAIEmbeddings } from "@langchain/openai";

interface EmbeddingsLike {
  caller: AsyncCaller;
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

function requiredEnvAny(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  throw new Error(
    `Missing required environment variable. Set one of: ${names.join(", ")}`
  );
}

// Map OPENROUTER_API_KEY to OPENAI_API_KEY for langchain/openai compatibility
const _apiKey = requiredEnvAny(["OPENROUTER_API_KEY"]);
process.env.OPENAI_API_KEY = _apiKey;

function _parseBooleanWithDefault(
  raw: string | undefined,
  fallback: boolean
): boolean {
  if (raw === undefined) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function ensureValidVector(vector: unknown, context: string): number[] {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error(`${context}: embedding vector is empty or invalid`);
  }

  if (!vector.every((value) => typeof value === "number")) {
    throw new Error(`${context}: embedding vector contains non-numeric values`);
  }

  return vector;
}

async function embedIndividually(
  base: OpenAIEmbeddings,
  texts: string[],
  cause?: unknown
): Promise<number[][]> {
  const output: number[][] = [];

  for (let i = 0; i < texts.length; i += 1) {
    const text = texts[i];
    if (text === undefined) {
      continue;
    }
    try {
      const vector = await base.embedQuery(text);
      output.push(ensureValidVector(vector, `OpenRouter embedding item ${i}`));
    } catch (error) {
      const prefix = cause
        ? ` after batch failure (${parseErrorMessage(cause)})`
        : "";
      throw new Error(
        `OpenRouter embeddings failed on item ${i}${prefix}: ${parseErrorMessage(error)}`
      );
    }
  }

  return output;
}

export function createEmbeddings() {
  const apiKey = requiredEnvAny(["OPENROUTER_API_KEY"]);
  const outputDimension = Number(
    process.env.EVAL_EMBEDDING_DIMENSION ?? "2048"
  );
  const encodingFormat = process.env.EVAL_EMBEDDING_ENCODING as
    | "base64"
    | "float"
    | undefined;

  const base = new OpenAIEmbeddings({
    model:
      process.env.EVAL_EMBEDDINGS_MODEL ??
      "nvidia/llama-nemotron-embed-vl-1b-v2:free",
    dimensions: outputDimension,
    encodingFormat,
    batchSize: Number(process.env.EVAL_EMBEDDING_BATCH_SIZE ?? "8"),
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
    },
  });

  const wrapped: EmbeddingsLike = {
    caller: base.caller,
    async embedQuery(text: string): Promise<number[]> {
      const vector = await base.embedQuery(text);
      return ensureValidVector(vector, "OpenRouter query embedding");
    },
    async embedDocuments(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) {
        return [];
      }

      try {
        const vectors = await base.embedDocuments(texts);
        if (!Array.isArray(vectors) || vectors.length !== texts.length) {
          return embedIndividually(base, texts);
        }
        return vectors.map((vector, idx) =>
          ensureValidVector(vector, `OpenRouter embedding batch item ${idx}`)
        );
      } catch (error) {
        return embedIndividually(base, texts, error);
      }
    },
  };

  return wrapped;
}
