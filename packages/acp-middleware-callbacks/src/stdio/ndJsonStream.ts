/**
 * NDJSON Stream Utilities
 * 
 * Wrapper utilities around @agentclientprotocol/sdk's ndJsonStream function
 * for easier usage in stdio transport implementations.
 * 
 * @packageDocumentation
 */

import * as acp from "@agentclientprotocol/sdk";

/**
 * Stream interface for ACP communication.
 * Wraps the SDK's stream types with a cleaner interface.
 */
export interface ACPStream {
  /**
   * Writable side of the stream for sending messages.
   */
  writable: WritableStream<unknown>;
  
  /**
   * Readable side of the stream for receiving messages.
   */
  readable: ReadableStream<unknown>;
}

/**
 * Options for creating an NDJSON stream from Node.js streams.
 */
export interface NodeStreamsOptions {
  /**
   * The stdin stream to read from.
   * @default process.stdin
   */
  stdin?: ReadableStream<Uint8Array>;
  
  /**
   * The stdout stream to write to.
   * @default process.stdout
   */
  stdout?: WritableStream<Uint8Array>;
  
  /**
   * Encoding for text streams.
   * @default 'utf-8'
   */
  encoding?: string;
}

/**
 * Creates an ACPStream from Node.js stdio streams.
 * This is the most common use case for local agent processes.
 * 
 * @param options - Configuration options for the streams
 * @returns ACPStream for ACP communication
 * 
 * @example
 * ```typescript
 * import { createNodeStream } from './ndJsonStream';
 * 
 * const stream = createNodeStream();
 * ```
 */
// Type declaration for process in browser/non-Node environments
declare const process: { stdin?: { asUnknown: unknown }; stdout?: { asUnknown: unknown } } | undefined;

export function createNodeStream(options: NodeStreamsOptions = {}): ACPStream {
  const stdin = options.stdin ?? ((process?.stdin?.asUnknown ?? new ReadableStream()) as ReadableStream<Uint8Array>);
  const stdout = options.stdout ?? ((process?.stdout?.asUnknown ?? new WritableStream()) as WritableStream<Uint8Array>);
  
  return createACPStream(stdin, stdout);
}

/**
 * Creates an ACPStream from raw byte streams.
 * Uses the SDK's ndJsonStream function internally.
 * 
 * @param input - Readable byte stream for incoming messages
 * @param output - Writable byte stream for outgoing messages  
 * @returns ACPStream for ACP communication
 * 
 * @example
 * ```typescript
 * import { createACPStream } from './ndJsonStream';
 * import { spawn } from 'child_process';
 * 
 * const child = spawn('agent-process', [], { stdio: ['pipe', 'pipe', 'pipe'] });
 * const stream = createACPStream(
 *   child.stdout as ReadableStream<Uint8Array>,
 *   child.stdin as WritableStream<Uint8Array>
 * );
 * ```
 */
export function createACPStream(
  input: ReadableStream<Uint8Array>,
  output: WritableStream<Uint8Array>
): ACPStream {
  // Use the SDK's ndJsonStream utility
  // SDK expects: (output, input) where output is WritableStream and input is ReadableStream
  const stream = acp.ndJsonStream(output, input);
  
  return {
    writable: stream.writable as WritableStream<unknown>,
    readable: stream.readable as ReadableStream<unknown>,
  };
}

/**
 * Creates a test stream pair for unit testing.
 * Provides mock readable and writable streams that can be controlled manually.
 * 
 * @returns Object containing test streams and control methods
 * 
 * @example
 * ```typescript
 * import { createTestStreamPair } from './ndJsonStream';
 * 
 * const { readable, writable, write, read, close } = createTestStreamPair();
 * 
 * // Write a message to the writable side
 * await write({ jsonrpc: '2.0', method: 'test', params: {} });
 * 
 * // Read the message from the readable side
 * const message = await read();
 * ```
 */
export function createTestStreamPair(): {
  readable: ReadableStream<unknown>;
  writable: WritableStream<unknown>;
  write: (message: unknown) => Promise<void>;
  read: () => Promise<unknown>;
  close: () => void;
  getWrittenMessages: () => unknown[];
  enqueue: (message: unknown) => void;
} {
  const writtenMessages: unknown[] = [];
  let closed = false;
  let controller: ReadableStreamDefaultController | null = null;
  
  // Create the readable side
  const readable = new ReadableStream<unknown>({
    start(ctrl) {
      controller = ctrl;
    },
    cancel() {
      closed = true;
    },
  });
  
  // Create the writable side
  const writable = new WritableStream<unknown>({
    write(chunk) {
      writtenMessages.push(chunk);
      return Promise.resolve();
    },
    close() {
      closed = true;
    },
    abort() {
      closed = true;
    },
  });
  
  // Control methods
  const write = async (message: unknown): Promise<void> => {
    if (closed) {
      return;
    }
    const writer = writable.getWriter();
    try {
      await writer.write(message);
    } finally {
      writer.releaseLock();
    }
  };
  
  const read = async (): Promise<unknown> => {
    const reader = readable.getReader();
    try {
      const { done, value } = await reader.read();
      if (done) return null;
      return value;
    } finally {
      reader.releaseLock();
    }
  };
  
  const close = (): void => {
    closed = true;
    try {
      controller?.close();
    } catch {
      // Controller might already be closed
    }
  };
  
  const enqueue = (message: unknown): void => {
    if (!closed && controller) {
      controller.enqueue(message);
    }
  };
  
  return {
    readable,
    writable,
    write,
    read,
    close,
    getWrittenMessages: () => writtenMessages,
    enqueue,
  };
}