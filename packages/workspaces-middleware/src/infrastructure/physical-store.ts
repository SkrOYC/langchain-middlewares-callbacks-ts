import {
  O_CREAT,
  O_NOFOLLOW,
  O_RDONLY,
  O_TRUNC,
  O_WRONLY,
} from "node:constants";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";

import { PathTraversalError } from "@/domain/errors";
import type { StorePort } from "@/domain/store-port";
import { normalizeStoreKey } from "@/infrastructure/path-utils";

const DEFAULT_LARGE_FILE_THRESHOLD_BYTES = 256 * 1024;
const DIRECTORY_SEPARATOR_REGEX = /[\\/]/;
const READ_NOFOLLOW_FLAGS = O_RDONLY + O_NOFOLLOW;
const WRITE_NOFOLLOW_FLAGS = O_WRONLY + O_CREAT + O_TRUNC + O_NOFOLLOW;

export interface PhysicalStoreAdapterOptions {
  largeFileThresholdBytes?: number;
}

export class PhysicalStoreAdapter implements StorePort {
  private readonly largeFileThresholdBytes: number;
  private readonly rootDir: string;

  constructor(rootDir: string, options: PhysicalStoreAdapterOptions = {}) {
    this.rootDir = rootDir;
    this.largeFileThresholdBytes =
      options.largeFileThresholdBytes ?? DEFAULT_LARGE_FILE_THRESHOLD_BYTES;
  }

  async read(path: string, offset = 0, limit?: number): Promise<string> {
    const hostPath = this.resolveHostPath(path);
    await this.assertNoSymlinkInPath(hostPath);

    const fileHandle = await openReadNoFollow(hostPath);

    try {
      const metadata = await fileHandle.stat();

      if (offset > 0 || limit !== undefined) {
        const windowResult = await readWindow(
          fileHandle,
          metadata.size,
          offset,
          limit,
          this.largeFileThresholdBytes
        );

        if (windowResult.truncated) {
          return `${windowResult.content}${formatTruncationWarning(metadata.size)}`;
        }

        return windowResult.content;
      }

      if (metadata.size > this.largeFileThresholdBytes) {
        const truncated = await readPrefixWithChunkedReads(
          fileHandle,
          this.largeFileThresholdBytes
        );

        return `${truncated}${formatTruncationWarning(metadata.size)}`;
      }

      return await fileHandle.readFile("utf8");
    } finally {
      await fileHandle.close();
    }
  }

  async write(path: string, content: string): Promise<void> {
    const hostPath = this.resolveHostPath(path);

    await this.assertNoSymlinkInExistingPath(hostPath);
    await mkdir(dirname(hostPath), { recursive: true });
    await this.assertNoSymlinkInPath(dirname(hostPath));

    const fileHandle = await openWriteNoFollow(hostPath);

    try {
      await fileHandle.writeFile(content, "utf8");
    } finally {
      await fileHandle.close();
    }
  }

  async edit(path: string, oldStr: string, newStr: string): Promise<number> {
    const hostPath = this.resolveHostPath(path);
    await this.assertNoSymlinkInPath(hostPath);

    const fileHandle = await openReadNoFollow(hostPath);

    try {
      const metadata = await fileHandle.stat();

      if (metadata.size > this.largeFileThresholdBytes) {
        throw new Error("File too large for edit operation");
      }

      const current = await fileHandle.readFile("utf8");
      const index = current.indexOf(oldStr);

      if (index < 0) {
        return 0;
      }

      const next = `${current.slice(0, index)}${newStr}${current.slice(index + oldStr.length)}`;
      await this.write(path, next);

      return 1;
    } finally {
      await fileHandle.close();
    }
  }

