import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

const DEFAULT_BACKOFF_MINUTES = [5, 15, 30, 60];
const RATE_LIMIT_WRAPPED = Symbol.for("rmm.rate_limit_wrapped");
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
        ] ?? this.backoffMinutes[this.backoffMinutes.length - 1] ?? 60;

      this.nextAllowedAtMs = now + delayMinutes * 60_000;
      this.nextBackoffIndex += 1;

      await this.onEvent?.({
        kind: "backoff_scheduled",
        scope: options.scope,
        attempt: options.attempt,
        delayMinutes,
        waitMs: this.nextAllowedAtMs - now,
        nextRetryAt: new Date(this.nextAllowedAtMs).toISOString(),
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
  const wrappedFlag = (
    model as unknown as Record<string | symbol, unknown>
  )[RATE_LIMIT_WRAPPED];
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
        if (!isRateLimitError(error)) {
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

function isRateLimitError(error: unknown): boolean {
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

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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
