import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

const DEFAULT_BACKOFF_MINUTES = [5, 15, 30, 60];
const RATE_LIMIT_WRAPPED = Symbol.for("rmm.rate_limit_wrapped");
const RETRY_DELAY_PATTERNS: RegExp[] = [
  /retry(?:ing)?\s+in\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|secs|seconds?|m|mins?|minutes?)/i,
  /retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)(ms|s|m)?/i,
  /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)(s|m|ms)"/i,
];
const NON_RETRYABLE_SIZE_PATTERNS: string[] = [
  "input token count",
  "maximum number of tokens",
  "context length",
  "context window",
  "prompt is too long",
  "prompt too long",
  "request is too large",
  "request too large",
  "payload too large",
  "token limit exceeded",
  "input too long",
];
const MODEL_FACTORY_METHODS = new Set([
  "bindTools",
  "withConfig",
  "withRetry",
  "withFallbacks",
]);

export interface RateLimitRetryEvent {
  kind:
    | "rate_limited"
    | "backoff_scheduled"
    | "backoff_already_active"
    | "waiting_for_backoff"
    | "backoff_reset";
  scope?: string;
  attempt?: number;
  message?: string;
  delayMinutes?: number;
  waitMs?: number;
  nextRetryAt?: string;
  source?: "provider_hint" | "fallback_schedule";
}

export interface SharedRateLimitCoordinatorOptions {
  backoffMinutes?: number[];
  onEvent?: (event: RateLimitRetryEvent) => Promise<void> | void;
}

interface WaitForSlotOptions {
  scope?: string;
}

interface RegisterRateLimitOptions {
  scope?: string;
  attempt?: number;
  error: unknown;
}

export class SharedRateLimitCoordinator {
  private readonly backoffMinutes: number[];
  private readonly onEvent?: (
    event: RateLimitRetryEvent
  ) => Promise<void> | void;

  private nextAllowedAtMs = 0;
  private nextBackoffIndex = 0;
  private gateChain: Promise<void> = Promise.resolve();

