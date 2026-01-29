# Changelog

## [1.1.0] - 2026-01-28

### Features

- Added thinking/reasoning content blocks support via LangChain V1 contentBlocks API
- New `reasoningBlocks.ts` utility with `extractReasoningBlocks()`, `extractReasoningText()`, `groupReasoningBlocksByIndex()`
- Support for Anthropic `{ type: "thinking" }` blocks
- Support for Google `{ type: "thinking" }` blocks
- Support for OpenAI reasoning blocks
- Multiple reasoning phases (interleaved thinking) support via index-based grouping

### Breaking Changes

- Thinking events no longer include `messageId` (per AG-UI TypeScript SDK schema)
- Streaming-based reasoning detection (`additional_kwargs.reasoning_content`) is deprecated

### Changes

- Replaced streaming fallback with canonical contentBlocks API extraction
- Added `detectAndEmitThinking()` method to AGUICallbackHandler
- Removed `thinkingIds` map (no longer needed)
- Thinking events are now coupled with `emitTextMessages` flag

## [1.0.0] - 2026-01-20

### Breaking Changes

- **Scope Clarification**: Package now focuses exclusively on intercepting LangChain execution and emitting AG-UI events as JavaScript objects. All transport/wire-formatting concerns have been removed (developer responsibility).
- **Type Changes**: Removed custom event type definitions and re-exports. Use `@ag-ui/core` for event types directly.
- **Removed Exports**: `createSSETransport`, `createProtobufTransport`, `AGUITransport`, `ProtobufTransport`, `SSETransport`, `AGUI_MEDIA_TYPE`, `encodeEventWithFraming`, `decodeEventWithFraming`, `encodeProtobuf`, `decodeProtobuf`, `generateId`, `computeStateDelta`, `mapLangChainMessageToAGUI`, `cleanLangChainData`, `extractToolOutput`, `expandEvent`, `validateEvent`, `isValidEvent`, `createValidatingCallback`, `AGUIMiddlewareOptions`, `AGUIMiddlewareOptionsSchema`, `EventType`, `EventSchemas`, `ValidationResult`, `MessageSchema`, `ToolCallSchema`.
- **Removed Dependencies**: `@ag-ui/proto`
- **Version**: Bumped to 1.0.0

### Migration

```typescript
// Before
import { createSSETransport, EventType } from "@skroyc/ag-ui-middleware-callbacks"

// After
import { EventType } from "@ag-ui/core"
import { createAGUIAgent } from "@skroyc/ag-ui-middleware-callbacks"

// Implement transport yourself
for await (const event of agent.stream(input)) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)  // SSE
}
```

### Changes

- Removed `transports/` directory
- Removed `src/types/ag-ui.ts`
- Simplified `src/events/index.ts` to use @ag-ui/core types directly
- Updated `AGUICallbackHandler` to use callback pattern instead of transport
- Updated `createAGUIMiddleware` to use callback pattern instead of transport
- Updated `createAGUIAgent` to use callback pattern instead of transport

## 0.1.2 (2026-01-15)

### Documentation
- Updated README.md to be more concise and aligned with implementation
- Updated SPEC.md with accurate implementation details
- Added TOOL_CALL_START and TOOL_CALL_END to event tables
- Clarified callback binding behavior in createAGUIAgent

### Fixes
- Fixed event source documentation (Middleware vs Callbacks)

## 0.1.1 (2026-01-07)

### Fixes
- Fixed package.json configuration for npm publishing
- Corrected repository.url to use git+https protocol
- Fixed types field to point to .d.mts file

## 0.1.0 (2026-01-07)

### Features
- Initial release of @skroyc/ag-ui-middleware-callbacks
- AG-UI protocol middleware integration for LangChain.js
- SSE and Protocol Buffer transports
- LangChain callbacks for streaming events
- Validation utilities using @ag-ui/core schemas
