#!/usr/bin/env bun

import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const DATASET_BASE_URL =
  "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main";

const FILES = {
  s: "longmemeval_s_cleaned.json",
  m: "longmemeval_m_cleaned.json",
  oracle: "longmemeval_oracle.json",
} as const;

type Variant = keyof typeof FILES;

interface CliArgs {
  outDir: string;
  variants: Variant[];
  force: boolean;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  await mkdir(args.outDir, { recursive: true });

  for (const variant of args.variants) {
    const fileName = FILES[variant];
    const outPath = resolve(args.outDir, fileName);

    if (!args.force && (await fileExists(outPath))) {
      console.log(`[download-longmemeval] skipping existing: ${outPath}`);
      continue;
    }

    const url = `${DATASET_BASE_URL}/${fileName}`;
    console.log(`[download-longmemeval] downloading ${url}`);

    await mkdir(dirname(outPath), { recursive: true });
    await downloadToFile(url, outPath, fileName);
  }

  console.log("[download-longmemeval] done");
}

function parseArgs(argv: string[]): CliArgs {
  const kv = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token?.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    if (!rawKey) {
      continue;
    }

    if (inlineValue !== undefined) {
      kv.set(rawKey, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      kv.set(rawKey, next);
      i += 1;
    } else {
      kv.set(rawKey, "true");
    }
  }

  const outDir = resolve(kv.get("out-dir") ?? "./data/longmemeval");
  const which = (kv.get("which") ?? "all").trim().toLowerCase();
  const force = parseBoolean(kv.get("force"), false);

  let variants: Variant[];
  if (which === "all") {
    variants = ["s", "m", "oracle"];
  } else {
    const values = which
      .split(",")
      .map((value) => value.trim())
      .filter(
        (value): value is Variant =>
          value === "s" || value === "m" || value === "oracle"
      );

    if (values.length === 0) {
      throw new Error(
        `Invalid --which value "${which}". Expected one of: s,m,oracle,all`
      );
    }
    variants = values;
  }

  return {
    outDir,
    variants,
    force,
  };
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
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

async function downloadToFile(
  url: string,
  outPath: string,
  fileName: string
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${fileName}: ${response.status} ${response.statusText}`
    );
  }

  if (!response.body) {
    throw new Error(`No response body while downloading ${fileName}`);
  }

  const totalBytes = Number.parseInt(
    response.headers.get("content-length") ?? "0",
    10
  );
  let downloadedBytes = 0;
  let lastLogAt = Date.now();

  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      downloadedBytes += chunk.length;

      const now = Date.now();
      if (now - lastLogAt >= 10_000) {
        if (totalBytes > 0) {
          const pct = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          console.log(
            `[download-longmemeval] ${fileName}: ${pct}% (${downloadedBytes.toLocaleString()}/${totalBytes.toLocaleString()} bytes)`
          );
        } else {
          console.log(
            `[download-longmemeval] ${fileName}: ${downloadedBytes.toLocaleString()} bytes`
          );
        }
        lastLogAt = now;
      }

      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      response.body as unknown as NodeJS.ReadableStream,
      progress,
      createWriteStream(outPath)
    );
  } catch (error) {
    await rm(outPath, { force: true });
    throw new Error(
      `Streaming download failed for ${fileName}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const file = await stat(outPath);
  console.log(
    `[download-longmemeval] saved ${outPath} (${file.size.toLocaleString()} bytes)`
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[download-longmemeval] ${message}`);
  process.exitCode = 1;
});
