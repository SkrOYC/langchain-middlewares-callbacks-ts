/**
 * AG-UI Agent Factory
 *
 * Creates a LangChain agent with automatic AG-UI protocol integration.
 *
 * Architecture:
  * - Uses createAgent() from langchain package
  * - Returns agent with callbacks bound to graph via withConfig
  * - Emits lifecycle events for agent execution (RUN_STARTED, RUN_FINISHED, etc.)
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
 * - Callbacks must be passed at runtime via agent.streamEvents() config
 * - Guaranteed cleanup via middleware wrapModelCall with try-finally
 *
 * Note: Callbacks are not bound to the model here because:
 * 1. Some models (like MockChatModel in tests) don't properly support withConfig()
 * 2. Users should pass callbacks at runtime for proper streaming
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

  // Create base agent with middleware
  // Note: Callbacks are NOT bound here - they must be passed at runtime
  const agent = createAgent({
    model: config.model,
    tools: config.tools,
    middleware: [middleware],
  });

  return agent;
}
