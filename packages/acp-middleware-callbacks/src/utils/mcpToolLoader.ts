/**
 * MCP Tool Loader
 *
 * Loads tools from MCP (Model Context Protocol) servers using @langchain/mcp-adapters.
 * Provides dynamic tool loading capabilities for LangChain agents.
 *
 * @packageDocumentation
 */

import type { StructuredTool } from "@langchain/core/tools";

/**
 * Transport type for MCP server connections.
 */
export type MCPTransportType = "stdio" | "http" | "websocket";

/**
 * Configuration for a single MCP server.
 */
export interface MCPToolServerConfig {
	/**
	 * Transport type for the MCP server connection.
	 * @default "stdio"
	 */
	transport?: MCPTransportType;

	/**
	 * Command to execute the MCP server.
	 * Used for stdio transport.
	 */
	command?: string;

	/**
	 * Arguments to pass to the MCP server command.
	 * Used for stdio transport.
	 */
	args?: string[];

	/**
	 * URL for HTTP/WebSocket transport connections.
	 */
	url?: string;

	/**
	 * Headers for HTTP/WebSocket transport connections.
	 */
	headers?: Record<string, string>;

	/**
	 * Restart configuration for the MCP server.
	 */
	restart?: {
		/**
		 * Whether automatic restart is enabled.
		 * @default false
		 */
		enabled?: boolean;

		/**
		 * Maximum number of restart attempts.
		 * @default 3
		 */
		maxAttempts?: number;

		/**
		 * Delay in milliseconds between restart attempts.
		 * @default 1000
		 */
		delayMs?: number;
	};

	/**
	 * Environment variables to pass to the MCP server.
	 */
	env?: Record<string, string>;
}

/**
 * Configuration for MCP server connections.
 * Maps server names to their configurations.
 */
export interface MCPToolServerMap {
	[serverName: string]: MCPToolServerConfig;
}

/**
 * Options for MCP tool integration.
 */
export interface MCPToolLoadOptions {
	/**
	 * Whether to prefix tool names with the server name.
	 * @default true
	 */
	prefixToolNameWithServerName?: boolean;

	/**
	 * Additional prefix to add to all MCP tool names.
	 * @default "mcp"
	 */
	additionalToolNamePrefix?: string;

	/**
	 * Custom name override for a specific server.
	 */
	serverNameOverride?: Record<string, string>;
}

/**
 * MCP Client interface for managing server connections.
 */
export interface MCPClient {
	/**
	 * Gets the list of tools from all connected MCP servers.
	 * @returns Promise resolving to array of StructuredTool objects
	 */
	getTools(): Promise<StructuredTool[]>;

	/**
	 * Closes all server connections and cleans up resources.
	 * @returns Promise resolving when cleanup is complete
	 */
	disconnect(): Promise<void>;

	/**
	 * Gets the list of connected server names.
	 * @returns Array of server names
	 */
	getServerNames(): string[];
}

/**
 * Internal interface for MultiServerMCPClient from @langchain/mcp-adapters.
 * This is used to avoid direct dependency on the internal class.
 */
interface MultiServerMCPClientInterface {
	getTools(): Promise<StructuredTool[]>;
	close(): Promise<void>;
	getServerNames(): string[];
}

/**
 * Creates an MCP client for managing multiple MCP server connections.
 *
 * @param servers - Map of server names to their configurations
 * @returns Promise resolving to MCPClient instance
 *
 * @example
 * ```typescript
 * const client = await createMCPClient({
 *   filesystem: {
 *     transport: "stdio",
 *     command: "npx",
 *     args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
 *   },
 *   math: {
 *     transport: "stdio",
 *     command: "npx",
 *     args: ["-y", "@modelcontextprotocol/server-math"],
 *   },
 * });
 *
 * const tools = await client.getTools();
 * await client.disconnect();
 * ```
 */
