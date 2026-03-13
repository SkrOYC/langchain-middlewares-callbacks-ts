/**
 * AG-UI low-level producer exports for LangChain.js.
 *
 * The first contract-freeze epic keeps the published runtime surface honest:
 * this root entry currently exposes only the existing low-level producer APIs.
 * The frozen backend-adapter contract lives in `docs/ContractFreeze.md` and
 * will be implemented in later epics.
 *
 * Package scope today: producer primitives only.
 *
 * @packageDocumentation
 */

export { AGUICallbackHandler } from "./callbacks/agui-callback-handler";
export { createAGUIMiddleware } from "./middleware/create-agui-middleware";
