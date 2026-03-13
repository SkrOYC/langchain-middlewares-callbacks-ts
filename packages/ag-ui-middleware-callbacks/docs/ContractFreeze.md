# Contract Freeze

This document is the authoritative outcome of the first epic in `docs/Tasks.md`
(`P-1` through `P-3`).

It freezes the intended MVP package surface and default serving contract without
pretending the later backend/publication implementation epics already exist.

## Package Contract

### Product shape

The package is being reshaped from a low-level AG-UI event sink into a
backend adapter for LangChain `createAgent()`.

The frozen MVP product surface is:

- High-level backend path:
  `createAGUIBackend(config).handle(request)`
- Low-level publication path:
  `createAGUIRunPublisher(config?)`
- Low-level producer path:
  `createAGUIMiddleware(options)` and `AGUICallbackHandler`

`createAGUIAgent` is **not part of the MVP public contract**. It may remain in
the source tree temporarily while the later implementation epics land, but it
is not a published API that new documentation or exports should preserve.

### Export strategy

The package contract is **subpath-oriented**. Prefer explicit subpath imports
over a root-first API.

Target MVP export map:

- `@skroyc/ag-ui-middleware-callbacks/backend`
- `@skroyc/ag-ui-middleware-callbacks/publication`
- `@skroyc/ag-ui-middleware-callbacks/middleware`
- `@skroyc/ag-ui-middleware-callbacks/callbacks`

Implementation rule:

- Do not use barrel files.
- Each published subpath must point at a concrete entry file.
- Future backend/publication entrypoints should be implemented as explicit
  `src/<subpath>.ts` files, not `index.ts` re-export trees.

### Distribution target

This package targets:

- ESM
- CJS
- Type declarations

This dual-format decision is intentional for this package even though earlier
repo guidance leaned ESM-first.

## Default Serving Contract

### Request

- Method: `POST`
- Request `Content-Type`: `application/json`
- Request body: strict AG-UI `RunAgentInput`
- Request validation: fail fast on incompatible payloads

`handle(request)` is not a permissive compatibility endpoint. It accepts a real
AG-UI request shape rather than a demo-local subset such as `messages` plus
ad hoc forwarded props.

### Response

- Response `Content-Type`: `text/event-stream`
- Transport: Server-Sent Events by default
- Framing rule: one canonical AG-UI event per SSE frame

### Terminal semantics

- `RUN_STARTED` must precede any text or tool event for the run.
- `RUN_FINISHED` or `RUN_ERROR` is the final semantic lifecycle event.
- If failure occurs after streaming starts and a semantic failure event can
  still be emitted safely, emit `RUN_ERROR` and then close.
- Client disconnect or abort must propagate into execution via `AbortSignal`.
- Disconnect must not cause invented semantic events. The stream closes safely
  after cancellation/finalization logic runs.

## README and Example Audit

### Stale assumptions identified during the audit

- The pre-freeze README described the package primarily as a low-level
  `onEvent` bridge.
- The pre-freeze README presented `createAGUIAgent` as a public entrypoint.
- The demo performs manual SSE writing in app code instead of using the future
  backend adapter contract.
- The demo accepts a permissive request body instead of strict `RunAgentInput`.

### Reusable behaviors

These parts are worth reusing in later epics:

- Bun `ReadableStream` response pattern for SSE delivery
- progressive `controller.enqueue(...)` writes
- safe `controller.close()` handling on success/failure
- the client-side expectation of streamed AG-UI lifecycle/text/tool events

### Behaviors to discard or replace

- direct transport publication from middleware/callbacks
- public `createAGUIAgent`-first onboarding
- ad hoc request parsing and normalization
- example code that implies the host owns canonical ordering/terminal semantics

## Current-State Note

This freeze is intentionally ahead of implementation. Until later epics land,
the published package may expose only the existing low-level primitives. The
backend/publication APIs defined here are the frozen target contract for the
next implementation steps.
