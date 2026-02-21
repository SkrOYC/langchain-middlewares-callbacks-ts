# Type Error Remediation Plan

## Goal

Bring `bun run typecheck` to zero errors with minimal behavioral risk and clear checkpoints.

## Current Baseline

- Total errors: 481
- `src/` errors: 3
- `tests/` and fixtures/mocks errors: 478
- Main drift source: LangChain v1 API/type contract changes

## Guiding Principles

- Fix production source type contracts first, then test scaffolding.
- Align with official LangChain v1 middleware/runtime contracts before local workarounds.
- Prefer shared typed test factories over ad-hoc inline mocks.
- Keep each phase independently verifiable with a measurable error delta.

## Phase 0: Baseline and Triage Lock

1. Regenerate typecheck log and snapshot top error codes/files.
2. Group errors into buckets:
   - middleware request/hook signatures
   - schema/runtime type mismatches
   - VectorStore mocks
   - Embeddings mocks
   - BaseStore mocks
   - legacy exports/usages (`SerializedMessage`, etc.)
3. Capture baseline counts per bucket in a tracking section below.

## Phase 1: Dependency/Type Identity Alignment

1. Eliminate duplicate `@langchain/langgraph` type identities in the workspace dependency graph.
2. Reinstall/refresh lock state so `langchain` and direct imports resolve to one compatible `@langchain/langgraph`.
3. Re-run typecheck and confirm `stateSchema` identity mismatch is resolved or isolated.

## Phase 2: Production Source Contract Fixes (`src/`)

1. `wrapModelCall`:
   - Replace custom request interface with LangChain `ModelRequest`-compatible typing.
   - Ensure handler/request include required fields (`model`, `tools`, etc.).
2. `afterModel` state update:
   - Return `_gradientAccumulator` with the declared schema type (not `samples` array).
3. Stored message validation:
   - Align local `StoredMessage` schema and transforms with current `@langchain/core` definitions.
4. Run `bun run typecheck` and `bun run test` after each source fix.

## Phase 3: Shared Typed Test Factories

Create reusable fixtures under `tests/helpers` (or `tests/fixtures`) for:

1. `BaseStore` mock implementing required methods (`get`, `put`, `delete`, `batch`, `search`, `listNamespaces`, `start`, `stop`).
2. `VectorStoreInterface` mock implementing required shape (`FilterType`, `embeddings`, `_vectorstoreType`, `addVectors`, `similaritySearchVectorWithScore`, etc.).
3. Embeddings mock compatible with expected type (`embedQuery`, `embedDocuments`, required fields like `caller` if needed by type).
4. Hook invocation helpers to handle union hook types (function vs `{ hook, canJumpTo }`).

## Phase 4: Test and Fixture Migration

1. Replace inline outdated mocks with shared factories.
2. Remove/replace legacy API usage:
   - `embedDocument` -> `embedDocuments`
   - stale `SerializedMessage` imports/usages
   - direct callable assumptions for middleware hooks
3. Update integration tests to match current config/runtime contracts (`context`, runtime store usage, etc.).
4. Keep edits incremental by directory:
   - `tests/fixtures/*`
   - `tests/helpers/*`
   - `tests/unit/middleware/*`
   - remaining unit/integration tests

## Phase 5: Error-Class Burn Down

Address remaining errors by code, in this order:

1. TS2322 / TS2345 (core contract incompatibilities)
2. TS2740 / TS2741 / TS2739 (incomplete interface mocks)
3. TS2305 / TS2339 (removed or renamed exports/members)
4. TS2532 / TS18048 (strict null/undefined in tests)
5. residual low-count codes

## Phase 6: Verification and Stability Gates

1. Required gates:
   - `bun run typecheck` passes
   - `bun run test` passes
   - `bun run check` passes
2. Spot-check runtime behavior for middleware hooks with representative integration tests.
3. Confirm no unintended public API regressions in `src/index.ts` exports.

## Tracking Template

Use this table during execution:

| Checkpoint | Total Errors | src Errors | tests Errors | Notes |
| --- | ---: | ---: | ---: | --- |
| Baseline | 481 | 3 | 478 | Initial snapshot |
| After Phase 1 | 481 | 3 | 478 | No dependency identity blocker remained after lock/install validation |
| After Phase 2 | 112 | 0 | 112 | Source contracts aligned; remaining errors isolated to tests/mocks |
| After Phase 3 | 112 | 0 | 112 | Existing shared fixtures reused; no new workaround helpers introduced |
| After Phase 4 | 0 | 0 | 0 | Test fixtures and hook invocations fully migrated to current contracts |
| Final | 0 | 0 | 0 | All gates green |

## Verification Results

- `bun run typecheck`: pass
- `bun run test`: pass (634 passing, 0 failing)
- `bun run check`: pass

## Definition of Done

- `bun run typecheck` returns exit code 0.
- All existing tests pass without weakening compiler strictness.
- LangChain middleware/state/runtime typings in `src/` match documented v1 contracts.
- Test mocks are centralized and future-proof against minor interface additions.
