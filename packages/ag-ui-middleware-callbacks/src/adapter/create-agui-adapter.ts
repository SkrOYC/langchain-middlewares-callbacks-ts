import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import {
  AGUICallbackHandler,
  type AGUICallbackHandlerOptions,
} from "@/callbacks/agui-callback-handler";
import { createAGUIMiddleware } from "@/middleware/create-agui-middleware";
import type { AGUIMiddlewareOptions } from "@/middleware/types";
import { createAGUIRunPublisher } from "@/publication/create-agui-run-publisher";

export interface AGUIAgentRunOptions extends Record<string, unknown> {
  callbacks?: unknown[];
  configurable?: Record<string, unknown>;
  context?: Record<string, unknown>;
  signal?: AbortSignal;
  streamMode?: unknown;
}

export interface AGUIAgentLike {
  stream(
    input: Record<string, unknown>,
    options?: AGUIAgentRunOptions
  ): Promise<AsyncIterable<unknown>>;
}

export type AGUIAgentFactory = (args: {
  input: RunAgentInput;
  middleware: ReturnType<typeof createAGUIMiddleware>;
}) => AGUIAgentLike | Promise<AGUIAgentLike>;

export interface AGUIAdapterRunOptions {
  signal?: AbortSignal;
}

export interface AGUIAdapter {
  stream(
    input: RunAgentInput,
    options?: AGUIAdapterRunOptions
  ): Promise<AsyncIterable<BaseEvent>>;
}

export interface AGUIAdapterConfig {
  agentFactory: AGUIAgentFactory;
  validateEvents?: boolean | "strict";
  emitStateSnapshots?: AGUIMiddlewareOptions["emitStateSnapshots"];
  emitActivities?: AGUIMiddlewareOptions["emitActivities"];
  errorDetailLevel?: AGUIMiddlewareOptions["errorDetailLevel"];
  callbackOptions?: Omit<AGUICallbackHandlerOptions, "publish">;
}

interface QueueWaiter<T> {
  reject: (reason?: unknown) => void;
  resolve: (result: IteratorResult<T>) => void;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAgentInput(input: RunAgentInput): Record<string, unknown> {
  if (isRecord(input.state)) {
    return {
      ...input.state,
      messages: input.messages,
    };
  }

  return {
    messages: input.messages,
    state: input.state,
  };
}

function publishFromMiddleware(
  publisher: ReturnType<typeof createAGUIRunPublisher>
): (event: BaseEvent) => void {
  return (event) => {
    if (event.type === EventType.RUN_FINISHED) {
      return;
    }

    publisher.publish(event);
  };
}

async function consumeAgentStream(
  stream: AsyncIterable<unknown>
): Promise<unknown> {
  let lastChunk: unknown;

  for await (const chunk of stream) {
    lastChunk = chunk;
  }

  return lastChunk;
}

function createAsyncQueue<T>(): {
  close: () => void;
  error: (error: unknown) => void;
  iterable: AsyncIterable<T>;
  push: (value: T) => void;
} {
  const values: T[] = [];
  const waiters: QueueWaiter<T>[] = [];
  let isClosed = false;
  let failure: unknown;

  const resolveBufferedValues = () => {
    while (values.length > 0 && waiters.length > 0) {
      const waiter = waiters.shift();
      const value = values.shift();
      if (waiter && typeof value !== "undefined") {
        waiter.resolve({ value, done: false });
      }
    }
  };

  const rejectPendingWaiters = () => {
    if (typeof failure === "undefined") {
      return;
    }

    for (const waiter of waiters.splice(0)) {
      waiter.reject(failure);
    }
  };

  const closePendingWaiters = () => {
    if (!isClosed) {
      return;
    }

    for (const waiter of waiters.splice(0)) {
      waiter.resolve({ value: undefined as T, done: true });
    }
  };

  const flush = () => {
    resolveBufferedValues();

    if (values.length > 0 || waiters.length === 0) {
      return;
    }

    rejectPendingWaiters();
    closePendingWaiters();
  };

  return {
    push(value) {
      if (isClosed || typeof failure !== "undefined") {
        return;
      }

      values.push(value);
      flush();
    },

    close() {
      if (isClosed || typeof failure !== "undefined") {
        return;
      }

      isClosed = true;
      flush();
    },

    error(error) {
      if (isClosed || typeof failure !== "undefined") {
        return;
      }

      failure = error;
      flush();
    },

    iterable: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (values.length > 0) {
            yield values.shift() as T;
            continue;
          }

          if (typeof failure !== "undefined") {
            throw failure;
          }

          if (isClosed) {
            return;
          }

          const result = await new Promise<IteratorResult<T>>(
            (resolve, reject) => {
              waiters.push({ resolve, reject });
            }
          );

          if (result.done) {
            return;
          }

          yield result.value;
        }
      },
    },
  };
}

export function createAGUIAdapter(config: AGUIAdapterConfig): AGUIAdapter {
  if (typeof config.agentFactory !== "function") {
    throw new TypeError(
      "agentFactory must be a function that accepts { input, middleware } and returns an agent with a stream() method"
    );
  }

  return {
    stream(input, options = {}) {
      const publisher = createAGUIRunPublisher({
        validateEvents: config.validateEvents,
      });
      const eventQueue = createAsyncQueue<BaseEvent>();
      const unsubscribe = publisher.subscribe((event) => {
        eventQueue.push(event);
      });

      const callbackHandler = new AGUICallbackHandler({
        publish: publisher.publish,
        ...config.callbackOptions,
      });
      const middleware = createAGUIMiddleware({
        publish: publishFromMiddleware(publisher),
        validateEvents: config.validateEvents ?? false,
        emitStateSnapshots: config.emitStateSnapshots ?? "initial",
        emitActivities: config.emitActivities ?? false,
        errorDetailLevel: config.errorDetailLevel ?? "message",
        runIdOverride: input.runId,
        threadIdOverride: input.threadId,
      });

      const run = (async () => {
        try {
          const agent = await config.agentFactory({ input, middleware });
          const stream = await agent.stream(toAgentInput(input), {
            callbacks: [callbackHandler],
            signal: options.signal,
            streamMode: "values",
            configurable: {
              run_id: input.runId,
              thread_id: input.threadId,
            },
            context: {
              run_id: input.runId,
              thread_id: input.threadId,
              signal: options.signal,
            },
          });

          const result = await consumeAgentStream(stream);
          if (options.signal?.aborted) {
            publisher.close();
          } else {
            publisher.complete(result);
          }
        } catch (error) {
          if (options.signal?.aborted || isAbortError(error)) {
            publisher.close();
          } else {
            publisher.error(error);
          }
        } finally {
          callbackHandler.dispose();
          unsubscribe();
          eventQueue.close();
        }
      })();

      run.catch((error) => {
        eventQueue.error(error);
      });

      return Promise.resolve(eventQueue.iterable);
    },
  };
}
