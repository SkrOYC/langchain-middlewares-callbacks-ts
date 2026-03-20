/**
 * OpenResponses Adapter for LangChain Agents
 *
 * A spec-minimal / acceptance-suite-targeted MVP adapter that exposes
 * an Open Responses API surface over an existing LangChain createAgent() runtime.
 *
 * @packageDocumentation
 */

export * from "./callbacks/index.js";
export * from "./core/errors.js";
export * from "./core/events.js";
// Re-export public factory signatures
export type {
  OpenResponsesCompatibleAgent,
  OpenResponsesHandlerOptions,
  PreviousResponseStore,
} from "./core/factory.js";
export * from "./core/schemas.js";
// Re-export core types and schemas
export * from "./core/types.js";
export * from "./middleware/index.js";
export {
  buildOpenResponsesApp,
  createOpenResponsesAdapter,
  createOpenResponsesHandler,
} from "./server/index.js";
export * from "./state/index.js";
// Re-export testing utilities
export * from "./testing/index.js";
