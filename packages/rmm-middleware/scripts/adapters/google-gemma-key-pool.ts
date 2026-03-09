import type { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getLogger } from "../../src/utils/logger";
import {
  extractRetryDelayMs,
  isNonRetryableRateLimitLikeError,
  isRateLimitError,
  summarizeErrorForLog,
} from "../utils/rate-limit-retry-model";

const MODEL_FACTORY_METHODS = new Set([
  "bindTools",
  "withConfig",
  "withRetry",
  "withFallbacks",
]);
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
const KEY_SPLIT_REGEX = /[\n,]/;
const logger = getLogger("gemma-key-pool");

interface KeyState {
  apiKey: string;
  cooldownUntilMs: number;
  cooldownStartedAtMs: number;
  consecutiveRateLimits: number;
  inFlight: number;
  lastError?: string;
  lastUsedAtMs: number;
  model: ChatGoogleGenerativeAI;
  slot: number;
}

interface PoolState {
  nextSlotSeed: number;
  states: KeyState[];
}

const sharedPools = new Map<string, PoolState>();

function shouldLogKeyRotation(apiKeys: string[]): boolean {
  const raw = process.env.EVAL_LOG_KEY_ROTATION?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") {
    return false;
  }
  if (raw === "1" || raw === "true" || raw === "yes") {
    return true;
  }
  return apiKeys.length > 1;
}

function fingerprintKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return apiKey;
  }
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

function parseApiKeys(): string[] {
  const fromPool = process.env.GOOGLE_API_KEYS;
  if (fromPool) {
    const keys = fromPool
      .split(KEY_SPLIT_REGEX)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (keys.length > 0) {
      return keys;
    }
  }

  const single = process.env.GOOGLE_API_KEY;
  if (single?.trim()) {
    return [single.trim()];
  }

  throw new Error(
    "Missing required environment variable: GOOGLE_API_KEY or GOOGLE_API_KEYS"
  );
}

function getPoolId(apiKeys: string[], poolTag?: string): string {
  return [poolTag ?? "", ...apiKeys].join("\n");
}

function getOrCreatePoolState(
  apiKeys: string[],
  factory: (apiKey: string) => ChatGoogleGenerativeAI,
  poolTag?: string
): PoolState {
  const poolId = getPoolId(apiKeys, poolTag);
  const existing = sharedPools.get(poolId);
  if (existing) {
    return existing;
  }

  const states = apiKeys.map((apiKey, slot) => ({
    apiKey,
    cooldownUntilMs: 0,
    cooldownStartedAtMs: 0,
    consecutiveRateLimits: 0,
    inFlight: 0,
    lastUsedAtMs: 0,
    model: factory(apiKey),
    slot,
  }));
  const created = {
    nextSlotSeed: 0,
    states,
  };
  sharedPools.set(poolId, created);
  return created;
}

function selectBestState(pool: PoolState, now: number): KeyState | null {
  const available = pool.states.filter((state) => state.cooldownUntilMs <= now);
  if (available.length === 0) {
    return null;
  }

  const prioritized = [...available].sort((left, right) => {
    if (left.inFlight !== right.inFlight) {
      return left.inFlight - right.inFlight;
    }
    if (left.lastUsedAtMs !== right.lastUsedAtMs) {
      return left.lastUsedAtMs - right.lastUsedAtMs;
    }

    const leftOrder =
      (left.slot - pool.nextSlotSeed + pool.states.length) % pool.states.length;
    const rightOrder =
      (right.slot - pool.nextSlotSeed + pool.states.length) %
      pool.states.length;
    return leftOrder - rightOrder;
  });

  return prioritized[0] ?? null;
}

function reactivateReadyStates(pool: PoolState, now: number): void {
  for (const state of pool.states) {
    if (state.cooldownUntilMs === 0 || state.cooldownUntilMs > now) {
      continue;
    }

    logger.info(
      `[gemma-key-pool] key_reactivated slot=${state.slot + 1}/${pool.states.length} key=${fingerprintKey(
        state.apiKey
      )} cooldownMs=${Math.max(0, now - state.cooldownStartedAtMs)}`
    );
    state.cooldownUntilMs = 0;
    state.cooldownStartedAtMs = 0;
  }
}

function getNextAvailableWaitMs(pool: PoolState, now: number): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const state of pool.states) {
    if (state.cooldownUntilMs <= now) {
      return 0;
    }
    earliest = Math.min(earliest, state.cooldownUntilMs);
  }
  if (!Number.isFinite(earliest)) {
    return DEFAULT_RATE_LIMIT_WAIT_MS;
  }
  return Math.max(1, earliest - now);
}

