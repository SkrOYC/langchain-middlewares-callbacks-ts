import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";

import { PathTraversalError } from "@/domain/errors";
import type { StorePort } from "@/domain/store-port";
import { normalizeStoreKey } from "@/infrastructure/path-utils";

const DEFAULT_LARGE_FILE_THRESHOLD_BYTES = 256 * 1024;
const DIRECTORY_SEPARATOR_REGEX = /[\\/]/;

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

    const fileHandle = await open(hostPath, "r");

    try {
      const metadata = await fileHandle.stat();

      if (offset > 0 || limit !== undefined) {
        return await readWindow(fileHandle, metadata.size, offset, limit);
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

    const fileHandle = await open(hostPath, "w", 0o644);

    try {
      await fileHandle.writeFile(content, "utf8");
    } finally {
      await fileHandle.close();
    }
  }

  async edit(path: string, oldStr: string, newStr: string): Promise<number> {
    const hostPath = this.resolveHostPath(path);
    await this.assertNoSymlinkInPath(hostPath);

    const fileHandle = await open(hostPath, "r");

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
  fileSizeBytes: number,
  offset: number,
  limit?: number
): Promise<string> {
  const boundedOffset = Math.max(0, offset);
  const availableBytes = Math.max(0, fileSizeBytes - boundedOffset);

  const requestedBytes =
    limit === undefined
      ? availableBytes
      : Math.min(Math.max(0, limit), availableBytes);

  if (requestedBytes === 0) {
    return "";
  }

  const buffer = Buffer.alloc(requestedBytes);
  const { bytesRead } = await fileHandle.read(
    buffer,
    0,
    requestedBytes,
    boundedOffset
  );

  return buffer.subarray(0, bytesRead).toString("utf8");
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