  async list(path: string): Promise<string[]> {
    const normalizedDirectory = normalizeStoreKey(path, true);
    const hostPath =
      normalizedDirectory === ""
        ? normalize(resolve(this.rootDir))
        : this.resolveHostPath(normalizedDirectory);

    await this.assertNoSymlinkInPath(hostPath);

    const directoryEntries = await readdir(hostPath);

    return directoryEntries
      .map((entry) => {
        if (normalizedDirectory === "") {
          return entry;
        }

        return `${normalizedDirectory}/${entry}`;
      })
      .sort((left, right) => left.localeCompare(right));
  }

  private resolveHostPath(path: string): string {
    const normalizedKey = normalizeStoreKey(path);
    const hostPath = resolve(this.rootDir, normalizedKey);

    this.assertWithinWorkspace(hostPath);

    return hostPath;
  }

  private async assertNoSymlinkInPath(hostPath: string): Promise<void> {
    const normalizedRoot = normalize(resolve(this.rootDir));
    const normalizedTarget = normalize(resolve(hostPath));

    this.assertWithinWorkspace(normalizedTarget);

    const relativePath = relative(normalizedRoot, normalizedTarget);
    if (relativePath === "") {
      return;
    }

    const segments = relativePath
      .split(DIRECTORY_SEPARATOR_REGEX)
      .filter(Boolean);
    let currentPath = normalizedRoot;

    for (const segment of segments) {
      currentPath = resolve(currentPath, segment);
      const metadata = await lstat(currentPath);

      if (metadata.isSymbolicLink()) {
        throw new PathTraversalError("Symlink targets are not allowed");
      }
    }
  }

  private async assertNoSymlinkInExistingPath(hostPath: string): Promise<void> {
    const normalizedRoot = normalize(resolve(this.rootDir));
    const normalizedTarget = normalize(resolve(hostPath));

    this.assertWithinWorkspace(normalizedTarget);

    const relativePath = relative(normalizedRoot, normalizedTarget);
    if (relativePath === "") {
      return;
    }

    const segments = relativePath
      .split(DIRECTORY_SEPARATOR_REGEX)
      .filter(Boolean);
    let currentPath = normalizedRoot;

    for (const segment of segments) {
      currentPath = resolve(currentPath, segment);

      try {
        const metadata = await lstat(currentPath);

        if (metadata.isSymbolicLink()) {
          throw new PathTraversalError("Symlink targets are not allowed");
        }
      } catch (error) {
        if (isEnoentError(error)) {
          return;
        }

        throw error;
      }
    }
  }

  private assertWithinWorkspace(hostPath: string): void {
    const normalizedRoot = normalize(resolve(this.rootDir));
    const normalizedTarget = normalize(resolve(hostPath));

    const relativePath = relative(normalizedRoot, normalizedTarget);

    if (
      relativePath.startsWith("..") ||
      isAbsolute(relativePath) ||
      (!normalizedTarget.startsWith(normalizedRoot) &&
        normalizedTarget !== normalizedRoot)
    ) {
      throw new PathTraversalError("Path escapes workspace boundary");
    }
  }
}