async function acquireState(
  pool: PoolState,
  logSelection: boolean,
  totalSlots: number
): Promise<KeyState> {
  while (true) {
    const now = Date.now();
    reactivateReadyStates(pool, now);
    const selected = selectBestState(pool, now);
    if (selected) {
      selected.inFlight += 1;
      selected.lastUsedAtMs = now;
      pool.nextSlotSeed = (selected.slot + 1) % pool.states.length;
      if (logSelection) {
        logger.info(
          `[gemma-key-pool] slot=${selected.slot + 1}/${totalSlots} key=${fingerprintKey(
            selected.apiKey
          )} inflight=${selected.inFlight} cooldownMs=${Math.max(
            0,
            selected.cooldownUntilMs - now
          )}`
        );
      }
      return selected;
    }

    const waitMs = getNextAvailableWaitMs(pool, now);
    logger.info(
      `[gemma-key-pool] all keys cooling down waitMs=${waitMs} poolSize=${totalSlots}`
    );
    await delay(waitMs);
  }
}

function releaseSuccess(state: KeyState): void {
  state.inFlight = Math.max(0, state.inFlight - 1);
  state.consecutiveRateLimits = 0;
  state.cooldownUntilMs = 0;
  state.cooldownStartedAtMs = 0;
  state.lastError = undefined;
}

function releaseNonRateLimit(state: KeyState, error: unknown): void {
  state.inFlight = Math.max(0, state.inFlight - 1);
  state.lastError = stringifyError(error);
}

function releaseRateLimited(state: KeyState, error: unknown): number {
  const now = Date.now();
  const waitMs = Math.max(
    1,
    extractRetryDelayMs(error) ?? DEFAULT_RATE_LIMIT_WAIT_MS
  );
  state.inFlight = Math.max(0, state.inFlight - 1);
  state.consecutiveRateLimits += 1;
  state.cooldownStartedAtMs = now;
  state.cooldownUntilMs = now + waitMs;
  state.lastError = stringifyError(error);
  const errorSummary = summarizeErrorForLog(error);
  logger.warn(
    `[gemma-key-pool] key_cooled_down slot=${state.slot + 1} key=${fingerprintKey(
      state.apiKey
    )} waitMs=${waitMs} consecutiveRateLimits=${state.consecutiveRateLimits} error=${JSON.stringify(
      errorSummary
    )}`
  );
  return waitMs;
}

function shouldRetryAfterError(state: KeyState, error: unknown): boolean {
  if (!isRateLimitError(error)) {
    releaseNonRateLimit(state, error);
    return false;
  }

  if (isNonRetryableRateLimitLikeError(error)) {
    releaseNonRateLimit(state, error);
    logger.warn(
      `[gemma-key-pool] non_retryable_rate_limit_like_error slot=${state.slot + 1} key=${fingerprintKey(
        state.apiKey
      )} error=${JSON.stringify(summarizeErrorForLog(error))}`
    );
    return false;
  }

  releaseRateLimited(state, error);
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function getGoogleApiKeys(): string[] {
  return parseApiKeys();
}

export function __resetGoogleGemmaKeyPoolsForTests(): void {
  sharedPools.clear();
}

export function createRotatingGemmaModel(
  factory: (apiKey: string) => ChatGoogleGenerativeAI,
  options?: { poolTag?: string }
): ChatGoogleGenerativeAI {
  const apiKeys = getGoogleApiKeys();
  const pool = getOrCreatePoolState(apiKeys, factory, options?.poolTag);
  const logSelection = shouldLogKeyRotation(apiKeys);

  const wrap = (states: KeyState[]): ChatGoogleGenerativeAI => {
    const base = states[0]?.model;
    if (!base) {
      throw new Error("Gemma model pool is empty");
    }

    return new Proxy(base as unknown as Record<string, unknown>, {
      get(target, prop, receiver) {
        if (prop === "invoke") {
          return async (...args: unknown[]) => {
            while (true) {
              const state = await acquireState(
                pool,
                logSelection,
                apiKeys.length
              );
              try {
                const result = await (
                  state.model as unknown as {
                    invoke: (...invokeArgs: unknown[]) => Promise<unknown>;
                  }
                ).invoke(...args);
                releaseSuccess(state);
                return result;
              } catch (error) {
                if (!shouldRetryAfterError(state, error)) {
                  throw error;
                }
              }
            }
          };
        }

        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") {
          return value;
        }

        if (
          typeof prop === "string" &&
          MODEL_FACTORY_METHODS.has(prop) &&
          states.every(
            (state) =>
              typeof (state.model as unknown as Record<string, unknown>)[
                prop
              ] === "function"
          )
        ) {
          return (...args: unknown[]) => {
            const nextStates = states.map((state) => ({
              ...state,
              model: (
                state.model as unknown as Record<
                  string,
                  (...fnArgs: unknown[]) => unknown
                >
              )[prop](...args) as ChatGoogleGenerativeAI,
            }));
            return wrap(nextStates);
          };
        }

        return value.bind(base);
      },
    }) as unknown as ChatGoogleGenerativeAI;
  };

  return wrap(pool.states);
}