  constructor(options?: SharedRateLimitCoordinatorOptions) {
    const configured = (options?.backoffMinutes ?? DEFAULT_BACKOFF_MINUTES)
      .map((value) => Math.floor(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    this.backoffMinutes =
      configured.length > 0 ? configured : DEFAULT_BACKOFF_MINUTES;
    this.onEvent = options?.onEvent;
  }

  async waitForSlot(options?: WaitForSlotOptions): Promise<void> {
    while (true) {
      const waitMs = await this.enqueueExclusive(() =>
        Math.max(0, this.nextAllowedAtMs - Date.now())
      );
      if (waitMs <= 0) {
        return;
      }

      await this.onEvent?.({
        kind: "waiting_for_backoff",
        scope: options?.scope,
        waitMs,
        nextRetryAt: new Date(Date.now() + waitMs).toISOString(),
      });
      await delay(waitMs);
    }
  }

  async registerRateLimit(options: RegisterRateLimitOptions): Promise<void> {
    const message = stringifyError(options.error);

    await this.onEvent?.({
      kind: "rate_limited",
      scope: options.scope,
      attempt: options.attempt,
      message,
    });

    await this.enqueueExclusive(async () => {
      const now = Date.now();

      if (now < this.nextAllowedAtMs) {
        await this.onEvent?.({
          kind: "backoff_already_active",
          scope: options.scope,
          attempt: options.attempt,
          waitMs: this.nextAllowedAtMs - now,
          nextRetryAt: new Date(this.nextAllowedAtMs).toISOString(),
        });
        return;
      }

      const delayMinutes =
        this.backoffMinutes[
          Math.min(this.nextBackoffIndex, this.backoffMinutes.length - 1)
        ] ??
        this.backoffMinutes.at(-1) ??
        60;
      const providerHintWaitMs = extractRetryDelayMs(options.error);
      const waitMs =
        providerHintWaitMs && providerHintWaitMs > 0
          ? providerHintWaitMs
          : delayMinutes * 60_000;

      this.nextAllowedAtMs = now + waitMs;
      if (!(providerHintWaitMs && providerHintWaitMs > 0)) {
        this.nextBackoffIndex += 1;
      }

      await this.onEvent?.({
        kind: "backoff_scheduled",
        scope: options.scope,
        attempt: options.attempt,
        delayMinutes: Number((waitMs / 60_000).toFixed(3)),
        waitMs,
        nextRetryAt: new Date(this.nextAllowedAtMs).toISOString(),
        source:
          providerHintWaitMs && providerHintWaitMs > 0
            ? "provider_hint"
            : "fallback_schedule",
      });
    });
  }

  async resetAfterSuccess(scope?: string): Promise<void> {
    await this.enqueueExclusive(async () => {
      if (this.nextAllowedAtMs === 0 && this.nextBackoffIndex === 0) {
        return;
      }
      this.nextAllowedAtMs = 0;
      this.nextBackoffIndex = 0;
      await this.onEvent?.({
        kind: "backoff_reset",
        scope,
      });
    });
  }

  private enqueueExclusive<T>(task: () => Promise<T> | T): Promise<T> {
    const next = this.gateChain.then(task, task);
    this.gateChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

export function wrapModelWithRateLimitRetry(
  model: BaseChatModel,
  options: {
    coordinator: SharedRateLimitCoordinator;
    scope?: string;
  }
): BaseChatModel {
  const wrappedFlag = (model as unknown as Record<string | symbol, unknown>)[
    RATE_LIMIT_WRAPPED
  ];
  if (wrappedFlag === true) {
    return model;
  }

  const originalInvoke = (
    model as unknown as { invoke: (...args: unknown[]) => Promise<unknown> }
  ).invoke?.bind(model);

  if (typeof originalInvoke !== "function") {
    return model;
  }

  const invoke = async (...args: unknown[]): Promise<unknown> => {
    let attempt = 0;

    while (true) {
      attempt += 1;
      await options.coordinator.waitForSlot({
        scope: options.scope,
      });

      try {
        const result = await originalInvoke(...args);
        await options.coordinator.resetAfterSuccess(options.scope);
        return result;
      } catch (error) {
        const rateLimited = isRateLimitError(error);
        if (!rateLimited || isNonRetryableRateLimitLikeError(error)) {
          throw error;
        }
        await options.coordinator.registerRateLimit({
          scope: options.scope,
          attempt,
          error,
        });
      }
    }
  };

  return new Proxy(model as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (prop === "invoke") {
        return invoke;
      }
      if (prop === RATE_LIMIT_WRAPPED) {
        return true;
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        const bound = value.bind(target);
        if (
          typeof prop === "string" &&
          MODEL_FACTORY_METHODS.has(prop.toString())
        ) {
          return (...args: unknown[]) => {
            const produced = bound(...args);
            if (!isChatModelCandidate(produced)) {
              return produced;
            }
            return wrapModelWithRateLimitRetry(produced, options);
          };
        }
        return bound;
      }
      return value;
    },
  }) as unknown as BaseChatModel;
}

export function isRateLimitError(error: unknown): boolean {
  const message = stringifyError(error).toLowerCase();

  if (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("quota") ||
    message.includes("resource exhausted") ||
    message.includes("usage limit")
  ) {
    return true;
  }

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    response?: { status?: unknown; statusCode?: unknown };
  };

  const statuses = [
    candidate?.status,
    candidate?.statusCode,
    candidate?.response?.status,
    candidate?.response?.statusCode,
  ];

  if (statuses.some((value) => Number(value) === 429)) {
    return true;
  }

  const code = String(candidate?.code ?? "").toLowerCase();
  return code.includes("rate") || code.includes("quota") || code === "429";
}

export function isNonRetryableRateLimitLikeError(error: unknown): boolean {
  const message = stringifyError(error).toLowerCase();
  const hasPayloadSignal = NON_RETRYABLE_SIZE_PATTERNS.some((pattern) =>
    message.includes(pattern)
  );
  if (hasPayloadSignal) {
    return true;
  }

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown; statusCode?: unknown };
  };
  const statuses = [
    candidate?.status,
    candidate?.statusCode,
    candidate?.response?.status,
    candidate?.response?.statusCode,
  ];
  const statusCodes = statuses
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  // 413 Payload Too Large should always fail fast.
  if (statusCodes.some((status) => status === 413)) {
    return true;
  }

  // Some providers emit 400 INVALID_ARGUMENT for context/payload overflow.
  if (
    statusCodes.some((status) => status === 400) &&
    (message.includes("invalid argument") ||
      message.includes("invalid request") ||
      message.includes("bad request")) &&
    (message.includes("token") ||
      message.includes("context") ||
      message.includes("prompt") ||
      message.includes("payload") ||
      message.includes("length"))
  ) {
    return true;
  }

  return false;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function summarizeErrorForLog(error: unknown, maxLength = 220): string {
  const message = stringifyError(error).replaceAll(/\s+/g, " ").trim();
  if (message.length <= maxLength) {
    return message;
  }
  return `${message.slice(0, maxLength - 1)}…`;
}

