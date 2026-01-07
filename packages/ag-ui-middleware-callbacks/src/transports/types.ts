/**
 * AGUI Transport Interface
 * 
 * A custom abstraction for AG-UI event emission.
 * The AG-UI protocol defines event formats but leaves transport mechanisms implementation-defined.
 * This interface provides a simple, portable way to emit events that works with any backend transport.
 */

import type { AGUIEvent } from "../events";

/**
 * Transport interface for AG-UI event emission.
 */
export interface AGUITransport {
  /**
   * Emit an AG-UI protocol event.
   */
  emit(event: AGUIEvent): void;

  /**
   * Optional connection lifecycle methods.
   */
  connect?(): Promise<void>;
  disconnect?(): void;
  isConnected?(): boolean;
}

/**
 * Extended Protobuf transport interface with binary encoding utilities.
 * 
 * Provides all base AGUITransport functionality plus:
 * - Abort signal for client disconnect handling
 * - Binary encoding/decoding utilities
 */
export interface ProtobufTransport extends AGUITransport {
  /** Abort signal triggered on client disconnect */
  signal: AbortSignal;
  
  /**
   * Encode an event with 4-byte Big-Endian length prefix.
   * Useful for manual encoding when needed.
   */
  encodeEvent(event: AGUIEvent): Uint8Array;
  
  /**
   * Decode a framed event (with 4-byte length prefix).
   * Useful for parsing received protobuf data.
   */
  decodeEvent(data: Uint8Array): AGUIEvent;
}