async function readPrefixWithChunkedReads(
  fileHandle: Awaited<ReturnType<typeof open>>,
  byteLimit: number
): Promise<string> {
  const chunkSize = Math.min(64 * 1024, Math.max(1, byteLimit));
  const chunks: Buffer[] = [];
  let remaining = byteLimit;
  let position = 0;

  while (remaining > 0) {
    const buffer = Buffer.alloc(Math.min(chunkSize, remaining));
    const { bytesRead } = await fileHandle.read(
      buffer,
      0,
      buffer.length,
      position
    );

    if (bytesRead === 0) {
      break;
    }

    chunks.push(buffer.subarray(0, bytesRead));
    remaining -= bytesRead;
    position += bytesRead;
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readWindow(
  fileHandle: Awaited<ReturnType<typeof open>>,
  _fileSizeBytes: number,
  offset: number,
  limit: number | undefined,
  largeFileThresholdBytes: number
): Promise<{ content: string; truncated: boolean }> {
  const boundedOffset = Math.max(0, offset);
  const boundedLimit = limit === undefined ? undefined : Math.max(0, limit);
  const effectiveLimit = boundedLimit ?? largeFileThresholdBytes;

  if (effectiveLimit === 0) {
    return { content: "", truncated: false };
  }

  const decoder = new TextDecoder("utf-8");
  const chunkSize = Math.min(
    64 * 1024,
    Math.max(1024, largeFileThresholdBytes)
  );

  let position = 0;
  let skippedChars = 0;
  let collected = "";
  let reachedCap = false;
  let reachedEof = false;

  while (true) {
    const buffer = Buffer.alloc(chunkSize);
    const { bytesRead } = await fileHandle.read(
      buffer,
      0,
      buffer.length,
      position
    );

    if (bytesRead === 0) {
      reachedEof = true;
      break;
    }

    position += bytesRead;

    const decodedChunk = decoder.decode(buffer.subarray(0, bytesRead), {
      stream: true,
    });

    const consumed = consumeDecodedChunk(
      decodedChunk,
      boundedOffset,
      effectiveLimit,
      skippedChars,
      collected
    );

    skippedChars = consumed.skippedChars;
    collected = consumed.collected;

    if (consumed.reachedCap) {
      reachedCap = true;
      break;
    }
  }

  if (!reachedCap) {
    const tail = decoder.decode();
    if (tail.length > 0) {
      const consumed = consumeDecodedChunk(
        tail,
        boundedOffset,
        effectiveLimit,
        skippedChars,
        collected
      );

      collected = consumed.collected;
      reachedCap = consumed.reachedCap;
    }
  }

  return {
    content: collected,
    truncated: boundedLimit === undefined && reachedCap && !reachedEof,
  };
}

function consumeDecodedChunk(
  decodedChunk: string,
  startOffsetChars: number,
  limitChars: number,
  skippedChars: number,
  collected: string
): { skippedChars: number; collected: string; reachedCap: boolean } {
  let nextSkippedChars = skippedChars;
  let cursor = 0;

  if (nextSkippedChars < startOffsetChars) {
    const toSkip = Math.min(
      startOffsetChars - nextSkippedChars,
      decodedChunk.length
    );
    nextSkippedChars += toSkip;
    cursor += toSkip;
  }

  if (cursor >= decodedChunk.length) {
    return {
      skippedChars: nextSkippedChars,
      collected,
      reachedCap: collected.length >= limitChars,
    };
  }

  const remaining = limitChars - collected.length;
  if (remaining <= 0) {
    return { skippedChars: nextSkippedChars, collected, reachedCap: true };
  }

  const toTake = Math.min(remaining, decodedChunk.length - cursor);
  const nextCollected = `${collected}${decodedChunk.slice(cursor, cursor + toTake)}`;

  return {
    skippedChars: nextSkippedChars,
    collected: nextCollected,
    reachedCap: nextCollected.length >= limitChars,
  };
}

async function openReadNoFollow(
  hostPath: string
): Promise<Awaited<ReturnType<typeof open>>> {
  try {
    return await open(hostPath, READ_NOFOLLOW_FLAGS);
  } catch (error) {
    throw coerceToPathTraversalError(error);
  }
}

async function openWriteNoFollow(
  hostPath: string
): Promise<Awaited<ReturnType<typeof open>>> {
  try {
    return await open(hostPath, WRITE_NOFOLLOW_FLAGS, 0o644);
  } catch (error) {
    throw coerceToPathTraversalError(error);
  }
}

function coerceToPathTraversalError(error: unknown): unknown {
  if (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ELOOP"
  ) {
    return new PathTraversalError("Symlink targets are not allowed");
  }

  return error;
}

function formatTruncationWarning(fileSizeBytes: number): string {
  return `[...truncated. File size: ${fileSizeBytes} bytes. Use offset/limit to read remaining content.]`;
}

function isEnoentError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
