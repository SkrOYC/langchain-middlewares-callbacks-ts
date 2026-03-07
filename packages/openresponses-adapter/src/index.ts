/**
 * OpenResponses Adapter for LangChain Agents
 *
 * A spec-minimal / acceptance-suite-targeted MVP adapter that exposes
 * an Open Responses API surface over an existing LangChain createAgent() runtime.
 *
 * @packageDocumentation
 */

// Re-export core types and schemas
export * from "./core/types.js";
export * from "./core/schemas.js";
export * from "./core/events.js";
export * from "./core/errors.js";

// Re-export testing utilities
export * from "./testing/index.js";

// Re-export public factory signatures
export type {
	PreviousResponseStore,
	OpenResponsesHandlerOptions,
	OpenResponsesCompatibleAgent,
} from "./core/factory.js";

export {
	createOpenResponsesHandler,
	createOpenResponsesAdapter,
	buildOpenResponsesApp,
} from "./server/index.js";
