import { invalidRequest } from "@/core/errors.js";

export interface AsyncEventQueue<T> extends AsyncIterable<T> {
  push(event: T): void;
  complete(): void;
  fail(error: unknown): void;
  isFinalized(): boolean;
}

type QueueResult<T> =
  | { done: false; value: T }
  | { done: true; error?: unknown };

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const createDeferred = <T>(): Promise<T> & Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  }) as Promise<T> & Deferred<T>;

  promise.resolve = resolve;
  promise.reject = reject;

  return promise;
};

class DefaultAsyncEventQueue<T> implements AsyncEventQueue<T> {
  readonly #buffer: QueueResult<T>[] = [];
  readonly #waiters: Deferred<QueueResult<T>>[] = [];
  #finalized = false;

  push(event: T): void {
    if (this.#finalized) {
      throw invalidRequest(
        "Cannot push events after the async event queue is finalized"
      );
    }

    const next = this.#waiters.shift();
    if (next) {
      next.resolve({ done: false, value: event });
      return;
    }

    this.#buffer.push({ done: false, value: event });
  }

  complete(): void {
    this.#finalize({ done: true });
  }

  fail(error: unknown): void {
    this.#finalize({ done: true, error });
  }

  isFinalized(): boolean {
    return this.#finalized;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async (): Promise<IteratorResult<T>> => {
        const result = await this.#shift();
        if (result.done) {
          if ("error" in result && result.error !== undefined) {
            throw result.error;
          }

          return { done: true, value: undefined };
        }

        return { done: false, value: result.value };
      },
    };
  }

  #shift(): Promise<QueueResult<T>> {
    const buffered = this.#buffer.shift();
    if (buffered) {
      return Promise.resolve(buffered);
    }

    const waiter = createDeferred<QueueResult<T>>();
    this.#waiters.push(waiter);
    return waiter;
  }

  #finalize(result: QueueResult<T>): void {
    if (this.#finalized) {
      throw invalidRequest("Async event queue is already finalized");
    }

    this.#finalized = true;

    if (this.#waiters.length > 0) {
      for (const waiter of this.#waiters.splice(0)) {
        waiter.resolve(result);
      }
      return;
    }

    this.#buffer.push(result);
  }
}

export const createAsyncEventQueue = <T>(): AsyncEventQueue<T> => {
  return new DefaultAsyncEventQueue<T>();
};
