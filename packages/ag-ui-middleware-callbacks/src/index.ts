/**
 * AG-UI Middleware & Callbacks for LangChain.js
 * 
 * This package provides middleware and callbacks that make LangChain agents
 * compatible with the AG-UI protocol for real-time agent-to-UI communication.
 * 
 * Now includes official @ag-ui/core types and @ag-ui/proto support for
 * Protocol Buffer binary encoding (60-80% smaller payloads).
 * 
 * @packageDocumentation
 */

// Factory functions
export { createAGUIMiddleware } from "./middleware/createAGUIMiddleware";
export { createAGUIAgent } from "./createAGUIAgent";

// Transport utilities - SSE (default)
export { createSSETransport } from "./transports/createSSETransport";
export type { SSETransport } from "./transports/createSSETransport";

// Transport utilities - Protobuf (new)
export { 
  createProtobufTransport,
  encodeEventWithFraming,
  decodeEventWithFraming,
  AGUI_MEDIA_TYPE,
} from "./transports/createProtobufTransport";

// Transport types
export type { AGUITransport, ProtobufTransport } from "./transports/types";

// Callback handler
export { AGUICallbackHandler } from "./callbacks/AGUICallbackHandler";

// Utility functions
export { generateId } from "./utils/idGenerator";
export { computeStateDelta } from "./utils/stateDiff";
export { mapLangChainMessageToAGUI } from "./utils/messageMapper";
export { cleanLangChainData, extractToolOutput } from "./utils/cleaner";
export { expandEvent } from "./utils/eventNormalizer";

// Validation utilities (@ag-ui/core integration)
export { 
  validateEvent, 
  isValidEvent, 
  createValidatingTransport,
  type ValidationResult,
} from "./utils/validation";

// Types (backward compatible)
export type { AGUIEvent, Message, ToolCall, MessageRole } from "./events";
export type { AGUIMiddlewareOptions } from "./middleware/types";
export { AGUIMiddlewareOptionsSchema } from "./middleware/types";

export type { AGUIAgentConfig } from "./createAGUIAgent";

// Re-export @ag-ui/core utilities for advanced usage
export { EventType, EventSchemas } from "./events";

// Re-export @ag-ui/proto utilities for direct protobuf access
export { 
  encodeProtobuf,
  decodeProtobuf,
} from "./types/ag-ui";
