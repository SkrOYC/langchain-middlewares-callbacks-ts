import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

interface CacheRecord {
  k: string;
  r: CachedInvokeResponse;
}

interface CachedInvokeResponse {
  text: string;
  content: unknown;
}

export interface CachedChatModelStats {
  hits: number;
  misses: number;
  writes: number;
}

export interface CachedChatModelOptions {
  cachePath: string;
}

export interface CachedChatModelEvent {
  kind: "hit" | "miss" | "write" | "skip_write" | "retry_empty";
  key: string;
  namespace: string;
  prompt: string;
  responseText?: string;
  reason?: string;
}

export class CachedChatModelStore {
  private readonly cachePath: string;
  private readonly handle: FileHandle;
  private readonly entries = new Map<string, CachedInvokeResponse>();
  private readonly stats: CachedChatModelStats = {
    hits: 0,
    misses: 0,
    writes: 0,
  };
  private writeChain: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(cachePath: string, handle: FileHandle) {
    this.cachePath = cachePath;
    this.handle = handle;
  }

  static async create(
    options: CachedChatModelOptions
  ): Promise<CachedChatModelStore> {
    const cachePath = resolve(options.cachePath);
    await mkdir(dirname(cachePath), { recursive: true });
    const handle = await open(cachePath, "a+");
    const cache = new CachedChatModelStore(cachePath, handle);
    await cache.load();
    return cache;
  }

  getPath(): string {
    return this.cachePath;
  }

  getStats(): CachedChatModelStats {
    return { ...this.stats };
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.writeChain;
    await this.handle.close();
    this.closed = true;
  }

  get(key: string): CachedInvokeResponse | null {
    const found = this.entries.get(key);
    if (!found) {
      return null;
    }
    this.stats.hits += 1;
    return {
      text: found.text,
      content: cloneJsonValue(found.content),
    };
  }

  async set(key: string, response: CachedInvokeResponse): Promise<void> {
    if (this.entries.has(key)) {
      return;
    }

    this.entries.set(key, {
      text: response.text,
      content: cloneJsonValue(response.content),
    });

    await this.enqueueWrite(async () => {
      await this.handle.write(
        `${JSON.stringify({
          k: key,
          r: response,
        } satisfies CacheRecord)}\n`
      );
      this.stats.writes += 1;
      await this.handle.sync();
    });
  }

  markMiss(): void {
    this.stats.misses += 1;
  }

  private async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.cachePath, "utf8");
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
          typeof parsed.k !== "string" ||
          !parsed.r ||
          typeof parsed.r !== "object" ||
          typeof (parsed.r as { text?: unknown }).text !== "string"
        ) {
          continue;
        }
        const response = parsed.r as CachedInvokeResponse;
        this.entries.set(parsed.k, response);
      } catch {
        // Keep cache resilient by ignoring malformed lines.
      }
    }
  }

  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(task, task);
    this.writeChain = next.catch(() => undefined);
    return next;
  }
}

export function wrapModelWithInvokeCache(
  model: BaseChatModel,
  options: {
    cache: CachedChatModelStore;
    namespace: string;
    emptyResponseRetryCount?: number;
    onEvent?: (event: CachedChatModelEvent) => Promise<void> | void;
  }
): BaseChatModel {
  const originalInvoke = (
    model as unknown as { invoke: (...args: unknown[]) => Promise<unknown> }
  ).invoke?.bind(model);

  if (typeof originalInvoke !== "function") {
    return model;
  }

  const invoke = async (...args: unknown[]): Promise<unknown> => {
    const prompt = normalizePromptForCache(args[0]);
    const key = createHash("sha256")
      .update(options.namespace)
      .update("\n")
      .update(prompt)
      .digest("hex");

    const cached = options.cache.get(key);
    if (cached) {
      await options.onEvent?.({
        kind: "hit",
        key,
        namespace: options.namespace,
        prompt,
        responseText: cached.text,
      });
      return {
        text: cached.text,
        content: cached.content,
      };
    }

    options.cache.markMiss();
    await options.onEvent?.({
      kind: "miss",
      key,
      namespace: options.namespace,
      prompt,
    });

    const maxEmptyResponseRetries = Math.max(
      0,
      options.emptyResponseRetryCount ?? 1
    );
    let raw: unknown = null;
    let normalized: CachedInvokeResponse = {
      text: "",
      content: "",
    };

    for (let attempt = 0; attempt <= maxEmptyResponseRetries; attempt += 1) {
      raw = await originalInvoke(...args);
      normalized = normalizeResponseForCache(raw);
      if (normalized.text.trim().length > 0) {
        break;
      }
      if (attempt < maxEmptyResponseRetries) {
        await options.onEvent?.({
          kind: "retry_empty",
          key,
          namespace: options.namespace,
          prompt,
          reason: `empty_response_text_attempt_${attempt + 1}`,
        });
      }
    }

    if (normalized.text.trim().length === 0) {
      await options.onEvent?.({
        kind: "skip_write",
        key,
        namespace: options.namespace,
        prompt,
        reason: "empty_response_text",
      });
      return raw;
    }

    await options.cache.set(key, normalized);
    await options.onEvent?.({
      kind: "write",
      key,
      namespace: options.namespace,
      prompt,
      responseText: normalized.text,
    });

    return {
      text: normalized.text,
      content: normalized.content,
    };
  };

  return new Proxy(model as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (prop === "invoke") {
        return invoke;
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  }) as unknown as BaseChatModel;
}

function normalizePromptForCache(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  return stableStringify(normalizeJsonValue(input));
}

function normalizeResponseForCache(response: unknown): CachedInvokeResponse {
  if (typeof response === "string") {
    return {
      text: response,
      content: response,
    };
  }

  if (!response || typeof response !== "object") {
    return {
      text: "",
      content: "",
    };
  }

  const responseAny = response as {
    text?: unknown;
    content?: unknown;
  };

  const normalizedContent = normalizeJsonValue(responseAny.content);
  const textFromField =
    typeof responseAny.text === "string" ? responseAny.text : "";
  let textFromContent = "";
  if (typeof normalizedContent === "string") {
    textFromContent = normalizedContent;
  } else if (Array.isArray(normalizedContent)) {
    textFromContent = normalizedContent
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  const effectiveText =
    textFromField.trim().length > 0 ? textFromField : textFromContent;

  return {
    text: effectiveText,
    content: effectiveText,
  };
}

function normalizeJsonValue(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    ).sort(([a], [b]) => a.localeCompare(b))) {
      output[key] = normalizeJsonValue(child);
    }
    return output;
  }

  return String(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
