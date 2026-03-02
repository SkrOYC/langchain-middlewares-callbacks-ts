import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Document } from "@langchain/core/documents";
import type { Embeddings } from "@langchain/core/embeddings";
import { getLogger } from "@/utils/logger";

interface UpsertRecord {
  op: "upsert";
  id: string;
  pageContent: string;
  metadata: Record<string, unknown>;
  vector: number[];
}

interface DeleteRecord {
  op: "delete";
  id: string;
}

type JournalRecord = UpsertRecord | DeleteRecord;

interface StoredEntry {
  id: string;
  pageContent: string;
  metadata: Record<string, unknown>;
  vector: number[];
}

export interface PersistentVectorStorePrebuildMarker {
  schemaVersion: 1;
  method: string;
  questionId: string;
  questionType: string;
  totalSessions: number;
  sessionsProcessed: number;
  extractedMemories: number;
  storedMemories: number;
  completedAt: string;
}

export interface PersistentVectorStorePrebuildProgress {
  schemaVersion: 1;
  method: string;
  questionId: string;
  questionType: string;
  totalSessions: number;
  sessionsProcessed: number;
  extractedMemories: number;
  storedMemories: number;
  updatedAt: string;
}

export interface PersistentSimpleVectorStoreOptions {
  embeddings: Embeddings;
  basePath: string;
}

const logger = getLogger("persistent-simple-vector-store");

/**
 * Disk-backed vector store for evaluation runs.
 *
 * Data model:
 * - `${basePath}.journal.jsonl`: append-only upsert/delete operations
 * - `${basePath}.complete.json`: optional marker written when prebuild completes
 * - `${basePath}.progress.json`: incremental prebuild checkpoint for resume
 *
 * This keeps memory banks durable across process restarts and supports delete-based merges.
 */
export class PersistentSimpleVectorStore {
  readonly embeddings: Embeddings;

  private readonly journalPath: string;
  private readonly completePath: string;
  private readonly progressPath: string;
  private readonly entriesById = new Map<string, StoredEntry>();
  private writeChain: Promise<void> = Promise.resolve();
  private generatedIdCounter = 0;
  private prebuildMarker: PersistentVectorStorePrebuildMarker | null = null;
  private prebuildProgress: PersistentVectorStorePrebuildProgress | null = null;

  private constructor(options: {
    embeddings: Embeddings;
    journalPath: string;
    completePath: string;
    progressPath: string;
  }) {
    this.embeddings = options.embeddings;
    this.journalPath = options.journalPath;
    this.completePath = options.completePath;
    this.progressPath = options.progressPath;
  }

  static async create(
    options: PersistentSimpleVectorStoreOptions
  ): Promise<PersistentSimpleVectorStore> {
    const basePath = resolve(options.basePath);
    await mkdir(dirname(basePath), { recursive: true });

    const store = new PersistentSimpleVectorStore({
      embeddings: options.embeddings,
      journalPath: `${basePath}.journal.jsonl`,
      completePath: `${basePath}.complete.json`,
      progressPath: `${basePath}.progress.json`,
    });

    await store.loadJournal();
    await store.loadCompleteMarker();
    await store.loadProgressMarker();
    return store;
  }

  hasDocuments(): boolean {
    return this.entriesById.size > 0;
  }

  getPrebuildMarker(): PersistentVectorStorePrebuildMarker | null {
    return this.prebuildMarker ? { ...this.prebuildMarker } : null;
  }

  getPrebuildProgress(): PersistentVectorStorePrebuildProgress | null {
    return this.prebuildProgress ? { ...this.prebuildProgress } : null;
  }

  async markPrebuildProgress(
    progress: PersistentVectorStorePrebuildProgress
  ): Promise<void> {
    this.prebuildProgress = {
      ...progress,
      schemaVersion: 1,
    };
    await writeFile(
      this.progressPath,
      `${JSON.stringify(this.prebuildProgress, null, 2)}\n`,
      "utf8"
    );
  }

  async markPrebuildComplete(
    marker: PersistentVectorStorePrebuildMarker
  ): Promise<void> {
    this.prebuildMarker = {
      ...marker,
      schemaVersion: 1,
    };
    this.prebuildProgress = null;
    await writeFile(
      this.completePath,
      `${JSON.stringify(this.prebuildMarker, null, 2)}\n`,
      "utf8"
    );
    await removeFileIfExists(this.progressPath);
  }

