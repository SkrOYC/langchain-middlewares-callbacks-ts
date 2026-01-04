/**
 * SSE Transport Implementation
 * 
 * Server-Sent Events transport for AG-UI protocol.
 * Provides:
 * - Proper SSE headers
 * - Fail-safe emission (never throws on client disconnect)
 * - Abort signal integration for client disconnect handling
 * - Backpressure handling with queue-based emission
 */

import type { AGUIEvent } from "../events";
import type { AGUITransport } from "./types";

/**
 * Extended SSE transport interface with abort signal.
 */
export interface SSETransport extends AGUITransport {
  /** Abort signal triggered on client disconnect */
  signal: AbortSignal;
}

/**
 * HTTP request interface for SSE transport.
 */
interface SSETransportRequest {
  on(event: string, callback: () => void): void;
}

/**
 * HTTP response interface for SSE transport.
 */
interface SSETransportResponse {
  setHeader(name: string, value: string): SSETransportResponse;
  write(data: string): boolean;
  end?(): void;
}

/**
 * Create an SSE transport for Server-Sent Events.
 * 
 * @param req - HTTP request object (listens for 'close' event)
 * @param res - HTTP response object
 * @returns SSETransport with emit method and abort signal
 */
export function createSSETransport(
  req: SSETransportRequest,
  res: SSETransportResponse
): SSETransport {
  // Set proper SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // Create abort controller for client disconnect handling
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  // Backpressure queue
  const queue: AGUIEvent[] = [];
  let draining = false;

  /**
   * Drain the event queue to the response.
   */
  async function drain(): Promise<void> {
    draining = true;
    while (queue.length > 0 && res.write) {
      const event = queue.shift()!;
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Client disconnected - stop draining
        break;
      }
    }
    draining = false;
  }

  return {
    emit: (event: AGUIEvent) => {
      queue.push(event);
      if (!draining) {
        drain();
      }
    },

    signal: controller.signal,

    disconnect: res.end
      ? () => {
          res.end?.();
        }
      : undefined,

    isConnected: () => !controller.signal.aborted,
  };
}
