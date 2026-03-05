import { PathTraversalError } from "@/domain/errors";
import type { StorePort } from "@/domain/store-port";
import { normalizeStoreKey, sliceByWindow } from "@/infrastructure/path-utils";

const MAPPED_KEY_SEPARATOR = "#";

export const FILESYSTEM_UNRESPONSIVE_MESSAGE = "Filesystem unresponsive";

export interface BaseStoreLike {
  mget(keys: string[]): Promise<(string | undefined)[]>;
  mset(keyValuePairs: [string, string][]): Promise<void>;
  mdelete(keys: string[]): Promise<void>;
  yieldKeys(prefix?: string): AsyncGenerator<string, void, unknown>;
}

export interface VirtualStoreAdapterOptions {
  timeoutMs?: number;
}

export class FilesystemUnresponsiveError extends Error {
  constructor(message = FILESYSTEM_UNRESPONSIVE_MESSAGE) {
    super(message);
    this.name = "FilesystemUnresponsiveError";
  }
}

export class FileNotFoundError extends Error {
  constructor(message = "File not found") {
    super(message);
    this.name = "FileNotFoundError";
  }
}

export function buildBaseStoreKey(namespace: string[], key: string): string {
  return `${serializeNamespace(namespace)}${MAPPED_KEY_SEPARATOR}${normalizeStoreKey(key)}`;
}

export function buildBaseStorePrefix(
  namespace: string[],
  keyPrefix: string
): string {
  const normalizedKeyPrefix = normalizeStoreKey(keyPrefix, true);
  const namespacePrefix = `${serializeNamespace(namespace)}${MAPPED_KEY_SEPARATOR}`;

  if (normalizedKeyPrefix === "") {
    return namespacePrefix;
  }

  return `${namespacePrefix}${normalizedKeyPrefix}/`;
}

export function splitBaseStoreKey(
  namespace: string[],
  mappedKey: string
): string {
  const namespacePrefix = `${serializeNamespace(namespace)}${MAPPED_KEY_SEPARATOR}`;

  if (!mappedKey.startsWith(namespacePrefix)) {
    throw new PathTraversalError("Mapped key does not belong to namespace");
  }

  return mappedKey.slice(namespacePrefix.length);
}

export class VirtualStoreAdapter implements StorePort {
  private readonly timeoutMs?: number;
  private readonly store: BaseStoreLike;
  private readonly namespace: string[];

  constructor(
    store: BaseStoreLike,
    namespace: string[],
    options: VirtualStoreAdapterOptions = {}
  ) {
    this.store = store;
    this.namespace = namespace;
    this.timeoutMs = options.timeoutMs;
  }

  async read(path: string, offset = 0, limit?: number): Promise<string> {
    const mappedKey = buildBaseStoreKey(this.namespace, path);
    const values = await this.withTimeout(this.store.mget([mappedKey]));
    const value = values[0];

    if (value === undefined) {
      throw new FileNotFoundError();
    }

    return sliceByWindow(value, offset, limit);
  }

  async write(path: string, content: string): Promise<void> {
    const mappedKey = buildBaseStoreKey(this.namespace, path);
    await this.withTimeout(this.store.mset([[mappedKey, content]]));
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
    const normalizedPrefix = normalizeStoreKey(path, true);
    const mappedPrefix = buildBaseStorePrefix(this.namespace, normalizedPrefix);
    const collected = new Set<string>();
    const iterator = this.store.yieldKeys(mappedPrefix)[Symbol.asyncIterator]();

    while (true) {
      const nextItem = await this.withTimeout(iterator.next());

      if (nextItem.done) {
        break;
      }

      const mappedKey = nextItem.value;

      if (!mappedKey.startsWith(mappedPrefix)) {
        continue;
      }

      const normalizedKey = splitBaseStoreKey(this.namespace, mappedKey);
      const entry = toDirectChildEntry(normalizedPrefix, normalizedKey);

      if (entry !== undefined) {
        collected.add(entry);
      }
    }

    return [...collected].sort((left, right) => left.localeCompare(right));
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    if (this.timeoutMs === undefined) {
      return operation;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new FilesystemUnresponsiveError());
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}

function serializeNamespace(namespace: string[]): string {
  if (namespace.length === 0) {
    throw new PathTraversalError("Namespace must include at least one segment");
  }

  return namespace
    .map((segment) => {
      if (segment.length === 0) {
        throw new PathTraversalError("Namespace segments cannot be empty");
      }

      return `${segment.length}:${segment}`;
    })
    .join("|");
}

function toDirectChildEntry(
  normalizedPrefix: string,
  normalizedKey: string
): string | undefined {
  if (normalizedPrefix === "") {
    const [head] = normalizedKey.split("/");
    return head;
  }

  if (!normalizedKey.startsWith(`${normalizedPrefix}/`)) {
    return undefined;
  }

  const remainder = normalizedKey.slice(normalizedPrefix.length + 1);
  const [head] = remainder.split("/");

  if (head === undefined || head === "") {
    return undefined;
  }

  return `${normalizedPrefix}/${head}`;
}
