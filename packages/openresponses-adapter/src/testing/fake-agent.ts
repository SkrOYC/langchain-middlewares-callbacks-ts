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
  responses?: LangChainMessageLike[];

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
  __getStreamCount(): number;
  __resetCounts(): void;
}

/**
 * Creates a fake agent for testing.
 *
 * @param config - Configuration for fake behavior
 * @returns Fake agent implementing OpenResponsesCompatibleAgent
 */
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

  return {
    async invoke(
      _input: { messages: LangChainMessageLike[] },
      _config?: Record<string, unknown>
    ): Promise<unknown> {
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
      invokeCount++;
      return responses[index];
    },

    async *stream(
      _input: { messages: LangChainMessageLike[] },
      _config?: Record<string, unknown>
    ): AsyncIterable<unknown> {
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
    __getStreamCount: () => streamCount,
    __resetCounts: () => {
      invokeCount = 0;
      streamCount = 0;
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
