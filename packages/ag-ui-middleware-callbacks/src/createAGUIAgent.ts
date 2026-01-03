/**
 * AG-UI Agent Factory
 * 
 * Creates a LangChain agent with automatic AG-UI protocol integration.
 * 
 * Architecture (SPEC.md Section 2.7):
 * - Uses createAgent() from langchain package
 * - Passes callbacks at runtime via the invoke/stream methods
 * - Wraps the agent to auto-inject AG-UI callbacks
 */

import { createAgent, type AgentExecutor } from "langchain";
import { AGUICallbackHandler } from "./callbacks/AGUICallbackHandler";
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
}

/**
 * Create an AG-UI enabled agent.
 * 
 * This function creates a LangChain agent with automatic AG-UI protocol integration:
 * - Middleware handles lifecycle events (RUN_STARTED, RUN_FINISHED, etc.)
 * - Callbacks handle streaming events (TEXT_MESSAGE_CONTENT, TOOL_CALL_ARGS, etc.)
 * - Returns a wrapped agent that automatically injects AG-UI callbacks
 * 
 * @param config - Agent configuration
 * @returns An agent executor with AG-UI protocol support
 */
export function createAGUIAgent(config: AGUIAgentConfig) {
  // Create middleware with transport
  const middleware = createAGUIMiddleware({
    transport: config.transport,
    ...config.middlewareOptions,
  });

  // Create callbacks for streaming events
  const aguiCallbacks = [new AGUICallbackHandler(config.transport)];

  // Create base agent with middleware
  const agent = createAgent({
    model: config.model,
    tools: config.tools,
    middleware: [middleware],
  });

  // Return a wrapper that auto-injects AG-UI callbacks
  return {
    invoke: async (input: any, options?: any) => {
      return agent.invoke(input, {
        ...options,
        callbacks: [...(options?.callbacks || []), ...aguiCallbacks],
      });
    },
    stream: async (input: any, options?: any) => {
      return agent.stream(input, {
        ...options,
        callbacks: [...(options?.callbacks || []), ...aguiCallbacks],
      });
    },
  };
}
