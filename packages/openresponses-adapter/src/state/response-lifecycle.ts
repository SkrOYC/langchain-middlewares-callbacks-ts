import { invalidRequest } from "@/core/errors.js";
import type { ErrorObject } from "@/core/schemas.js";

export type ResponseLifecycleStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "incomplete";

export interface ResponseLifecycle {
  readonly responseId: string;
  readonly createdAt: number;
  getStatus(): ResponseLifecycleStatus;
  start(): void;
  complete(): void;
  fail(error: ErrorObject): void;
  incomplete(error?: ErrorObject): void;
  getError(): ErrorObject | null;
  getCompletedAt(): number | null;
}

export interface ResponseLifecycleOptions {
  responseId: string;
  createdAt: number;
  clock?: () => number;
}

const cloneError = (error: ErrorObject): ErrorObject => {
  return structuredClone(error);
};

const invalidTransition = (
  action: string,
  currentStatus: ResponseLifecycleStatus
): never => {
  throw invalidRequest(
    `Cannot ${action} response lifecycle from '${currentStatus}' state`
  );
};

class DefaultResponseLifecycle implements ResponseLifecycle {
  readonly responseId: string;
  readonly createdAt: number;

  readonly #clock: () => number;
  #status: ResponseLifecycleStatus = "queued";
  #completedAt: number | null = null;
  #error: ErrorObject | null = null;

  constructor(options: ResponseLifecycleOptions) {
    this.responseId = options.responseId;
    this.createdAt = options.createdAt;
    this.#clock = options.clock ?? (() => Date.now());
  }

  getStatus(): ResponseLifecycleStatus {
    return this.#status;
  }

  start(): void {
    if (this.#status !== "queued") {
      invalidTransition("start", this.#status);
    }

    this.#status = "in_progress";
  }

  complete(): void {
    if (this.#status !== "in_progress") {
      invalidTransition("complete", this.#status);
    }

    this.#status = "completed";
    this.#completedAt = this.#clock();
  }

  fail(error: ErrorObject): void {
    if (this.#status !== "in_progress") {
      invalidTransition("fail", this.#status);
    }

    this.#status = "failed";
    this.#completedAt = this.#clock();
    this.#error = cloneError(error);
  }

  incomplete(error?: ErrorObject): void {
    if (this.#status !== "in_progress") {
      invalidTransition("mark incomplete", this.#status);
    }

    this.#status = "incomplete";
    this.#completedAt = this.#clock();
    this.#error = error ? cloneError(error) : null;
  }

  getError(): ErrorObject | null {
    return this.#error ? cloneError(this.#error) : null;
  }

  getCompletedAt(): number | null {
    return this.#completedAt;
  }
}

export const createResponseLifecycle = (
  options: ResponseLifecycleOptions
): ResponseLifecycle => {
  return new DefaultResponseLifecycle(options);
};
