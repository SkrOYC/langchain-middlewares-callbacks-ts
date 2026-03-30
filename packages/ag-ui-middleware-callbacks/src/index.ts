/**
 * Minimal root exports for the AG-UI LangChain package.
 *
 * The package now ships adapter-first public subpaths such as `./adapter`,
 * `./backend`, and `./publication`, but the root entry stays intentionally
 * small and keeps exposing only the low-level producer primitives.
 *
 * Use explicit subpath imports for builder-facing integration surfaces.
 *
 * @packageDocumentation
 */

export { AGUICallbackHandler } from "./callbacks/agui-callback-handler";
export { createAGUIMiddleware } from "./middleware/create-agui-middleware";
