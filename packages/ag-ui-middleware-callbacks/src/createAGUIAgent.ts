/**
 * AG-UI Agent Factory
 *
 * Creates a LangChain agent with automatic AG-UI protocol integration.
 *
 * Architecture:
 * - Uses createAgent() from langchain package
 * - Injects AG-UI callback handler per invocation
 * - Emits lifecycle events for agent execution (RUN_STARTED, RUN_FINISHED, etc.)
 * - Respects user runtime callbacks and avoids duplicate AG-UI handlers
 * - Abort signal from context enables client disconnect handling
 */

import { createAgent } from "langchain";
import {
	AGUICallbackHandler,
	type AGUICallbackHandlerOptions,
} from "./callbacks/AGUICallbackHandler";
import { type BaseEvent, EventType } from "./events";
import { createAGUIMiddleware } from "./middleware/createAGUIMiddleware";
import type { AGUIMiddlewareOptions } from "./middleware/types";

let hasWarnedEmitToolResultsDeprecation = false;
const AGUI_RUNTIME_WRAPPED = Symbol("agui-runtime-wrapped");

function isAGUICallbackHandler(callback: unknown): boolean {
	if (!callback || typeof callback !== "object") return false;
	const candidate = callback as { name?: unknown };
	return (
		callback instanceof AGUICallbackHandler || candidate.name === "ag-ui-callback"
	);
}

function withInjectedAGUICallback(
	runtimeOptions: any,
	createCallbackHandler: () => AGUICallbackHandler,
): any {
	const callbacks = runtimeOptions?.callbacks;

	// No runtime callbacks provided -> inject AG-UI callback.
	if (typeof callbacks === "undefined") {
		return {
			...(runtimeOptions ?? {}),
			callbacks: [createCallbackHandler()],
		};
	}

	// Runtime callback list provided. Avoid duplicates if AG-UI callback already exists.
	if (Array.isArray(callbacks)) {
		if (callbacks.some(isAGUICallbackHandler)) {
			return runtimeOptions;
		}
		return {
			...runtimeOptions,
			callbacks: [...callbacks, createCallbackHandler()],
		};
	}

	// Non-array callback manager provided: honor runtime callbacks as source of truth.
	return runtimeOptions;
}

function wrapAgentWithPerRunAGUICallback(
	agent: any,
	createCallbackHandler: () => AGUICallbackHandler,
): any {
	if (!agent || (agent as any)[AGUI_RUNTIME_WRAPPED]) {
		return agent;
	}

	Object.defineProperty(agent, AGUI_RUNTIME_WRAPPED, {
		value: true,
		enumerable: false,
		configurable: false,
		writable: false,
	});

	const originalInvoke =
		typeof agent.invoke === "function" ? agent.invoke.bind(agent) : undefined;
	if (originalInvoke) {
		agent.invoke = (input: any, options?: any) =>
			originalInvoke(
				input,
				withInjectedAGUICallback(options, createCallbackHandler),
			);
	}

	const originalStream =
		typeof agent.stream === "function" ? agent.stream.bind(agent) : undefined;
	if (originalStream) {
		agent.stream = (input: any, options?: any) =>
			originalStream(
				input,
				withInjectedAGUICallback(options, createCallbackHandler),
			);
	}

	const originalStreamEvents =
		typeof agent.streamEvents === "function"
			? agent.streamEvents.bind(agent)
			: undefined;
	if (originalStreamEvents) {
		agent.streamEvents = (input: any, options?: any) =>
			originalStreamEvents(
				input,
				withInjectedAGUICallback(options, createCallbackHandler),
			);
	}

	const originalWithConfig =
		typeof agent.withConfig === "function"
			? agent.withConfig.bind(agent)
			: undefined;
	if (originalWithConfig) {
		agent.withConfig = (config: any) =>
			wrapAgentWithPerRunAGUICallback(
				originalWithConfig(config),
				createCallbackHandler,
			);
	}

	const originalWithListeners =
		typeof agent.withListeners === "function"
			? agent.withListeners.bind(agent)
			: undefined;
	if (originalWithListeners) {
		agent.withListeners = (listeners: any) =>
			wrapAgentWithPerRunAGUICallback(
				originalWithListeners(listeners),
				createCallbackHandler,
			);
	}

	return agent;
}

