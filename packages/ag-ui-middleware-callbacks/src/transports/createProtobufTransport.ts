/**
 * Protobuf Transport Implementation
 * 
 * Protocol Buffer transport for AG-UI protocol.
 * Provides:
 * - Binary encoding using @ag-ui/proto
 * - 4-byte Big-Endian length prefix per protocol spec
 * - Fail-safe emission (never throws on client disconnect)
 * - Abort signal integration for client disconnect handling
 * - Backpressure handling with queue-based emission
 * 
 * Protobuf provides 60-80% smaller payloads compared to JSON/SSE.
 * 
 * @see https://docs.ag-ui.com/introduction
 */

import { encode, decode, AGUI_MEDIA_TYPE } from '@ag-ui/proto';
import type { AGUIEvent } from "../events";
import type { AGUITransport, ProtobufTransport } from "./types";

/**
 * Re-export the official AG-UI media type for content negotiation.
 */
export { AGUI_MEDIA_TYPE };

/**
 * HTTP request interface for Protobuf transport.
 */
interface ProtobufTransportRequest {
  on(event: string, callback: () => void): void;
}

/**
 * HTTP response interface for Protobuf transport.
 */
interface ProtobufTransportResponse {
  setHeader(name: string, value: string): ProtobufTransportResponse;
  write(data: Buffer | Uint8Array): boolean;
  end?(): void;
}

/**
 * Encode an AG-UI event with 4-byte Big-Endian length prefix.
 * 
 * Per AG-UI protocol spec:
 * ┌─────────────────┬──────────────────────────────────┐
 * │ Length (4 BE)   │ Protobuf Event Bytes             │
 * └─────────────────┴──────────────────────────────────┘
 * 
 * @param event - The AG-UI event to encode
 * @returns Uint8Array with length prefix + protobuf bytes
 */
export function encodeEventWithFraming(event: AGUIEvent): Uint8Array {
  // Convert our event type to @ag-ui/core BaseEvent format
  // The @ag-ui/proto encode function expects a BaseEvent from @ag-ui/core
  const coreEvent = convertToProtobufEvent(event);
  
  // Encode to protobuf bytes
  const eventBytes = encode(coreEvent);
  
  // Create 4-byte Big-Endian length prefix
  const lengthPrefix = new DataView(new ArrayBuffer(4));
  lengthPrefix.setUint32(0, eventBytes.length, false); // false = Big-Endian
  
  // Concatenate length + payload
  const result = new Uint8Array(4 + eventBytes.length);
  result.set(new Uint8Array(lengthPrefix.buffer), 0);
  result.set(eventBytes, 4);
  
  return result;
}

/**
 * Decode a framed protobuf event (with 4-byte length prefix).
 * 
 * @param data - Buffer containing length prefix + protobuf bytes
 * @returns The decoded AG-UI event
 */
export function decodeEventWithFraming(data: Uint8Array): AGUIEvent {
  if (data.length < 4) {
    throw new Error("Invalid protobuf frame: insufficient data for length prefix");
  }
  
  const length = new DataView(data.buffer, data.byteOffset).getUint32(0, false); // Big-Endian
  
  if (data.length < 4 + length) {
    throw new Error("Invalid protobuf frame: insufficient data for payload");
  }
  
  const eventBytes = data.slice(4, 4 + length);
  const decoded = decode(eventBytes);
  
  // Convert back to our event format
  return convertFromProtobufEvent(decoded) as AGUIEvent;
}

/**
 * Convert our event format to @ag-ui/core BaseEvent format.
 * Handles field name differences (e.g., tool_calls → toolCalls).
 */
function convertToProtobufEvent(event: AGUIEvent): any {
  const baseEvent: any = { ...event };
  
  // Handle Message objects in MESSAGES_SNAPSHOT
  if (event.type === "MESSAGES_SNAPSHOT" && event.messages) {
    baseEvent.messages = event.messages.map((msg: any) => ({
      ...msg,
      // Convert tool_calls to toolCalls if present
      toolCalls: msg.tool_calls?.map((tc: any) => ({
        id: tc.id,
        type: tc.type,
        function: tc.function,
      })),
      // Remove snake_case version
      tool_calls: undefined,
      // Convert tool_call_id to toolCallId
      toolCallId: msg.tool_call_id,
      tool_call_id: undefined,
    }));
  }
  
  return baseEvent;
}

/**
 * Convert @ag-ui/core BaseEvent format back to our event format.
 * Handles field name differences (e.g., toolCalls → tool_calls).
 */
function convertFromProtobufEvent(event: any): AGUIEvent {
  const result: any = { ...event };
  
  // Handle Message objects in MESSAGES_SNAPSHOT
  if (event.type === "MESSAGES_SNAPSHOT" && event.messages) {
    result.messages = event.messages.map((msg: any) => ({
      ...msg,
      // Convert toolCalls to tool_calls if present
      tool_calls: msg.toolCalls?.map((tc: any) => ({
        id: tc.id,
        type: tc.type,
        function: tc.function,
      })),
      // Remove camelCase version
      toolCalls: undefined,
      // Convert toolCallId to tool_call_id
      tool_call_id: msg.toolCallId,
      toolCallId: undefined,
    }));
  }
  
  return result;
}

/**
 * Create a Protobuf transport for binary AG-UI protocol communication.
 * 
 * @param req - HTTP request object (listens for 'close' event)
 * @param res - HTTP response object
 * @returns ProtobufTransport with emit method and abort signal
 * 
 * @example
 * ```typescript
 * app.post('/api/agent', (req, res) => {
 *   const acceptProtobuf = req.headers.accept?.includes(AGUI_MEDIA_TYPE);
 *   
 *   if (acceptProtobuf) {
 *     const transport = createProtobufTransport(req, res);
 *     // Use transport.emit() for binary encoding
 *   } else {
 *     const transport = createSSETransport(req, res);
 *     // Use transport.emit() for JSON/SSE
 *   }
 * });
 * ```
 */
export function createProtobufTransport(
  req: ProtobufTransportRequest,
  res: ProtobufTransportResponse
): ProtobufTransport {
  // Set proper Protobuf headers
  res.setHeader("Content-Type", AGUI_MEDIA_TYPE);
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
        const framedData = encodeEventWithFraming(event);
        res.write(framedData);
      } catch {
        // Client disconnected or encoding error - stop draining
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
    
    // Protobuf-specific utilities
    encodeEvent: encodeEventWithFraming,
    decodeEvent: decodeEventWithFraming,
  };
}