export async function createMCPClient(
	servers: MCPToolServerMap,
): Promise<MCPClient> {
	// Dynamic import to avoid bundling @langchain/mcp-adapters if not used
	const MultiServerMCPClient = (await import("@langchain/mcp-adapters"))
		.MultiServerMCPClient as unknown;

	// Convert our config format to MultiServerMCPClient format
	const mcpServers: Record<
		string,
		{
			command?: string;
			args?: string[];
			url?: string;
			headers?: Record<string, string>;
			restart?: {
				enabled: boolean;
				maxAttempts?: number;
				delayMs?: number;
			};
			env?: Record<string, string>;
		}
	> = {};

	for (const [name, config] of Object.entries(servers)) {
		mcpServers[name] = {
			command: config.command,
			args: config.args,
			url: config.url,
			headers: config.headers,
			restart: config.restart
				? {
						enabled: config.restart.enabled ?? false,
						maxAttempts: config.restart.maxAttempts,
						delayMs: config.restart.delayMs,
					}
				: undefined,
			env: config.env,
		};
	}

	const client = new MultiServerMCPClient({
		mcpServers,
	}) as unknown as MultiServerMCPClientInterface;

	// Get server names from our config since MultiServerMCPClient may not expose this
	const serverNames = Object.keys(servers);

	return {
		async getTools(): Promise<StructuredTool[]> {
			return client.getTools();
		},

		async disconnect(): Promise<void> {
			await client.close();
		},

		getServerNames(): string[] {
			return serverNames;
		},
	};
}

/**
 * Loads tools from MCP servers and returns them as LangChain StructuredTool objects.
 *
 * This is a convenience function that creates a client, loads tools, and disconnects.
 * For scenarios where you need to keep the connection open, use createMCPClient instead.
 *
 * @param servers - Map of server names to their configurations
 * @param options - Options for tool integration
 * @returns Promise resolving to array of StructuredTool objects
 *
 * @example
 * ```typescript
 * const tools = await loadMCPTools({
 *   filesystem: {
 *     transport: "stdio",
 *     command: "npx",
 *     args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
 *   },
 * }, {
 *   prefixToolNameWithServerName: true,
 *   additionalToolNamePrefix: "mcp",
 * });
 *
 * // Tools will have names like: "mcp__filesystem__read_file"
 * ```
 */
export async function loadMCPTools(
	servers: MCPToolServerMap,
	options?: MCPToolLoadOptions,
): Promise<StructuredTool[]> {
	const client = await createMCPClient(servers);

	try {
		const tools = await client.getTools();

		// Apply name prefixing if specified
		if (options?.prefixToolNameWithServerName !== false) {
			const prefix = options?.additionalToolNamePrefix ?? "mcp";
			const serverNames = client.getServerNames();

			// Create a mapping of original names to prefixed names
			for (const tool of tools) {
				const toolName = tool.name;

				// Check if tool name already has the prefix
				if (toolName.includes("__")) {
					continue; // Already prefixed
				}

				// Find which server this tool belongs to
				for (const serverName of serverNames) {
					const overrideName = options?.serverNameOverride?.[serverName];
					const serverPrefix = overrideName ?? serverName;

					// Rename the tool with the prefix
					if (toolName.startsWith(serverPrefix) || serverNames.length === 1) {
						const prefixedName = `${prefix}__${serverPrefix}__${toolName}`;
						(tool as { name?: string }).name = prefixedName;
						break;
					}
				}
			}
		}

		return tools;
	} finally {
		await client.disconnect();
	}
}

/**
 * Loads tools from a single MCP server.
 *
 * @param serverConfig - Configuration for the MCP server
 * @param serverName - Name to identify this server (used for tool prefixing)
 * @param options - Options for tool integration
 * @returns Promise resolving to array of StructuredTool objects
 *
 * @example
 * ```typescript
 * const tools = await loadMCPServer({
 *   transport: "stdio",
 *   command: "npx",
 *   args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
 * }, "filesystem");
 * ```
 */
export async function loadMCPServer(
	serverConfig: MCPToolServerConfig,
	serverName: string = "server",
	options?: MCPToolLoadOptions,
): Promise<StructuredTool[]> {
	return loadMCPTools({ [serverName]: serverConfig }, options);
}

/**
 * Type for a function that creates an MCP client.
 * Useful for dependency injection and testing.
 */
export type MCPClientFactory = (
	servers: MCPToolServerMap,
) => Promise<MCPClient>;

/**
 * Default MCP client factory.
 */
export const defaultMCPClientFactory: MCPClientFactory = createMCPClient;
