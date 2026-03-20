import {
  agentExecutionFailed,
  type InternalError,
  internalError,
} from "@/core/errors.js";
import type {
  OpenResponsesExecutionOptions,
  OpenResponsesTimeoutBudgets,
} from "@/core/types.js";

const DEFAULT_TIMEOUT_BUDGETS = {
  requestValidationMs: 1000,
  previousResponseLoadMs: 2000,
  agentExecutionMs: 60_000,
  previousResponseSaveMs: 2000,
} satisfies Required<OpenResponsesTimeoutBudgets>;

const NOOP = (): void => {
  // Intentionally empty cleanup callback.
};

const isAbortSignal = (value: unknown): value is AbortSignal => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    "aborted" in candidate && typeof candidate.addEventListener === "function"
  );
};

export const resolveTimeoutBudgets = (
  budgets?: OpenResponsesTimeoutBudgets
): Required<OpenResponsesTimeoutBudgets> => {
  return {
    ...DEFAULT_TIMEOUT_BUDGETS,
    ...budgets,
  };
};

export const normalizeExecutionOptions = (
  signalOrOptions?: AbortSignal | OpenResponsesExecutionOptions
): OpenResponsesExecutionOptions => {
  if (!signalOrOptions) {
    return {};
  }

  if (isAbortSignal(signalOrOptions)) {
    return { signal: signalOrOptions };
  }

  return signalOrOptions;
};

const linkParentAbortSignal = (
  controller: AbortController,
  signal?: AbortSignal
): (() => void) => {
  if (!signal) {
    return NOOP;
  }

  if (signal.aborted) {
    controller.abort(signal.reason);
    return NOOP;
  }

  const handleAbort = () => {
    controller.abort(signal.reason);
  };

  signal.addEventListener("abort", handleAbort, { once: true });
  return () => {
    signal.removeEventListener("abort", handleAbort);
  };
};

export const createRequestAbortController = (
  signal?: AbortSignal
): { controller: AbortController; cleanup: () => void } => {
  const controller = new AbortController();
  const cleanup = linkParentAbortSignal(controller, signal);
  return { controller, cleanup };
};

export const withTimeout = async <T>(params: {
  operation: (signal: AbortSignal) => Promise<T>;
  signal: AbortSignal | undefined;
  timeoutMs: number;
  onTimeout: () => InternalError;
}): Promise<T> => {
  const controller = new AbortController();
  const cleanupParentSignal = linkParentAbortSignal(controller, params.signal);
  const timeoutError = params.onTimeout();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, params.timeoutMs);
  });

  try {
    const operationPromise = Promise.resolve().then(() =>
      params.operation(controller.signal)
    );
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    cleanupParentSignal();
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
};

export const requestValidationTimedOut = (timeoutMs: number): InternalError => {
  return internalError(`Request validation timed out after ${timeoutMs}ms`);
};

export const previousResponseLoadTimedOut = (
  timeoutMs: number
): InternalError => {
  return internalError(`Previous response load timed out after ${timeoutMs}ms`);
};

export const previousResponseSaveTimedOut = (
  timeoutMs: number
): InternalError => {
  return internalError(`Previous response save timed out after ${timeoutMs}ms`);
};

export const agentExecutionTimedOut = (timeoutMs: number): InternalError => {
  return agentExecutionFailed(`Agent execution timed out after ${timeoutMs}ms`);
};
