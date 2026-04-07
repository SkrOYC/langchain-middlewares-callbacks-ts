# Changelog

## 2.0.0 (2026-04-06)

### Breaking Changes

- **`onEvent` renamed to `publish`** in both `createAGUIMiddleware()` options and `AGUICallbackHandler` constructor. All consumers must update the property name.
- **`emitToolResults` removed from middleware options.** Use `callbackOptions.emitToolResults` on the adapter config, or pass it directly to `AGUICallbackHandler`.
- **`maxUIPayloadSize` and `chunkLargeResults` removed from middleware options.** These are `AGUICallbackHandler`-only options — pass them via `callbackOptions` on the adapter config, or directly to the callback handler constructor.
- **`createAGUIAgent()` removed.** This convenience wrapper around LangChain's `createAgent()` has been replaced by the adapter pattern (`createAGUIAdapter` / `createAGUIBackend`). Consumers that need direct control should compose `createAGUIMiddleware` + `AGUICallbackHandler` themselves.
- **Sourcemaps no longer included** in the published package.

### New Features

- **Adapter layer** (`./adapter` subpath): `createAGUIAdapter()` orchestrates middleware, callbacks, and publisher into a single `stream()` call that returns `AsyncIterable<BaseEvent>`.
- **Backend layer** (`./backend` subpath): `createAGUIBackend()` wraps the adapter with HTTP request handling (POST validation, SSE response).
- **Publication layer** (`./publication` subpath): `createAGUIRunPublisher()` manages event lifecycle ordering, open-stream tracking, and terminal event guarantees. Includes `serializeEventAsSSE()` and `createSSEStream()` helpers.
- **Thinking/Reasoning events**: Full support for `THINKING_*` and `REASONING_*` event families via LangChain V1 `contentBlocks` API. Both batch (from `handleLLMEnd`) and streaming (from `handleLLMNewToken`) paths supported.
- **Reasoning migration mode**: `reasoningEventMode` option on `AGUICallbackHandler` — set to `"reasoning"` for the new `REASONING_*` events, or `"thinking"` (default) for backward-compatible `THINKING_*` events.
- **Structured message fidelity**: `MESSAGES_SNAPSHOT` now preserves structured content blocks and tool calls.
- **Subpath exports**: Package exposes `./adapter`, `./backend`, `./callbacks`, `./middleware`, and `./publication` as explicit entry points.

### Fixes

- Runtime context IDs (`run_id`, `thread_id`) from LangChain runtime are now correctly resolved for AG-UI lifecycle correlation.
- `emitStateSnapshots` mode contract enforced — duplicate `STATE_SNAPSHOT` emissions eliminated.
- Deterministic message IDs derived from resolved run ID for consistent cross-layer correlation.

### Migration from 1.0.x

```typescript
// Before (1.0.x)
import { createAGUIMiddleware, AGUICallbackHandler } from "@skroyc/ag-ui-middleware-callbacks";

createAGUIMiddleware({
  onEvent: emit,
  emitToolResults: false,
  maxUIPayloadSize: 50 * 1024,
});

new AGUICallbackHandler({ onEvent: emit });

// After (2.0.0)
import { createAGUIMiddleware, AGUICallbackHandler } from "@skroyc/ag-ui-middleware-callbacks";

createAGUIMiddleware({
  publish: emit,
});

new AGUICallbackHandler({
  publish: emit,
  emitToolResults: false,
  maxUIPayloadSize: 50 * 1024,
});
```

### Internal

- `@ag-ui/core` updated to `^0.0.47`.
- Dead code removed (`createAGUIAgent`, associated integration tests).

## 1.0.2 (2026-01-22)

### Fixes

- Fixed `toolCallId` consistency across AG-UI tool events.

## 1.0.1 (2026-01-21)

### Changes

- Updated `@ag-ui/core` to `0.0.43` and configured `langchain` as peer dependency.

## 1.0.0 (2026-01-20)

### Breaking Changes

- **Scope Clarification**: Package now focuses exclusively on intercepting LangChain execution and emitting AG-UI events as JavaScript objects. All transport/wire-formatting concerns removed.
- **Removed Exports**: `createSSETransport`, `createProtobufTransport`, and all transport-related types.
- **Removed Dependencies**: `@ag-ui/proto`

## 0.1.2 (2026-01-15)

### Documentation

- Updated README.md and SPEC.md with accurate implementation details.

## 0.1.1 (2026-01-07)

### Fixes

- Fixed package.json configuration for npm publishing.

## 0.1.0 (2026-01-07)

### Features

- Initial release of @skroyc/ag-ui-middleware-callbacks.
