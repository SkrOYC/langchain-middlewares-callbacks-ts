/**
 * Utility Functions
 * 
 * Unified exports for all ACP middleware callback utilities.
 * 
 * @packageDocumentation
 */

// Content Block Mapper
export type { ContentBlockMapper } from "./contentBlockMapper.js";
export type { DefaultContentBlockMapper, LangChainContentBlock } from "./contentBlockMapper.js";

// Error & stopReason Mapper
export { RequestError } from "@agentclientprotocol/sdk";
export { ACP_ERROR_CODES } from "./errorMapper.js";
export type { ACPErrorCode } from "./errorMapper.js";
export { mapLangChainError, createACPErrorResponse, isACPErrorCode } from "./errorMapper.js";

// Session State Mapper
export type { SessionState } from "./sessionStateMapper.js";
export { zSessionState } from "./sessionStateMapper.js";
export { 
  extractSessionState,
  validateSessionState,
  validateSessionStateDetailed,
  createSessionStateFromCheckpoint,
  mergeSessionState,
  cloneSessionState,
  serializeSessionState,
  deserializeSessionState,
} from "./sessionStateMapper.js";

// Stop Reason Mapper
export { 
  mapToStopReason,
  createStopReasonFromError, 
  isStopReason,
  asStopReason,
} from "./stopReasonMapper.js";

// Shared Utilities
export { extractLocations } from "./extractLocations.js";

// MCP Tool Loader
export type { 
  MCPToolServerConfig, 
  MCPToolServerMap,
  MCPToolLoadOptions,
  MCPTransportType,
  MCPClient,
} from "./mcpToolLoader.js";
export { 
  loadMCPTools, 
  loadMCPServer,
  createMCPClient,
  defaultMCPClientFactory,
} from "./mcpToolLoader.js";