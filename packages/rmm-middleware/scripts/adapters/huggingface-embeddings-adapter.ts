import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";

interface EmbeddingsLike {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

function ensureValidVector(vector: unknown, context: string): number[] {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error(`${context}: embedding vector is empty or invalid`);
  }

  if (!vector.every((value) => typeof value === "number")) {
    throw new Error(
      `${context}: embedding vector contains non-numeric values`
    );
  }

  return vector;
}

export function createEmbeddings() {
  const modelName = process.env.EVAL_EMBEDDINGS_MODEL ?? "BAAI/bge-small-en-v1.5";
  const outputDimension = Number(process.env.EVAL_EMBEDDING_DIMENSION ?? "384");

  const base = new HuggingFaceTransformersEmbeddings({
    model: modelName,
    modelName, // Alias for backward compatibility
  });

  const wrapped: EmbeddingsLike = {
    async embedQuery(text: string): Promise<number[]> {
      const vector = await base.embedQuery(text);
      return ensureValidVector(vector, "HuggingFace query embedding");
    },
    async embedDocuments(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) {
        return [];
      }

      const vectors = await base.embedDocuments(texts);
      return vectors.map((vector, idx) =>
        ensureValidVector(vector, `HuggingFace embedding batch item ${idx}`)
      );
    },
  };

  return wrapped;
}
