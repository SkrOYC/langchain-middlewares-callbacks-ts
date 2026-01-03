/**
 * AGUI Transport Interface
 * 
 * A custom abstraction for AG-UI event emission.
 * The AG-UI protocol defines event formats but leaves transport mechanisms implementation-defined.
 * This interface provides a simple, portable way to emit events that works with any backend transport.
 */

import type { AGUIEvent } from "../../events";

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
