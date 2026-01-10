/**
 * ACP Middleware & Callbacks for LangChain.js
 * 
 * This package provides TypeScript middleware and callbacks that bridge LangChain
 * `createAgent()` implementations to the Agent Client Protocol (ACP) for code
 * editors and AI development environments.
 * 
 * ## Features
 * 
 * - **Middleware:** Lifecycle hooks for session management, tool execution, and permission handling
 * - **Callbacks:** Streaming event emission for real-time agent updates
 * - **Utilities:** Content block mappers, error mappers, and session state utilities
 * 
 * ## Quick Start
 * 
 * ```typescript
 * import { createACPAgent } from '@skroyc/acp-middleware-callbacks';
 * 
 * // Create an ACP-compatible agent
 * const agent = createACPAgent({
 *   model: yourModel,
 *   tools: yourTools,
 *   transport: yourACPTransport,
 * });
 * ```
 * 
 * @packageDocumentation
 */

// Type Definitions
export * from "./types/index.js";

// Utility Functions
export * from "./utils/index.js";

// Placeholder exports for future middleware/callbacks
// These will be implemented in subsequent phases:

/**
 * Session Middleware (Coming in Phase 2)
 * 
 * Middleware for managing ACP session lifecycle events.
 */
export const createACPSessionMiddleware = () => {
  throw new Error('Session middleware not yet implemented. Coming in Phase 2.');
};

/**
 * Tool Middleware (Coming in Phase 3)
 * 
 * Middleware for handling tool execution with ACP protocol support.
 */
export const createACPToolMiddleware = () => {
  throw new Error('Tool middleware not yet implemented. Coming in Phase 3.');
};

/**
 * Permission Middleware (Coming in Phase 4)
 * 
 * Middleware for managing permission requests in ACP protocol.
 */
export const createACPPermissionMiddleware = () => {
  throw new Error('Permission middleware not yet implemented. Coming in Phase 4.');
};

/**
 * Mode Middleware (Coming in Phase 5)
 * 
 * Middleware for handling agent mode switching in ACP protocol.
 */
export const createACPModeMiddleware = () => {
  throw new Error('Mode middleware not yet implemented. Coming in Phase 5.');
};

/**
 * ACP Callback Handler (Coming in Phase 6)
 * 
 * Callback handler for emitting events to ACP clients.
 */
export const createACPCallbackHandler = () => {
  throw new Error('Callback handler not yet implemented. Coming in Phase 6.');
};

/**
 * Stdio Transport (Coming in Phase 7)
 * 
 * Transport implementation for stdio-based ACP communication.
 */
export const createStdioTransport = () => {
  throw new Error('Stdio transport not yet implemented. Coming in Phase 7.');
};

/**
 * Create ACP-compatible agent factory (Coming in Phase 1+)
 * 
 * Factory function for creating LangChain agents with full ACP support.
 */
export const createACPAgent = () => {
  throw new Error('ACP agent factory not yet implemented. Coming in Phase 1+.');
};