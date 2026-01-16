/**
 * Middleware Module
 * 
 * Unified exports for all ACP middleware components.
 * 
 * @packageDocumentation
 */

// Session Middleware
export type { ACPSessionMiddlewareConfig, ACPSessionMiddlewareResult } from "./createACPSessionMiddleware.js";
export { createACPSessionMiddleware } from "./createACPSessionMiddleware.js";

// Tool Middleware
export type { ACPToolMiddlewareConfig } from "./createACPToolMiddleware.js";
export { createACPToolMiddleware, mapToolKind } from "./createACPToolMiddleware.js";

// Permission Middleware
export type { 
  ACPPermissionMiddlewareConfig, 
  RequestPermissionOutcome,
  SelectedPermissionOutcome,
} from "./createACPPermissionMiddleware.js";
export { createACPPermissionMiddleware } from "./createACPPermissionMiddleware.js";

// Mode Middleware
export type { 
  ACPModeMiddlewareConfig, 
  ACPModeMiddlewareResult,
} from "./createACPModeMiddleware.js";
export { createACPModeMiddleware, STANDARD_MODES } from "./createACPModeMiddleware.js";

// Mode Configuration Types
export type { ACPModeConfig } from "../types/middleware.js";

// MCP Tool Loader (re-exported from utils for convenience)
export type { 
  MCPToolServerConfig, 
  MCPToolServerMap,
  MCPToolLoadOptions,
  MCPTransportType,
  MCPClient,
} from "../utils/mcpToolLoader.js";
export { 
  loadMCPTools, 
  loadMCPServer,
  createMCPClient,
  defaultMCPClientFactory,
} from "../utils/mcpToolLoader.js";