  async clearPrebuildProgress(): Promise<void> {
    this.prebuildProgress = null;
    await removeFileIfExists(this.progressPath);
  }

  async addDocuments(documents: Document[]): Promise<string[]> {
    if (documents.length === 0) {
      return [];
    }

    const vectors = await this.embeddings.embedDocuments(
      documents.map((doc) => doc.pageContent)
    );
    if (vectors.length !== documents.length) {
      throw new Error(
        `PersistentSimpleVectorStore received ${vectors.length} vectors for ${documents.length} documents`
      );
    }

    const records: JournalRecord[] = [];
    const ids: string[] = [];
    for (let i = 0; i < documents.length; i += 1) {
      const doc = documents[i];
      const vector = vectors[i];
      if (!(doc && vector)) {
        continue;
      }
      const metadata = normalizeMetadata(doc.metadata);
      const id = resolveDocumentId(doc, metadata, i, this.generatedIdCounter++);
      const pageContent = String(doc.pageContent ?? "");
      const normalizedVector = normalizeVector(vector);
      const entry: StoredEntry = {
        id,
        pageContent,
        metadata: {
          ...metadata,
          id,
        },
        vector: normalizedVector,
      };
      this.entriesById.set(id, entry);
      ids.push(id);
      records.push({
        op: "upsert",
        id,
        pageContent: entry.pageContent,
        metadata: entry.metadata,
        vector: entry.vector,
      });
    }

    await this.appendRecords(records);
    return ids;
  }

  async similaritySearch(query: string, k = 4): Promise<Document[]> {
    if (k <= 0 || this.entriesById.size === 0) {
      return [];
    }

    const queryVector = normalizeVector(
      await this.embeddings.embedQuery(query)
    );
    const ranked = [...this.entriesById.values()]
      .map((entry) => ({
        entry,
        score: cosineSimilarity(queryVector, entry.vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(
        ({ entry, score }) =>
          new Document({
            pageContent: entry.pageContent,
            metadata: {
              ...entry.metadata,
              score,
            },
          })
      );

    return ranked;
  }

  async delete(params?: { ids?: string[] } | string[]): Promise<void> {
    const ids = resolveDeleteIds(params);
    if (ids.length === 0) {
      return;
    }

    const records: JournalRecord[] = [];
    for (const id of ids) {
      if (!this.entriesById.has(id)) {
        continue;
      }
      this.entriesById.delete(id);
      records.push({
        op: "delete",
        id,
      });
    }
    await this.appendRecords(records);
  }

  private async loadJournal(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.journalPath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return;
      }
      throw error;
    }

    const lines = raw.split("\n");
    for (const line of lines) {
      this.applyJournalRecord(line.trim());
    }
  }

  private applyJournalRecord(trimmed: string): void {
    if (!trimmed) {
      return;
    }

    const record = this.parseJournalRecord(trimmed);
    if (!record) {
      return;
    }

    if (record.op === "upsert" && typeof record.id === "string") {
      const pageContent =
        typeof record.pageContent === "string" ? record.pageContent : "";
      const metadata = normalizeMetadata(record.metadata);
      const vector = normalizeVectorOrNull(record.vector);
      if (!vector) {
        logger.warn(
          `Skipping malformed journal upsert record without valid vector: ${record.id}`
        );
        return;
      }
      this.entriesById.set(record.id, {
        id: record.id,
        pageContent,
        metadata: {
          ...metadata,
          id: record.id,
        },
        vector,
      });
      return;
    }

    if (record.op === "delete" && typeof record.id === "string") {
      this.entriesById.delete(record.id);
    }
  }

  private parseJournalRecord(
    trimmed: string
  ):
    | (Partial<JournalRecord> & { metadata?: unknown; vector?: unknown })
    | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed as Partial<JournalRecord> & {
      metadata?: unknown;
      vector?: unknown;
    };
  }

  private async loadCompleteMarker(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.completePath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return;
      }
      throw error;
    }

