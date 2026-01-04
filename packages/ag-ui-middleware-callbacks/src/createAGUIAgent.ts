/**
 * AG-UI Agent Factory
 * 
 * Creates a LangChain agent with automatic AG-UI protocol integration.
 * 
 * Architecture:
 * - Uses createAgent() from langchain package
 * - Returns a wrapper that auto-injects AG-UI callbacks on all invocations
 * - Callbacks are merged with user-provided callbacks using LangChain's config merging
 * - Abort signal from context enables client disconnect handling
 */

import { createAgent } from "langchain";
import { AGUICallbackHandler, type AGUICallbackHandlerOptions } from "./callbacks/AGUICallbackHandler";
import { createAGUIMiddleware } from "./middleware/createAGUIMiddleware";
import type { AGUITransport } from "./transports/types";
import type { AGUIMiddlewareOptions } from "./middleware/types";

/**
 * Configuration for creating an AG-UI enabled agent.
 */
export interface AGUIAgentConfig {
  /** The language model to use */
  model: any;
  /** The tools available to the agent */
  tools: any[];
  /** The transport for AG-UI events */
  transport: AGUITransport;
  /** Optional middleware configuration */
  middlewareOptions?: Partial<AGUIMiddlewareOptions>;
  /** Optional callback handler configuration */
  callbackOptions?: AGUICallbackHandlerOptions;
}

/**
 * Create an AG-UI enabled agent.
 * 
 * This function creates a LangChain agent with automatic AG-UI protocol integration:
 * - Middleware handles lifecycle events (RUN_STARTED, RUN_FINISHED, etc.)
 * - Callbacks handle streaming events (TEXT_MESSAGE_CONTENT, TOOL_CALL_ARGS, etc.)
 * - Wrapper auto-injects AG-UI callbacks on all invocations
 * - LangChain's config merging ensures user callbacks are preserved
 * 
 * @param config - Agent configuration
 * @returns An agent wrapper with AG-UI protocol support
 */
export function createAGUIAgent(config: AGUIAgentConfig) {
  // Create middleware with transport
  const middleware = createAGUIMiddleware({
    transport: config.transport,
    emitToolResults: config.middlewareOptions?.emitToolResults ?? true,
    emitStateSnapshots: config.middlewareOptions?.emitStateSnapshots ?? "initial",
    emitActivities: config.middlewareOptions?.emitActivities ?? false,
    maxUIPayloadSize: config.middlewareOptions?.maxUIPayloadSize ?? 50 * 1024,
    chunkLargeResults: config.middlewareOptions?.chunkLargeResults ?? false,
    threadIdOverride: config.middlewareOptions?.threadIdOverride,
    runIdOverride: config.middlewareOptions?.runIdOverride,
    errorDetailLevel: config.middlewareOptions?.errorDetailLevel ?? "message",
  });

  // Create callbacks for streaming events with smart emission options
  const aguiCallbacks = [new AGUICallbackHandler(config.transport, config.callbackOptions)];

  // Create base agent with middleware
  const agent = createAgent({
    model: config.model,
    tools: config.tools,
    middleware: [middleware],
  });

  // Return a wrapper that auto-injects AG-UI callbacks on all invocations
  // LangChain's mergeConfigs ensures user callbacks are preserved
  return {
    invoke: async (input: any, options?: any) => {
      const originalCallbacks = [...(options?.callbacks || []), ...aguiCallbacks];
      return agent.invoke(input, {
        ...options,
        callbacks: originalCallbacks,
      });
    },
    stream: async (input: any, options?: any) => {
      const originalCallbacks = [...(options?.callbacks || []), ...aguiCallbacks];
      return agent.stream(input, {
        ...options,
        callbacks: originalCallbacks,
      });
    },
  };
}
