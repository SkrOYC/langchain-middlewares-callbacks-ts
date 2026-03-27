# OpenResponses JSON-Surface Requirement Matrix

This matrix records the pinned OpenResponses requirements that this package
claims to satisfy for the JSON request surface. It separates the official
runner baseline from the package-owned spec-conformance suite so release claims
do not overfit the six upstream acceptance scenarios.

Scope notes:

- Contract snapshot: `2.3.0+0e3605e36180`
- In-scope transport: `application/json`
- Deferred by explicit scope: `application/x-www-form-urlencoded`
- Proof types:
  - `official_runner`: vendored upstream acceptance suite
  - `spec_conformance`: package-owned black-box HTTP proof
  - `shared`: covered by both

| ID | Source | Requirement | Proof Type | Proof Ref | Status |
| --- | --- | --- | --- | --- | --- |
| OR-HTTP-001 | specification | Non-streaming responses return `application/json` | shared | `basic-response`, `response-resource-complete` | covered |
| OR-HTTP-002 | specification | Streaming responses return `text/event-stream` | shared | `streaming-response`, `sse-framing-and-ordering` | covered |
| OR-HTTP-003 | specification | JSON is the in-scope request body encoding for this milestone | spec_conformance | `response-resource-complete`, `sse-framing-and-ordering` | covered |
| OR-HTTP-004 | reference/openapi | `application/x-www-form-urlencoded` is published upstream but deferred from this milestone by explicit scope | deferred_by_scope | user scope decision on 2026-03-26 | deferred |
| OR-RESP-001 | reference/openapi | Terminal JSON responses contain the full `ResponseResource` shape, including nullable/defaulted fields | shared | `basic-response`, `response-resource-complete` | covered |
| OR-STREAM-001 | specification | SSE `event` must match body `type` | spec_conformance | `sse-framing-and-ordering` | covered |
| OR-STREAM-002 | specification | SSE frames SHOULD NOT use the `id` field | spec_conformance | `sse-framing-and-ordering` | covered |
| OR-STREAM-003 | specification | Streaming terminates with literal `[DONE]` after the terminal event | shared | `streaming-response`, `sse-framing-and-ordering` | covered |
| OR-STREAM-004 | reference/openapi | Terminal stream events carry the full `ResponseResource` | shared | `streaming-response`, `sse-framing-and-ordering` | covered |
| OR-STREAM-005 | reference/openapi | Built-in streaming events carry integer `sequence_number` fields | spec_conformance | `sse-framing-and-ordering` | covered |
| OR-STREAM-006 | specification | The modeled stream lifecycle places `response.in_progress` before terminal `response.completed` / `response.failed` / `response.incomplete` states | spec_conformance | `sse-framing-and-ordering`, `post-start-failure` | covered |
| OR-STREAM-007 | specification + reference/openapi | Post-start failures emit an `error` event and resolve through terminal `response.failed` semantics | spec_conformance | `post-start-failure` | covered |
| OR-STREAM-008 | reference/openapi | Incomplete executions emit `response.incomplete` and terminal incomplete state | spec_conformance | `incomplete-terminal` | covered |
| OR-STREAM-009 | reference/openapi | Reasoning summary event families are emitted when reasoning summaries are present | spec_conformance | `reasoning-summary-coverage` | covered |
| OR-CONT-001 | specification | Continuation semantics are keyed by `previous_response_id` and replay prior input before prior output before new input | spec_conformance | `continuation-coverage` | covered |
| OR-TOOLS-001 | specification + reference/openapi | The JSON request surface accepts published tool-governance request shapes (`tool_choice`, specific function choice, `allowed_tools`) and preserves tool contract fields in public request/response semantics | spec_conformance | `tool-governance-coverage` | covered |

No in-scope JSON-surface requirement rows are intentionally left `partial`.
The only remaining non-covered row is `OR-HTTP-004`, which is explicitly
deferred by scope because this milestone is limited to `application/json`.

Notes on proof boundaries:

- The package-owned spec suite also verifies a few stricter package invariants
  that go beyond explicit upstream MUST-level wording for the pinned snapshot.
- These stricter checks currently include: omitting SSE `id` fields entirely,
  monotonically increasing built-in `sequence_number` values, and package
  policy choices for missing or unusable `previous_response_id` records and
  unmet required tool-call execution.
