# Verification Audit

This document re-validates the `Verification` epic in [Tasks.md](./Tasks.md)
against the current package implementation and test suite.

Audit date: 2026-03-13

## External contract checks

- LangChain middleware is attached when `createAgent(...)` is constructed, not
  injected later at `handle(request)` time.
- The package now exposes a programmatic adapter surface that yields canonical
  `BaseEvent` objects before transport framing.
- AG-UI backend servers accept `RunAgentInput` and stream lifecycle/content
  events over SSE.

These checks are consistent with the implemented `agentFactory({ input,
middleware })` adapter and backend contracts in source and README.

## Requirement Traceability

| Task | Acceptance criteria | Evidence | Status |
|------|---------------------|----------|--------|
| `AGA-A001` | Adapter yields canonical events without HTTP concerns | `tests/unit/adapter/create-agui-adapter.test.ts` covers lifecycle ordering, input mapping, post-start errors, and abort-safe closure | Covered |
| `AGA-A002` | Backend remains a strict HTTP plus SSE wrapper over the adapter | `tests/unit/backend/create-agui-backend.test.ts` covers request validation, SSE framing, lifecycle order, and abort/error behavior | Covered |
| `AGA-A003` | Advanced host reuses adapter semantics instead of local orchestration | `example/custom-host.ts` now delegates to `createAGUIAdapter(...)`, and `example/verify.ts` passes for both default and custom-host modes with `EXAMPLE_PROVIDER=mock` | Covered |

## Outcome

- Epic A is verified by the current test suite plus the example verifiers.
- The package now has one shared non-HTTP orchestration path for backend and
  custom-host usage.
- Remaining verification work is the future adapter-first release matrix
  described in `AGA-D001`, not the adapter extraction itself.
