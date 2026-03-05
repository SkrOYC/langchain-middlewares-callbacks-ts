# TSK-001: LangChain Middleware Signature Matrix

## Verification Inputs

- Installed package metadata
  - `langchain`: `1.2.16`
  - `@langchain/core`: `1.1.29`
- Installed typings (source of truth)
  - `../../node_modules/langchain/dist/agents/middleware.d.ts`
  - `../../node_modules/langchain/dist/agents/middleware/types.d.ts`
  - `../../node_modules/@langchain/core/dist/messages/index.d.ts`
- External API reference
  - Librarian (`langchain-javascript`) query for middleware v1 signatures and ToolMessage usage

## Verified Signature Matrix

| API | Verified Signature | Typings Evidence |
| --- | --- | --- |
| `createMiddleware` | `createMiddleware<TSchema, TContextSchema, TTools>(config: { name: string; stateSchema?; contextSchema?; tools?; wrapToolCall?; wrapModelCall?; beforeAgent?; beforeModel?; afterModel?; afterAgent? }): AgentMiddleware<...>` | `../../node_modules/langchain/dist/agents/middleware.d.ts:60` |
| `beforeModel` | `BeforeModelHook = BeforeModelHandler | { hook; canJumpTo? }` where `BeforeModelHandler = (state, runtime) => PromiseOrValue<MiddlewareResult<Partial<state>>>` | `../../node_modules/langchain/dist/agents/middleware/types.d.ts:168` |
| `wrapToolCall` | `WrapToolCallHook = (request, handler) => PromiseOrValue<ToolMessage | Command>` | `../../node_modules/langchain/dist/agents/middleware/types.d.ts:112` |
| `ToolCallHandler` | `ToolCallHandler = (request: ToolCallRequest) => PromiseOrValue<ToolMessage | Command>` | `../../node_modules/langchain/dist/agents/middleware/types.d.ts:107` |
| `ToolCallRequest` | Contains `toolCall`, `tool`, `state`, `runtime` (`tool` may be `undefined`) | `../../node_modules/langchain/dist/agents/middleware/types.d.ts:68` |
| `ToolMessage` import | `ToolMessage` is exported from `@langchain/core/messages` | `../../node_modules/@langchain/core/dist/messages/index.d.ts:15` |

## Mismatch Log Captured During TSK-001

1. `wrapToolCall` pass-through call (**resolved in TechSpec**)
   - Original TechSpec pseudo-code used `return handler();`.
   - Reconciled TechSpec now uses `handler(request)`.

2. `wrapToolCall` return type (**intentional project constraint**)
   - Verified type allows `ToolMessage | Command`.
   - Project contract intentionally restricts behavior to graceful `ToolMessage` returns and no filesystem state-channel mutation.

3. `ToolCallRequest.tool` optionality (**implementation note**)
   - Verified type allows `tool` to be `undefined` for dynamic tools.
   - Middleware implementation must not assume `request.tool` is always present.

## Implementation Decision for Epic 1+

- Use the verified v1 middleware signatures from installed typings.
- Keep project behavior aligned with TechSpec acceptance (graceful `ToolMessage` boundary handling), while preserving type-correct `wrapToolCall` handler invocation (`handler(request)`).
