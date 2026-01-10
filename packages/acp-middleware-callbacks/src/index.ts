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

// Middleware Exports
export * from "./middleware/index.js";

// Callback Exports
export * from "./callbacks/index.js";

// Re-export middleware and callback functions
export { createACPSessionMiddleware, createACPCheckpointer } from "./middleware/index.js";
export { createACPCallbackHandler, ACPCallbackHandler } from "./callbacks/index.js";