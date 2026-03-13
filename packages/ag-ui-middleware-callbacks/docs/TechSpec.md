# TechSpec.md - Technical Specification

## @skroyc/ag-ui-middleware-callbacks

---

## 0. Scope and Technical Direction

This document defines the **target architecture** for the package after the current event-emitter design is evolved into a backend adapter.

The package will support two usage tiers:

1. **High-level backend path**
   A batteries-included backend adapter for AG-UI-compatible serving.
2. **Low-level bridge path**
   Direct access to middleware, callbacks, and publication primitives for advanced hosts.

The technical design keeps AG-UI transport-agnostic in principle while still shipping a default server path in practice.

---

## 1. Stack Specification

### 1.1 Runtime and Language

| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Bun / Node.js | bun >=1.0.0 / node >=20.0.0 |
| Language | TypeScript | 5.x |
| Build | tsup | 8.x |
| Output | ESM + CJS + type declarations | - |

### 1.2 Dependencies

| Package | Purpose | Type |
|---------|---------|------|
| `@ag-ui/core` | AG-UI event and schema types | Dependency |
| `@langchain/core` | Callback abstractions | Dependency |
| `langchain` | `createAgent()` runtime | Peer |
| `zod` | Config validation | Dependency |
| `fast-json-patch` | State delta computation | Dependency |

### 1.3 Runtime Neutrality

Shared modules must prefer Web Platform primitives:

- `Request`
- `Response`
- `Headers`
- `ReadableStream`
- `AbortSignal`
- `crypto.randomUUID()`

Do not require Node-only serving code in core publication modules.

---

## 2. Architecture Decision Records

### ADR-001: Product Shape Becomes Backend Adapter

**Context**

The original design centered on emitting event objects via `onEvent`. That is insufficient for the desired plug-and-play backend outcome.

**Decision**

Redefine the package as an AG-UI backend adapter for LangChain `createAgent()`.

**Consequences**

- the package now owns a default serving path
- the package still exposes low-level bridge components
- documentation and task planning must prioritize publication and serving over minor event gaps

### ADR-002: Middleware Is Control, Not Transport

**Context**

Middleware sees lifecycle, state, and policy, but not token chunks.

**Decision**

Use middleware only as a control producer.

**Consequences**

- middleware emits structural runtime facts
- middleware does not directly write public AG-UI events to transport

### ADR-003: Callbacks Are Observation, Not Publication

**Context**

Callbacks observe tokens and tool events, but they do not by themselves define trustworthy public protocol behavior.

**Decision**

Use callbacks only as observation producers.

**Consequences**

- callbacks provide rich runtime signals
- callbacks do not own ordering, termination, or transport

### ADR-004: Single Writer Per Run

**Context**

Mixing middleware and callback output directly into a socket or `onEvent` sink creates race conditions and leaky semantics.

**Decision**

Introduce a run-scoped publication layer with one canonical writer.

**Consequences**

- all public events are emitted through one queue/publisher
- ordering and terminal behavior become deterministic
- concurrent run safety becomes tractable

### ADR-005: Default SSE Path, Extensible Transport Model

**Context**

AG-UI is transport-agnostic, but the package goal is plug-and-play backend integration.

**Decision**

Ship SSE as the default serving transport and keep publication reusable for future binary or WebSocket helpers.

**Consequences**

- simplest deployment path is covered
- transport-specific framing remains separate from publication logic

---

## 3. Public API Contracts

### 3.1 High-Level Backend API

```typescript
interface AGUIBackend {
  handle(request: Request): Promise<Response>;
}

interface AGUIBackendConfig {
  agent: ReturnType<typeof createAgent>;
  validateEvents?: boolean | "strict";
  emitStateSnapshots?: "initial" | "final" | "all" | "none";
  emitActivities?: boolean;
  errorDetailLevel?: "full" | "message" | "code" | "none";
}

declare function createAGUIBackend(
  config: AGUIBackendConfig,
): AGUIBackend;
```

**Notes**

- `handle(request)` is the batteries-included path.
- The request body is expected to be AG-UI-compatible run input.
- The response is a streamed AG-UI-compatible HTTP response, defaulting to SSE.

### 3.2 Publication Layer API

```typescript
interface AGUIRunPublisher {
  publish(event: BaseEvent): void;
  error(error: unknown): void;
  complete(): void;
  toReadableStream(): ReadableStream<Uint8Array>;
}

interface AGUIRunPublisherConfig {
  validateEvents?: boolean | "strict";
  serializer?: AGUIEventSerializer;
  transport?: "sse";
}

declare function createAGUIRunPublisher(
  config?: AGUIRunPublisherConfig,
): AGUIRunPublisher;
```

**Notes**

- This is the single writer for one run.
- Middleware and callbacks publish into this component instead of directly to transport.

### 3.3 Control Layer API

