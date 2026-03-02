import { VoyageEmbeddings } from "@langchain/community/embeddings/voyage";
import type { AsyncCaller } from "@langchain/core/utils/async_caller";

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

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBooleanWithDefault(
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
  base: VoyageEmbeddings,
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
      output.push(ensureValidVector(vector, `Voyage embedding item ${i}`));
    } catch (error) {
      const prefix = cause
        ? ` after batch failure (${parseErrorMessage(cause)})`
        : "";
      throw new Error(
        `Voyage embeddings failed on item ${i}${prefix}: ${parseErrorMessage(error)}`
      );
    }
  }

  return output;
}

export function createEmbeddings() {
  const apiKey = requiredEnvAny(["VOYAGEAI_API_KEY", "VOYAGE_API_KEY"]);
  const outputDimension = Number(
    process.env.EVAL_EMBEDDING_DIMENSION ?? "1024"
  );
  const outputDtype = optionalEnv("EVAL_EMBEDDING_DTYPE");
  const encodingFormat = optionalEnv("EVAL_EMBEDDING_ENCODING");

  const base = new VoyageEmbeddings({
    apiKey,
    modelName: process.env.EVAL_EMBEDDINGS_MODEL ?? "voyage-4-lite",
    outputDimension,
    outputDtype,
    encodingFormat,
    truncation: parseBooleanWithDefault(
      process.env.EVAL_EMBEDDING_TRUNCATION,
      true
    ),
    batchSize: Number(process.env.EVAL_EMBEDDING_BATCH_SIZE ?? "8"),
  });

  const wrapped: EmbeddingsLike = {
    caller: base.caller,
    async embedQuery(text: string): Promise<number[]> {
      const vector = await base.embedQuery(text);
      return ensureValidVector(vector, "Voyage query embedding");
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
          ensureValidVector(vector, `Voyage embedding batch item ${idx}`)
        );
      } catch (error) {
        return embedIndividually(base, texts, error);
      }
    },
  };

  return wrapped;
}
