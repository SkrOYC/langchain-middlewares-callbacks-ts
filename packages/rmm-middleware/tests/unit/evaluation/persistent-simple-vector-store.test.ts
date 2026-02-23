import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document } from "@langchain/core/documents";
import type { Embeddings } from "@langchain/core/embeddings";
import { AsyncCaller } from "@langchain/core/utils/async_caller";
import { PersistentSimpleVectorStore } from "@/evaluation/persistent-simple-vector-store";

function createKeywordEmbeddings(): Embeddings {
  const toVector = (text: string): number[] => {
    const lower = text.toLowerCase();
    return [
      lower.includes("hiking") ? 1 : 0,
      lower.includes("pasta") ? 1 : 0,
      lower.includes("travel") ? 1 : 0,
      1,
    ];
  };

  return {
    caller: new AsyncCaller({}),
    embedQuery(text: string): Promise<number[]> {
      return Promise.resolve(toVector(text));
    },
    embedDocuments(texts: string[]): Promise<number[][]> {
      return Promise.resolve(texts.map((text) => toVector(text)));
    },
  };
}

describe("PersistentSimpleVectorStore", () => {
  test("persists documents and supports delete across restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rmm-persistent-store-"));
    const basePath = join(dir, "store");

    try {
      const embeddings = createKeywordEmbeddings();

      const storeA = await PersistentSimpleVectorStore.create({
        embeddings,
        basePath,
      });
      await storeA.addDocuments([
        new Document({
          pageContent: "User likes hiking in the mountains",
          metadata: { id: "mem-hiking", sessionId: "session-1" },
        }),
        new Document({
          pageContent: "User cooked pasta yesterday",
          metadata: { id: "mem-pasta", sessionId: "session-2" },
        }),
      ]);

      const storeB = await PersistentSimpleVectorStore.create({
        embeddings,
        basePath,
      });
      const hikingBeforeDelete = await storeB.similaritySearch("hiking", 1);
      expect(hikingBeforeDelete).toHaveLength(1);
      expect(hikingBeforeDelete[0]?.metadata?.id).toBe("mem-hiking");

      await storeB.delete({ ids: ["mem-hiking"] });

      const storeC = await PersistentSimpleVectorStore.create({
        embeddings,
        basePath,
      });
      const hikingAfterDelete = await storeC.similaritySearch("hiking", 2);
      expect(hikingAfterDelete.map((doc) => doc.metadata?.id)).not.toContain(
        "mem-hiking"
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("persists prebuild completion marker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rmm-prebuild-marker-"));
    const basePath = join(dir, "store");

    try {
      const embeddings = createKeywordEmbeddings();
      const storeA = await PersistentSimpleVectorStore.create({
        embeddings,
        basePath,
      });
      expect(storeA.getPrebuildMarker()).toBeNull();

      await storeA.markPrebuildComplete({
        schemaVersion: 1,
        method: "rmm",
        questionId: "q-1",
        questionType: "single-session-user",
        totalSessions: 3,
        sessionsProcessed: 3,
        extractedMemories: 5,
        storedMemories: 5,
        completedAt: "2026-02-22T00:00:00.000Z",
      });

      const storeB = await PersistentSimpleVectorStore.create({
        embeddings,
        basePath,
      });
      const marker = storeB.getPrebuildMarker();
      expect(marker).not.toBeNull();
      expect(marker?.questionId).toBe("q-1");
      expect(marker?.sessionsProcessed).toBe(3);
      expect(marker?.storedMemories).toBe(5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