```typescript
interface AGUIMiddlewareOptions {
  publish: (event: BaseEvent) => void;
  emitStateSnapshots?: "initial" | "final" | "all" | "none";
  emitActivities?: boolean;
  threadIdOverride?: string;
  runIdOverride?: string;
  errorDetailLevel?: "full" | "message" | "code" | "none";
  stateMapper?: (state: unknown) => unknown;
  activityMapper?: (activity: unknown) => unknown;
}

declare function createAGUIMiddleware(
  options: AGUIMiddlewareOptions,
): ReturnType<typeof createMiddleware>;
```

**Notes**

- The control layer API changes from `onEvent` semantics to `publish` semantics.
- The middleware remains a producer, not a server writer.

### 3.4 Observation Layer API

```typescript
interface AGUICallbackHandlerOptions {
  publish: (event: BaseEvent) => void;
  emitTextMessages?: boolean;
  emitToolCalls?: boolean;
  emitToolResults?: boolean;
  emitThinking?: boolean;
  reasoningEventMode?: "thinking" | "reasoning";
}

declare class AGUICallbackHandler extends BaseCallbackHandler {
  constructor(options: AGUICallbackHandlerOptions);
  dispose(): void;
}
```

**Notes**

- The callback handler remains available as a low-level export.
- It must never write directly to an HTTP response.

### 3.5 Public Surface Decisions

The frozen MVP package surface is:

- `createAGUIBackend`
- `createAGUIRunPublisher`
- `createAGUIMiddleware`
- `AGUICallbackHandler`

`createAGUIAgent` is not part of the MVP public contract. It may remain in the
source tree temporarily during implementation, but docs and package exports
should not preserve it as a published API.

---

## 4. Event Publication Rules

### 4.1 Producer Mapping

| Producer | Event Families |
|----------|----------------|
| Middleware | `RUN_*`, `STEP_*`, `STATE_*`, `MESSAGES_SNAPSHOT`, `ACTIVITY_*` |
| Callbacks | `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `REASONING_*`, runtime errors |
| Publisher | terminal coordination, validation, ordering, serialization |

### 4.2 Truthfulness Rules

1. Do not invent token deltas when none were observed.
2. Do not invent tool argument chunks when none were observed.
3. Allow degraded publication from chunked events to final-only events when upstream fidelity is lower.
4. Validate public events before they reach transport when validation is enabled.

### 4.3 Ordering Rules

1. All public events for one run flow through one publisher.
2. `RUN_STARTED` must appear before any text or tool event for that run.
3. `RUN_FINISHED` or `RUN_ERROR` must be the final semantic lifecycle event.
4. Serving must flush and close only after publication has finalized.

---

## 5. Request and Serving Semantics

### 5.1 Request Entry

- Request body: AG-UI-compatible run input
- Method: `POST`
- Content type: `application/json`
- Response type: `text/event-stream` by default

### 5.2 Serving Responsibilities

The serving layer must:

- parse request JSON
- create a run-scoped publisher
- invoke the LangChain runtime with control and observation producers
- stream canonical events to the client
- propagate `AbortSignal` from client disconnect to execution

### 5.3 Transport Responsibilities

The SSE helper must:

- serialize each public event as one SSE frame
- flush progressively
- close safely on success, failure, or disconnect

The transport helper must not:

- decide event ordering
- generate semantic events independently of the publisher

---

## 6. Internal Module Structure

```text
src/
├── backend/
│   ├── createAGUIBackend.ts      # High-level backend factory
│   └── requestHandler.ts         # Request -> Response serving path
├── publication/
│   ├── createAGUIRunPublisher.ts # Single writer per run
│   ├── serializer.ts             # BaseEvent -> framed output
│   └── ordering.ts               # Ordering and terminal coordination
├── transports/
│   └── sse.ts                    # Default SSE writer
├── middleware/
│   ├── create-agui-middleware.ts   # Control producer
│   ├── id-resolution.ts
│   └── types.ts
├── callbacks/
│   └── agui-callback-handler.ts    # Observation producer
├── utils/
│   ├── cleaner.ts
│   ├── id-generator.ts
│   ├── message-mapper.ts
│   ├── reasoning-blocks.ts
│   ├── state-diff.ts
│   └── validation.ts
├── backend.ts                    # Package entry for ./backend
├── publication.ts                # Package entry for ./publication
├── callbacks.ts                  # Package entry for ./callbacks
├── middleware.ts                 # Package entry for ./middleware
└── index.ts                      # Minimal root entry
```

---

## 7. Testing Requirements

### 7.1 Publication Tests

- canonical ordering across middleware and callback producers
- truthful degraded fidelity behavior
- duplicate suppression
- terminal completion and failure semantics

### 7.2 Serving Tests

- `POST` request returns streamed SSE response
- disconnect aborts upstream work
- post-start failures close the stream safely

### 7.3 Concurrency Tests

- simultaneous runs do not share message IDs, step state, or terminal state
- middleware state does not leak between runs

### 7.4 Compatibility Tests

- low-level producer exports continue to work for advanced users
- package exports do not leak `createAGUIAgent` as a public API

---

## 8. Technical Debt To Retire

The following current-state properties are no longer acceptable in the target design:

- direct `onEvent` sinks as the only public integration contract
- shared middleware closure state for run-scoped publication data
- callback-led assumptions about public stream completeness
- docs that define transport as purely the caller's burden
