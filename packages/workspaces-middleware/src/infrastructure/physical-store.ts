import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";
import { normalize as normalizePosix } from "node:path/posix";

import { PathTraversalError } from "@/domain/errors";
import type { StorePort } from "@/domain/store-port";

const DEFAULT_LARGE_FILE_THRESHOLD_BYTES = 256 * 1024;
const BACKSLASH_REGEX = /\\/g;
const LEADING_SLASHES_REGEX = /^\/+/;

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
    await this.assertNotSymlink(hostPath);

    this.assertWithinWorkspace(hostPath);

    const fileHandle = await open(hostPath, "r");

    try {
      const metadata = await fileHandle.stat();

      if (offset > 0 || limit !== undefined) {
        const content = await fileHandle.readFile("utf8");
        return sliceByWindow(content, offset, limit);
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

    await mkdir(dirname(hostPath), { recursive: true });
    await this.assertNotSymlink(hostPath, true);

    const fileHandle = await open(hostPath, "w", 0o644);

    try {
      await fileHandle.writeFile(content, "utf8");
    } finally {
      await fileHandle.close();
    }
  }

  async edit(path: string, oldStr: string, newStr: string): Promise<number> {
    const current = await this.read(path);
    const index = current.indexOf(oldStr);

    if (index < 0) {
      return 0;
    }

    const next = `${current.slice(0, index)}${newStr}${current.slice(index + oldStr.length)}`;
    await this.write(path, next);

    return 1;
  }

  async list(path: string): Promise<string[]> {
    const normalizedDirectory = normalizeRelativeKey(path, true);
    const hostPath = this.resolveHostPath(normalizedDirectory);

    await this.assertNotSymlink(hostPath);

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
    const normalizedKey = normalizeRelativeKey(path);
    const hostPath = resolve(this.rootDir, normalizedKey);

    this.assertWithinWorkspace(hostPath);

    return hostPath;
  }

  private async assertNotSymlink(
    hostPath: string,
    allowMissing = false
  ): Promise<void> {
    try {
      const metadata = await lstat(hostPath);
      if (metadata.isSymbolicLink()) {
        throw new PathTraversalError("Symlink targets are not allowed");
      }
    } catch (error) {
      if (
        allowMissing &&
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }

      throw error;
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

function normalizeRelativeKey(path: string, allowEmpty = false): string {
  if (path.includes("\0") || path.includes("~")) {
    throw new PathTraversalError();
  }

  const normalized = normalizePosix(path.replace(BACKSLASH_REGEX, "/")).replace(
    LEADING_SLASHES_REGEX,
    ""
  );

  if (normalized === "." || normalized === "") {
    if (allowEmpty) {
      return "";
    }

    throw new PathTraversalError("Empty paths are not allowed");
  }

  if (normalized.startsWith("../") || normalized === "..") {
    throw new PathTraversalError();
  }

  return normalized;
}

function sliceByWindow(content: string, offset = 0, limit?: number): string {
  const boundedOffset = Math.max(0, offset);

  if (limit === undefined) {
    return content.slice(boundedOffset);
  }

  const boundedLimit = Math.max(0, limit);
  return content.slice(boundedOffset, boundedOffset + boundedLimit);
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

function formatTruncationWarning(fileSizeBytes: number): string {
  return `[...truncated. File size: ${fileSizeBytes} bytes. Use offset/limit to read remaining content.]`;
}
