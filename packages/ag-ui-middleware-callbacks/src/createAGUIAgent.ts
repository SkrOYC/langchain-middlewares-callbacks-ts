/**
 * AG-UI Agent Factory
 *
 * Creates a LangChain agent with automatic AG-UI protocol integration.
 *
 * Architecture:
 * - Uses createAgent() from langchain package
 * - Returns agent with callbacks bound to graph via withConfig
 * - Guaranteed cleanup via middleware wrapModelCall with try-finally
 * - Callbacks are merged with user-provided callbacks by LangChain
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
 * - Uses agent.graph.withConfig to bind callbacks to agent's graph
 * - Guaranteed cleanup via middleware wrapModelCall with try-finally
 * - LangChain's config merging ensures user callbacks are preserved
 *
 * @param config - Agent configuration
 * @returns An agent with AG-UI protocol support
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

  // Bind callbacks to agent's graph using withConfig
  // This merges callbacks with any user-provided callbacks at runtime
  // Middleware's wrapModelCall handles guaranteed cleanup via try-finally
  return agent.graph.withConfig({ callbacks: aguiCallbacks });
}
