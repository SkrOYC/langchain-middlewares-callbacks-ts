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
export { mapToStopReason, mapLangChainError, createACPErrorResponse, isStopReason, isACPErrorCode } from "./errorMapper.js";

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