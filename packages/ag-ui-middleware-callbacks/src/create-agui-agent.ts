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

import type { RunnableConfig } from "@langchain/core/runnables";
import { createAgent } from "langchain";
import {
  AGUICallbackHandler,
  type AGUICallbackHandlerOptions,
} from "./callbacks/agui-callback-handler";
import { type BaseEvent, EventType } from "./events";
import { createAGUIMiddleware } from "./middleware/create-agui-middleware";
import type { AGUIMiddlewareOptions } from "./middleware/types";

let hasWarnedEmitToolResultsDeprecation = false;
const AGUI_RUNTIME_WRAPPED = Symbol("agui-runtime-wrapped");
type CreateAgentParams = Parameters<typeof createAgent>[0];
type CreateAgentModel = CreateAgentParams["model"];
type CreateAgentTools = CreateAgentParams["tools"];
type RuntimeCallbacks = unknown[] | unknown;

interface RuntimeInvocationOptions extends Record<string, unknown> {
  callbacks?: RuntimeCallbacks;
}

interface AgentRunLike {
  error?: unknown;
}

interface AgentListeners extends Record<string, unknown> {
  onError?: (run: AgentRunLike) => void;
}

interface WrappedAgentLike {
  [AGUI_RUNTIME_WRAPPED]?: boolean;
  invoke?: (input: unknown, options?: RuntimeInvocationOptions) => unknown;
  stream?: (input: unknown, options?: RuntimeInvocationOptions) => unknown;
  streamEvents?: (
    input: unknown,
    options?: RuntimeInvocationOptions
  ) => unknown;
  withConfig?: (
    config: Omit<RunnableConfig, "store" | "writer" | "interrupt">
  ) => WrappedAgentLike;
  withListeners?: (listeners: AgentListeners) => WrappedAgentLike;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (typeof message === "string") {
      return message;
    }
  }

  return "Agent execution failed";
}

function isAGUICallbackHandler(callback: unknown): boolean {
  if (!callback || typeof callback !== "object") {
    return false;
  }

  const candidate = callback as { name?: unknown };
  return (
    callback instanceof AGUICallbackHandler ||
    candidate.name === "ag-ui-callback"
  );
}

function withInjectedAGUICallback(
  runtimeOptions: RuntimeInvocationOptions | undefined,
  createCallbackHandler: () => AGUICallbackHandler
): RuntimeInvocationOptions {
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
  agent: WrappedAgentLike,
  createCallbackHandler: () => AGUICallbackHandler
): WrappedAgentLike {
  if (agent[AGUI_RUNTIME_WRAPPED]) {
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
    agent.invoke = (input: unknown, options?: RuntimeInvocationOptions) =>
      originalInvoke(
        input,
        withInjectedAGUICallback(options, createCallbackHandler)
      );
  }

  const originalStream =
    typeof agent.stream === "function" ? agent.stream.bind(agent) : undefined;
  if (originalStream) {
    agent.stream = (input: unknown, options?: RuntimeInvocationOptions) =>
      originalStream(
        input,
        withInjectedAGUICallback(options, createCallbackHandler)
      );
  }

  const originalStreamEvents =
    typeof agent.streamEvents === "function"
      ? agent.streamEvents.bind(agent)
      : undefined;
  if (originalStreamEvents) {
    agent.streamEvents = (input: unknown, options?: RuntimeInvocationOptions) =>
      originalStreamEvents(
        input,
        withInjectedAGUICallback(options, createCallbackHandler)
      );
  }

  const originalWithConfig =
    typeof agent.withConfig === "function"
      ? agent.withConfig.bind(agent)
      : undefined;
  if (originalWithConfig) {
    agent.withConfig = (
      config: Omit<RunnableConfig, "store" | "writer" | "interrupt">
    ) =>
      wrapAgentWithPerRunAGUICallback(
        originalWithConfig(config),
        createCallbackHandler
      );
  }

  const originalWithListeners =
    typeof agent.withListeners === "function"
      ? agent.withListeners.bind(agent)
      : undefined;
  if (originalWithListeners) {
    agent.withListeners = (listeners: AgentListeners) =>
      wrapAgentWithPerRunAGUICallback(
        originalWithListeners(listeners),
        createCallbackHandler
      );
  }

  return agent;
}

/**
 * Configuration for creating an AG-UI enabled agent.
 */
export interface AGUIAgentConfig {
  /** The language model to use */
  model: CreateAgentModel;
  /** The tools available to the agent */
  tools: CreateAgentTools;
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
      "[AG-UI] `middlewareOptions.emitToolResults` is deprecated. Use `callbackOptions.emitToolResults` instead."
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
  const wrappableAgent = agent as WrappedAgentLike;

  // Attach global listeners for guaranteed cleanup and error handling if supported
  const agentWithListeners =
    typeof wrappableAgent.withListeners === "function"
      ? wrappableAgent.withListeners({
          onError: (run: AgentRunLike) => {
            try {
              config.onEvent({
                type: EventType.RUN_ERROR,
                message: getErrorMessage(run.error),
                code: "AGENT_EXECUTION_ERROR",
                timestamp: Date.now(),
              } as BaseEvent);
            } catch {
              // Fail-safe
            }
          },
        })
      : wrappableAgent;

  return wrapAgentWithPerRunAGUICallback(
    agentWithListeners,
    createCallbackHandler
  ) as ReturnType<typeof createAgent>;
}
