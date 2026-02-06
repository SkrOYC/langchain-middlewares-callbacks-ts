/**
 * Middleware Module
 *
 * Unified exports for all ACP middleware components.
 *
 * @packageDocumentation
 */

// Mode Configuration Types
export type { ACPModeConfig } from "../types/middleware.js";
// MCP Tool Loader (re-exported from utils for convenience)
export type {
	MCPClient,
	MCPToolLoadOptions,
	MCPToolServerConfig,
	MCPToolServerMap,
	MCPTransportType,
} from "../utils/mcpToolLoader.js";
export {
	createMCPClient,
	defaultMCPClientFactory,
	loadMCPServer,
	loadMCPTools,
} from "../utils/mcpToolLoader.js";
// Mode Middleware
export type {
	ACPModeMiddlewareConfig,
	ACPModeMiddlewareResult,
} from "./createACPModeMiddleware.js";
export {
	createACPModeMiddleware,
	STANDARD_MODES,
} from "./createACPModeMiddleware.js";
// Permission Middleware
export type {
	ACPPermissionMiddlewareConfig,
	RequestPermissionOutcome,
	SelectedPermissionOutcome,
} from "./createACPPermissionMiddleware.js";
export { createACPPermissionMiddleware } from "./createACPPermissionMiddleware.js";
// Session Middleware
export type {
	ACPSessionMiddlewareConfig,
	ACPSessionMiddlewareResult,
} from "./createACPSessionMiddleware.js";
export { createACPSessionMiddleware } from "./createACPSessionMiddleware.js";
// Tool Middleware
export type { ACPToolMiddlewareConfig } from "./createACPToolMiddleware.js";
export {
	createACPToolMiddleware,
	mapToolKind,
} from "./createACPToolMiddleware.js";