    try {
      const parsed = JSON.parse(
        raw
      ) as Partial<PersistentVectorStorePrebuildMarker>;
      if (
        parsed &&
        parsed.schemaVersion === 1 &&
        typeof parsed.method === "string" &&
        typeof parsed.questionId === "string" &&
        typeof parsed.questionType === "string" &&
        Number.isFinite(parsed.totalSessions) &&
        Number.isFinite(parsed.sessionsProcessed) &&
        Number.isFinite(parsed.extractedMemories) &&
        Number.isFinite(parsed.storedMemories) &&
        typeof parsed.completedAt === "string"
      ) {
        this.prebuildMarker = {
          schemaVersion: 1,
          method: parsed.method,
          questionId: parsed.questionId,
          questionType: parsed.questionType,
          totalSessions: Number(parsed.totalSessions),
          sessionsProcessed: Number(parsed.sessionsProcessed),
          extractedMemories: Number(parsed.extractedMemories),
          storedMemories: Number(parsed.storedMemories),
          completedAt: parsed.completedAt,
        };
      }
    } catch {
      // Ignore malformed marker file to keep the store resilient.
    }
  }

  private async loadProgressMarker(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.progressPath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return;
      }
      throw error;
    }

    try {
      const parsed = JSON.parse(
        raw
      ) as Partial<PersistentVectorStorePrebuildProgress>;
      if (
        parsed &&
        parsed.schemaVersion === 1 &&
        typeof parsed.method === "string" &&
        typeof parsed.questionId === "string" &&
        typeof parsed.questionType === "string" &&
        Number.isFinite(parsed.totalSessions) &&
        Number.isFinite(parsed.sessionsProcessed) &&
        Number.isFinite(parsed.extractedMemories) &&
        Number.isFinite(parsed.storedMemories) &&
        typeof parsed.updatedAt === "string"
      ) {
        this.prebuildProgress = {
          schemaVersion: 1,
          method: parsed.method,
          questionId: parsed.questionId,
          questionType: parsed.questionType,
          totalSessions: Number(parsed.totalSessions),
          sessionsProcessed: Number(parsed.sessionsProcessed),
          extractedMemories: Number(parsed.extractedMemories),
          storedMemories: Number(parsed.storedMemories),
          updatedAt: parsed.updatedAt,
        };
      }
    } catch {
      // Ignore malformed progress marker file to keep resume resilient.
    }
  }

  private async appendRecords(records: JournalRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const payload = records.map((record) => JSON.stringify(record)).join("\n");
    await this.enqueueWrite(async () => {
      await appendFile(this.journalPath, `${payload}\n`, "utf8");
    });
  }

  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(task, task);
    this.writeChain = next.catch(() => undefined);
    return next;
  }
}

async function removeFileIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return {
    ...(value as Record<string, unknown>),
  };
}

function normalizeVector(vector: unknown): number[] {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Expected non-empty numeric embedding vector");
  }
  if (!vector.every((value) => typeof value === "number")) {
    throw new Error("Embedding vector contains non-numeric values");
  }
  return [...vector];
}

function normalizeVectorOrNull(vector: unknown): number[] | null {
  try {
    return normalizeVector(vector);
  } catch {
    return null;
  }
}

function resolveDocumentId(
  doc: Document,
  metadata: Record<string, unknown>,
  index: number,
  counter: number
): string {
  if (typeof metadata.id === "string" && metadata.id.length > 0) {
    return metadata.id;
  }

  const hash = createHash("sha256")
    .update(String(doc.pageContent ?? ""))
    .update("\n")
    .update(JSON.stringify(metadata))
    .update("\n")
    .update(String(index))
    .update("\n")
    .update(String(counter))
    .digest("hex")
    .slice(0, 24);
  return `doc-${hash}`;
}

function resolveDeleteIds(params?: { ids?: string[] } | string[]): string[] {
  if (Array.isArray(params)) {
    return params.filter(
      (id): id is string => typeof id === "string" && id.length > 0
    );
  }

  if (!params || typeof params !== "object" || !Array.isArray(params.ids)) {
    return [];
  }

  return params.ids.filter(
    (id): id is string => typeof id === "string" && id.length > 0
  );
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / Math.sqrt(normA * normB);
}
