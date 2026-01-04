/**
 * AG-UI Middleware & Callbacks for LangChain.js
 * 
 * This package provides middleware and callbacks that make LangChain agents
 * compatible with the AG-UI protocol for real-time agent-to-UI communication.
 * 
 * @packageDocumentation
 */

// Factory functions
export { createAGUIMiddleware } from "./middleware/createAGUIMiddleware";
export { createAGUIAgent } from "./createAGUIAgent";

// Transport utilities
export { createSSETransport } from "./transports/createSSETransport";
export type { AGUITransport } from "./transports/types";
export type { SSETransport } from "./transports/createSSETransport";

// Callback handler
export { AGUICallbackHandler } from "./callbacks/AGUICallbackHandler";

// Utility functions
export { generateId } from "./utils/idGenerator";
export { computeStateDelta } from "./utils/stateDiff";

// Types
export type { AGUIEvent } from "./events";
export type { AGUIMiddlewareOptions } from "./middleware/types";
export { AGUIMiddlewareOptionsSchema } from "./middleware/types";

export type { AGUIAgentConfig } from "./createAGUIAgent";