/**
 * Configuration for creating an AG-UI enabled agent.
 */
export interface AGUIAgentConfig {
	/** The language model to use */
	model: any;
	/** The tools available to the agent */
	tools: any[];
	/** Callback function for AG-UI events */
	onEvent: (event: BaseEvent) => void;
	/** Optional middleware configuration */
	middlewareOptions?: Partial<AGUIMiddlewareOptions>;
	/** Optional callback handler configuration */
	callbackOptions?: Omit<AGUICallbackHandlerOptions, "onEvent">;
}

/**
 * Create an AG-UI enabled agent.
 *
 * This function creates a LangChain agent with automatic AG-UI protocol integration:
 * - Middleware handles lifecycle events (RUN_STARTED, RUN_FINISHED, etc.)
 * - Callbacks handle streaming events (TEXT_MESSAGE_CONTENT, TOOL_CALL_ARGS, etc.)
 * - Callback handler is injected per run to avoid shared mutable state
 * - Guaranteed cleanup via middleware wrapModelCall with try-finally
 *
 * @param config - Agent configuration
 * @returns An agent with AG-UI protocol support
 */
export function createAGUIAgent(config: AGUIAgentConfig) {
	const callbackEmitToolResults =
		config.callbackOptions?.emitToolResults ??
		config.middlewareOptions?.emitToolResults ??
		true;

	if (
		typeof config.middlewareOptions?.emitToolResults === "boolean" &&
		typeof config.callbackOptions?.emitToolResults === "undefined" &&
		!hasWarnedEmitToolResultsDeprecation
	) {
		hasWarnedEmitToolResultsDeprecation = true;
		console.warn(
			"[AG-UI] `middlewareOptions.emitToolResults` is deprecated. Use `callbackOptions.emitToolResults` instead.",
		);
	}

	const callbackDefaults: Omit<AGUICallbackHandlerOptions, "onEvent"> = {
		...config.callbackOptions,
		emitToolResults: callbackEmitToolResults,
	};

	const createCallbackHandler = () =>
		new AGUICallbackHandler({
			onEvent: config.onEvent,
			...callbackDefaults,
		});

	// Create middleware with callback
	const middleware = createAGUIMiddleware({
		onEvent: config.onEvent,
		emitToolResults: config.middlewareOptions?.emitToolResults ?? true,
		emitStateSnapshots:
			config.middlewareOptions?.emitStateSnapshots ?? "initial",
		emitActivities: config.middlewareOptions?.emitActivities ?? false,
		maxUIPayloadSize: config.middlewareOptions?.maxUIPayloadSize ?? 50 * 1024,
		chunkLargeResults: config.middlewareOptions?.chunkLargeResults ?? false,
		threadIdOverride: config.middlewareOptions?.threadIdOverride,
		runIdOverride: config.middlewareOptions?.runIdOverride,
		errorDetailLevel: config.middlewareOptions?.errorDetailLevel ?? "message",
		stateMapper: config.middlewareOptions?.stateMapper,
		resultMapper: config.middlewareOptions?.resultMapper,
		activityMapper: config.middlewareOptions?.activityMapper,
		validateEvents: config.middlewareOptions?.validateEvents ?? false,
	});

	// Create base agent with middleware
	// Note: Callbacks are NOT bound here - they must be passed at runtime
	const agent = createAgent({
		model: config.model,
		tools: config.tools,
		middleware: [middleware],
	});

	// Attach global listeners for guaranteed cleanup and error handling if supported
	const agentWithListeners =
		agent && typeof (agent as any).withListeners === "function"
			? (agent as any).withListeners({
					onError: (run: any) => {
						try {
							config.onEvent({
								type: EventType.RUN_ERROR,
								message:
									typeof run.error === "string"
										? run.error
										: (run.error as any)?.message ||
											"Agent execution failed",
								code: "AGENT_EXECUTION_ERROR",
								timestamp: Date.now(),
							} as BaseEvent);
						} catch {
							// Fail-safe
						}
					},
				})
			: agent;

	return wrapAgentWithPerRunAGUICallback(
		agentWithListeners,
		createCallbackHandler,
	);
}
