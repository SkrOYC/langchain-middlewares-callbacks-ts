/**
 * AG-UI Middleware & Callbacks for LangChain.js
 * 
 * This package provides middleware and callbacks that make LangChain agents
 * compatible with the AG-UI protocol for real-time agent-to-UI communication.
 * 
 * Package scope: Intercept LangChain execution and emit AG-UI events as JavaScript objects.
 * Developer responsibility: Wire formatting (SSE, Protobuf), HTTP/server setup, client communication.
 * 
 * @packageDocumentation
 */

// Factory functions
export { createAGUIMiddleware } from "./middleware/createAGUIMiddleware";
export { createAGUIAgent } from "./createAGUIAgent";

// Callback handler
export { AGUICallbackHandler } from "./callbacks/AGUICallbackHandler";