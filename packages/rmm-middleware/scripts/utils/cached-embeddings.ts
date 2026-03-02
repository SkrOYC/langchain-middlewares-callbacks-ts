import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Embeddings } from "@langchain/core/embeddings";
import { AsyncCaller } from "@langchain/core/utils/async_caller";

interface CacheEntry {
  offset: number;
  length: number;
}

interface CacheRecord {
  k: string;
  o: number;
  l: number;
}

interface PendingVector {
  key: string;
  vector: number[];
}

export interface CachedEmbeddingsStats {
  hits: number;
  misses: number;
  writes: number;
}

export interface CachedEmbeddingsOptions {
  cachePath: string;
  namespace: string;
}

/**
 * Persistent embeddings cache backed by two local files:
 * - `${cachePath}.bin`: Float32 vector data (append-only)
 * - `${cachePath}.index.jsonl`: key -> byte offset + length (append-only)
 */
export class CachedEmbeddings implements Embeddings {
  readonly caller: AsyncCaller;

  private readonly base: Embeddings;
  private readonly namespace: string;
  private readonly dataPath: string;
  private readonly indexPath: string;
  private readonly dataHandle: FileHandle;
  private readonly indexHandle: FileHandle;
  private readonly index = new Map<string, CacheEntry>();
  private readonly stats: CachedEmbeddingsStats = {
    hits: 0,
    misses: 0,
    writes: 0,
  };

  private nextOffset = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(
    base: Embeddings,
    namespace: string,
    dataPath: string,
    indexPath: string,
    dataHandle: FileHandle,
    indexHandle: FileHandle
  ) {
    this.base = base;
    this.namespace = namespace;
    this.dataPath = dataPath;
    this.indexPath = indexPath;
    this.dataHandle = dataHandle;
    this.indexHandle = indexHandle;
    this.caller = base.caller ?? new AsyncCaller({});
  }

  static async create(
    base: Embeddings,
    options: CachedEmbeddingsOptions
  ): Promise<CachedEmbeddings> {
    const basePath = resolve(options.cachePath);
    const dataPath = `${basePath}.bin`;
    const indexPath = `${basePath}.index.jsonl`;

    await mkdir(dirname(basePath), { recursive: true });

    const dataHandle = await open(dataPath, "a+");
    const indexHandle = await open(indexPath, "a+");

    const cache = new CachedEmbeddings(
      base,
      options.namespace,
      dataPath,
      indexPath,
      dataHandle,
      indexHandle
    );

    await cache.loadIndex();
    const dataStat = await cache.dataHandle.stat();
    cache.nextOffset = dataStat.size;
    cache.dropTruncatedEntries(dataStat.size);

    return cache;
  }

  async embedQuery(text: string): Promise<number[]> {
    const key = this.makeKey(text);
    const cached = await this.readCachedVector(key);
    if (cached) {
      this.stats.hits += 1;
      return cached;
    }

    this.stats.misses += 1;
    const vector = await this.base.embedQuery(text);
    validateVector(vector, "query embedding");
    await this.persistVectors([{ key, vector }]);
    return vector;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const output = new Array<number[]>(texts.length);
    const misses: Array<{ index: number; key: string; text: string }> = [];

    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i];
      if (text === undefined) {
        continue;
      }
      const key = this.makeKey(text);
      const cached = await this.readCachedVector(key);
      if (cached) {
        output[i] = cached;
        this.stats.hits += 1;
      } else {
        misses.push({ index: i, key, text });
      }
    }

    if (misses.length > 0) {
      this.stats.misses += misses.length;
      const computed = await this.base.embedDocuments(
        misses.map((m) => m.text)
      );

      if (computed.length !== misses.length) {
        throw new Error(
          `Embeddings adapter returned ${computed.length} vectors for ${misses.length} texts`
        );
      }

      const pendingWrites: PendingVector[] = [];
      for (let i = 0; i < misses.length; i += 1) {
        const miss = misses[i];
        const vector = computed[i];
        if (!(miss && vector)) {
          continue;
        }
        validateVector(vector, `document embedding at index ${i}`);
        output[miss.index] = vector;
        pendingWrites.push({ key: miss.key, vector });
      }

      await this.persistVectors(pendingWrites);
    }

    for (let i = 0; i < output.length; i += 1) {
      if (!output[i]) {
        throw new Error(`Missing embedding output at index ${i}`);
      }
    }

    return output;
  }

  getStats(): CachedEmbeddingsStats {
    return { ...this.stats };
  }

  getPaths(): { dataPath: string; indexPath: string } {
    return {
      dataPath: this.dataPath,
      indexPath: this.indexPath,
    };
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.writeChain;
    await this.dataHandle.close();
    await this.indexHandle.close();
    this.closed = true;
  }

  private async loadIndex(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.indexPath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return;
      }
      throw error;
    }

    const lines = raw.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as Partial<CacheRecord>;
        if (
          typeof parsed.k === "string" &&
          Number.isInteger(parsed.o) &&
          Number.isInteger(parsed.l) &&
          (parsed.o ?? -1) >= 0 &&
          (parsed.l ?? 0) > 0
        ) {
          this.index.set(parsed.k, {
            offset: parsed.o as number,
            length: parsed.l as number,
          });
        }
      } catch {
        // Ignore malformed line to keep cache resilient.
      }
    }
  }

  private dropTruncatedEntries(dataSize: number): void {
    for (const [key, entry] of this.index) {
      const byteLength = entry.length * 4;
      if (entry.offset + byteLength > dataSize) {
        this.index.delete(key);
      }
    }
  }

  private makeKey(text: string): string {
    return createHash("sha256")
      .update(this.namespace)
      .update("\n")
      .update(text)
      .digest("hex");
  }

  private async readCachedVector(key: string): Promise<number[] | null> {
    const entry = this.index.get(key);
    if (!entry) {
      return null;
    }

    const byteLength = entry.length * 4;
    const buffer = Buffer.allocUnsafe(byteLength);
    const { bytesRead } = await this.dataHandle.read(
      buffer,
      0,
      byteLength,
      entry.offset
    );
    if (bytesRead !== byteLength) {
      this.index.delete(key);
      return null;
    }

    const floatArray = new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      entry.length
    );
    return Array.from(floatArray);
  }

  private async persistVectors(vectors: PendingVector[]): Promise<void> {
    if (vectors.length === 0) {
      return;
    }

    await this.enqueueWrite(async () => {
      for (const item of vectors) {
        if (this.index.has(item.key)) {
          continue;
        }

        const float32 = Float32Array.from(item.vector);
        const bytes = Buffer.from(
          float32.buffer,
          float32.byteOffset,
          float32.byteLength
        );
        const offset = this.nextOffset;

        await this.dataHandle.write(bytes, 0, bytes.length, offset);
        this.nextOffset += bytes.length;

        this.index.set(item.key, { offset, length: float32.length });
        await this.indexHandle.write(
          `${JSON.stringify({
            k: item.key,
            o: offset,
            l: float32.length,
          } satisfies CacheRecord)}\n`
        );

        this.stats.writes += 1;
      }

      await this.dataHandle.sync();
      await this.indexHandle.sync();
    });
  }

  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(task, task);
    this.writeChain = next.catch(() => undefined);
    return next;
  }
}

function validateVector(
  vector: unknown,
  label: string
): asserts vector is number[] {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error(`Invalid ${label}: expected non-empty numeric array`);
  }
  if (!vector.every((value) => typeof value === "number")) {
    throw new Error(`Invalid ${label}: contains non-numeric values`);
  }
}