export function extractRetryDelayMs(error: unknown): number | null {
  const candidate = error as {
    response?: { headers?: unknown };
    headers?: unknown;
    cause?: unknown;
  };

  const headerValue =
    readHeaderValue(candidate?.response?.headers, "retry-after") ??
    readHeaderValue(candidate?.headers, "retry-after");
  const fromHeader = parseRetryAfterHeaderMs(headerValue);
  if (fromHeader && fromHeader > 0) {
    return fromHeader;
  }

  const message = stringifyError(error);
  const fromMessage = parseRetryDelayFromText(message);
  if (fromMessage && fromMessage > 0) {
    return fromMessage;
  }

  let causeMessage = "";
  if (candidate?.cause instanceof Error) {
    causeMessage = candidate.cause.message;
  } else if (candidate?.cause) {
    causeMessage = String(candidate.cause);
  }
  const fromCause = parseRetryDelayFromText(causeMessage);
  if (fromCause && fromCause > 0) {
    return fromCause;
  }

  return null;
}

function readHeaderValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") {
    return null;
  }

  if (typeof (headers as { get?: unknown }).get === "function") {
    const value = (headers as { get: (key: string) => unknown }).get(name);
    return typeof value === "string" ? value : null;
  }

  const record = headers as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() !== name.toLowerCase()) {
      continue;
    }
    return typeof value === "string" ? value : null;
  }

  return null;
}

function parseRetryAfterHeaderMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const absoluteMs = Date.parse(trimmed);
  if (Number.isFinite(absoluteMs)) {
    return Math.max(0, absoluteMs - Date.now());
  }

  return null;
}

function parseRetryDelayFromText(message: string): number | null {
  if (!message) {
    return null;
  }

  for (const pattern of RETRY_DELAY_PATTERNS) {
    const match = message.match(pattern);
    if (!match) {
      continue;
    }
    const rawValue = Number(match[1]);
    if (!Number.isFinite(rawValue) || rawValue < 0) {
      continue;
    }
    const unit = (match[2] ?? "s").toLowerCase();
    return convertToMs(rawValue, unit);
  }

  return null;
}

function convertToMs(value: number, unit: string): number {
  if (unit.startsWith("ms")) {
    return Math.ceil(value);
  }
  if (unit.startsWith("m")) {
    return Math.ceil(value * 60_000);
  }
  return Math.ceil(value * 1000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isChatModelCandidate(value: unknown): value is BaseChatModel {
  if (!value || typeof value !== "object") {
    return false;
  }
  return typeof (value as { invoke?: unknown }).invoke === "function";
}
