/**
 * Fake Agent for Testing
 *
 * Provides controllable fake agent behavior for testing the adapter.
 */

import type { OpenResponsesCompatibleAgent } from "../core/factory.js";
import type { LangChainMessageLike } from "../core/types.js";

export interface FakeAgentConfig {
  /**
   * Response messages to return in order.
   */
  responses?: Array<LangChainMessageLike | LangChainMessageLike[]>;

  /**
   * Stream chunks to yield for streaming responses.
   */
  streamChunks?: unknown[];

  /**
   * Error to throw on invoke.
   */
  invokeError?: Error;

  /**
   * Error to throw on stream.
   */
  streamError?: Error;

  /**
   * Delay in ms before returning response.
   */
  delay?: number;
}

/**
 * Fake Agent interface for testing with additional utilities.
 */
export interface FakeAgent extends OpenResponsesCompatibleAgent {
  __getInvokeCount(): number;
  __getLastInvokeInput(): { messages: LangChainMessageLike[] } | null;
  __getLastInvokeConfig(): Record<string, unknown> | null;
  __getStreamCount(): number;
  __getLastStreamInput(): { messages: LangChainMessageLike[] } | null;
  __getLastStreamConfig(): Record<string, unknown> | null;
  __resetCounts(): void;
}

/**
 * Creates a fake agent for testing.
 *
 * @param config - Configuration for fake behavior
 * @returns Fake agent implementing OpenResponsesCompatibleAgent
 */

const toResponseBatch = (
  response: LangChainMessageLike | LangChainMessageLike[]
): LangChainMessageLike[] => {
  return Array.isArray(response) ? response : [response];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const snapshotValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => snapshotValue(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        snapshotValue(entryValue),
      ])
    );
  }

  return value;
};

const snapshotConfig = (
  config: Record<string, unknown> | undefined
): Record<string, unknown> | null => {
  if (!config) {
    return null;
  }

  return snapshotValue(config) as Record<string, unknown>;
};

export function createFakeAgent(config: FakeAgentConfig = {}): FakeAgent {
  const {
    responses = [
      {
        type: "ai",
        id: "fake-msg-1",
        content: "Hello from fake agent!",
      },
    ],
    streamChunks = [],
    invokeError,
    streamError,
    delay = 0,
  } = config;

  let invokeCount = 0;
  let streamCount = 0;
  let lastInvokeInput: { messages: LangChainMessageLike[] } | null = null;
  let lastInvokeConfig: Record<string, unknown> | null = null;
  let lastStreamInput: { messages: LangChainMessageLike[] } | null = null;
  let lastStreamConfig: Record<string, unknown> | null = null;

  return {
    async invoke(
      input: { messages: LangChainMessageLike[] },
      config?: Record<string, unknown>
    ): Promise<unknown> {
      lastInvokeInput = structuredClone(input);
      lastInvokeConfig = snapshotConfig(config);

      if (invokeError) {
        throw invokeError;
      }

      if (responses.length === 0) {
        throw new Error(
          "FakeAgent misconfigured: responses array cannot be empty"
        );
      }

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const index = Math.min(invokeCount, responses.length - 1);
      const response = responses[index];
      if (response === undefined) {
        throw new Error(
          "FakeAgent misconfigured: response for invoke index is undefined"
        );
      }

      invokeCount++;

      return {
        messages: [
          ...structuredClone(input.messages),
          ...structuredClone(toResponseBatch(response)),
        ],
      };
    },

    async *stream(
      input: { messages: LangChainMessageLike[] },
      config?: Record<string, unknown>
    ): AsyncIterable<unknown> {
      lastStreamInput = structuredClone(input);
      lastStreamConfig = snapshotConfig(config);

      if (streamError) {
        throw streamError;
      }

      for (const chunk of streamChunks) {
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        streamCount++;
        yield chunk;
      }
    },

    // Expose for testing
    __getInvokeCount: () => invokeCount,
    __getLastInvokeInput: () => lastInvokeInput,
    __getLastInvokeConfig: () => lastInvokeConfig,
    __getStreamCount: () => streamCount,
    __getLastStreamInput: () => lastStreamInput,
    __getLastStreamConfig: () => lastStreamConfig,
    __resetCounts: () => {
      invokeCount = 0;
      streamCount = 0;
      lastInvokeInput = null;
      lastInvokeConfig = null;
      lastStreamInput = null;
      lastStreamConfig = null;
    },
  };
}

/**
 * Creates a fake agent that returns a simple text response.
 */
export function createTextFakeAgent(
  text: string
): OpenResponsesCompatibleAgent {
  return createFakeAgent({
    responses: [
      {
        type: "ai",
        id: "fake-msg-1",
        content: text,
      },
    ],
  });
}

/**
 * Creates a fake agent that streams text chunks.
 */
export function createStreamingFakeAgent(
  chunks: string[]
): OpenResponsesCompatibleAgent {
  return createFakeAgent({
    streamChunks: chunks.map((chunk) => ({
      type: "chunk",
      content: chunk,
    })),
  });
}

/**
 * Creates a fake agent that throws an error.
 */
export function createErrorFakeAgent(
  error: Error
): OpenResponsesCompatibleAgent {
  return createFakeAgent({
    invokeError: error,
    streamError: error,
  });
}
