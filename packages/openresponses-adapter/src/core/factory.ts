/**
 * Public Factory Signatures
 *
 * Public API for creating Open Responses handlers and adapters.
 */

import type { Context, Env } from "hono";
import type { CallbackHandlerMethods } from "@langchain/core/callbacks/base";

import type {
	PreviousResponseStore,
	OpenResponsesHandlerOptions,
	OpenResponsesCompatibleAgent,
	StoredResponseRecord,
} from "./types.js";

import type { OpenResponsesRequest, OpenResponsesResponse, ErrorObject } from "./schemas.js";

import type { OpenResponsesEvent } from "./schemas.js";

// Re-export types for convenience
export type {
	PreviousResponseStore,
	OpenResponsesHandlerOptions,
	OpenResponsesCompatibleAgent,
	StoredResponseRecord,
};

/**
 * Creates an Open Responses handler for Hono.
 *
 * @param options - Handler configuration options
 * @returns Hono handler function
 */
export declare function createOpenResponsesHandler<E extends Env = Env>(
	options: OpenResponsesHandlerOptions
): (c: Context<E>) => Promise<Response>;

/**
 * Creates an Open Responses adapter without HTTP transport.
 *
 * Use this when you want to embed the adapter in your own server
 * or use it programmatically.
 *
 * @param options - Adapter configuration options
 * @returns Adapter with invoke and stream methods
 */
export interface OpenResponsesAdapter {
	/**
	 * Execute a non-streaming request.
	 *
	 * @param request - Open Responses request
	 * @param signal - Optional abort signal
	 * @returns Complete Open Responses response
	 */
	invoke(
		request: OpenResponsesRequest,
		signal?: AbortSignal
	): Promise<OpenResponsesResponse>;

	/**
	 * Execute a streaming request.
	 *
	 * @param request - Open Responses request
	 * @param signal - Optional abort signal
	 * @returns Async iterable of stream chunks
	 */
	stream(
		request: OpenResponsesRequest,
		signal?: AbortSignal
	): AsyncIterable<OpenResponsesEvent | "[DONE]">;
}

export declare function createOpenResponsesAdapter(
	options: OpenResponsesHandlerOptions
): OpenResponsesAdapter;

/**
 * Builds a complete Hono app with Open Responses route.
 *
 * @param options - Handler configuration options
 * @returns Configured Hono app
 */
export declare function buildOpenResponsesApp<E extends Env = Env>(
	options: OpenResponsesHandlerOptions
): Promise<{
	fetch(request: Request, env: E, ctx?: { waitUntil(promise: Promise<void>): void }): Promise<Response>;
}>;

// =============================================================================
// Callback Handler Type
// =============================================================================

/**
 * Type for LangChain callback handler methods that this adapter supports.
 * This is a subset of CallbackHandlerMethods focused on the methods we use.
 */
export type OpenResponsesCallbackHandler = Pick<
	CallbackHandlerMethods,
	| "handleChatModelStart"
	| "handleLLMNewToken"
	| "handleLLMEnd"
	| "handleLLMError"
	| "handleToolStart"
	| "handleToolEnd"
	| "handleToolError"
	| "handleAgentAction"
	| "handleAgentEnd"
	| "handleChainError"
>;
