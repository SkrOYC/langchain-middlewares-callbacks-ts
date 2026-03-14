# Verification Audit

This document re-validates the `Verification` epic in [Tasks.md](./Tasks.md)
against the current package implementation and test suite.

Audit date: 2026-03-13

## External contract checks

- LangChain middleware is attached when `createAgent(...)` is constructed, not
  injected later at `handle(request)` time.
- AG-UI backend servers accept `RunAgentInput` and stream lifecycle/content
  events over SSE.

These checks are consistent with the implemented `agentFactory({ input,
middleware })` backend contract in source and README.

## Requirement Traceability

| Task | Acceptance criteria | Evidence | Status |
|------|---------------------|----------|--------|
| `Q-1` | `RUN_STARTED` appears before any text or tool event | `tests/unit/publication/create-agui-run-publisher.test.ts` buffers observation events until `RUN_STARTED` | Covered |
| `Q-1` | Terminal completion or error behavior is deterministic | `tests/unit/publication/create-agui-run-publisher.test.ts` finalizes open streams before `RUN_FINISHED`, ignores post-terminal events, and exercises `close()` | Covered |
| `Q-1` | Degraded-fidelity publication never fabricates deltas | `tests/unit/publication/create-agui-run-publisher.test.ts` allows final-only tool results without inventing tool lifecycle events | Covered |
| `Q-2` | Concurrent runs do not share terminal state | `tests/unit/publication/create-agui-run-publisher.test.ts` isolates terminal state across concurrent publishers | Covered |
| `Q-2` | Concurrent runs do not share producer state | `tests/unit/middleware/create-agui-middleware.test.ts` contains concurrency-isolation coverage for middleware run state | Covered |
| `Q-3` | Valid HTTP request returns streamed SSE response | `tests/unit/backend/create-agui-backend.test.ts` returns SSE responses with canonical lifecycle events | Covered |
| `Q-3` | Request parsing is strict | `tests/unit/backend/create-agui-backend.test.ts` rejects non-`POST`, non-JSON, and invalid `RunAgentInput` payloads before streaming | Covered |
| `Q-3` | Event sequence is AG-UI-compatible | `tests/unit/backend/create-agui-backend.test.ts` verifies lifecycle order and one-event-per-frame SSE output | Covered |
| `Q-3` | Disconnect and post-start failure behavior follows contract | `tests/unit/backend/create-agui-backend.test.ts` emits `RUN_ERROR` for post-start failures and closes aborted runs without inventing semantic events | Covered |

## Outcome

- `Q-1` through `Q-3` are verified by the current test suite.
- The only code gap found during this audit was missing explicit backend coverage
  for unsupported non-JSON request bodies; that test is now present.
- Planning/spec docs are aligned with the implemented
  `agentFactory({ input, middleware })` backend shape, and the example surface
  has been rebaselined onto the backend-adapter contract.
