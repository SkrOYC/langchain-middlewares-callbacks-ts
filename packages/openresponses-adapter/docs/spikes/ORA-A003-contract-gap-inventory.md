# ORA-A003 Brownfield Contract And Observability Gap Inventory

Snapshot authority:

- Upstream repo: `openresponses/openresponses`
- Pinned commit: `0e3605e3618080ffc15b732d68dbe63fb3b1db73`
- Local snapshot version: `2.3.0+0e3605e36180`

Observed brownfield reality:

- The package ships a hand-written MVP subset in `src/core/internal-schemas.ts`.
- The public contract facade in `src/core/schemas.ts` is now snapshot-backed, but the runtime still materializes the MVP subset.
- Local `tests/compliance.spec.ts` still mirrors the older six-scenario subset and is not black-box contract proof.

## Request Fields

| Element | Current Brownfield Reality | Classification | Follow-on |
| --- | --- | --- | --- |
| `model`, `input`, `stream`, `tools`, `tool_choice`, `parallel_tool_calls`, `metadata`, `text`, `reasoning`, `temperature`, `top_p`, `max_output_tokens` | Validated in the MVP subset and used during normalization | implemented | `ORA-B001` |
| `previous_response_id` | Implemented for continuation replay | preserve | `ORA-B001` |
| `include`, `instructions`, `store`, `background`, `truncation`, `max_tool_calls`, `service_tier`, `safety_identifier`, `prompt_cache_key`, `top_logprobs`, `presence_penalty`, `frequency_penalty`, `stream_options` | Visible in the snapshot facade but not preserved end to end by normalization | preserve | `ORA-B001` |
| Structured assistant and developer history beyond MVP assumptions | Public schema accepts it; normalization still centers on the older subset | preserve | `ORA-B001` |

## Terminal Response Fields

| Element | Current Brownfield Reality | Classification | Follow-on |
| --- | --- | --- | --- |
| `id`, `object`, `created_at`, `completed_at`, `status`, `model`, `previous_response_id`, `output`, `error`, `metadata` | Emitted by the current materializers | implemented | `ORA-B002` |
| `incomplete_details`, `instructions`, `tools`, `tool_choice`, `truncation`, `parallel_tool_calls`, `text`, `top_p`, `presence_penalty`, `frequency_penalty`, `top_logprobs`, `temperature`, `reasoning`, `usage`, `max_output_tokens`, `max_tool_calls`, `store`, `background`, `service_tier`, `safety_identifier`, `prompt_cache_key` | Missing from the brownfield terminal resource | preserve / derive / default depending on field policy | `ORA-B002` |
| `usage` and token detail breakdowns | No canonical accounting source yet | derive | `ORA-B002` |
| Nullable/defaultable operational fields | Not emitted today even when the snapshot requires explicit presence | default | `ORA-B002` |

## Stored Record Shape

| Element | Current Brownfield Reality | Classification | Follow-on |
| --- | --- | --- | --- |
| `response_id`, timestamps, terminal status, MVP request snapshot, MVP response payload | Persisted today | implemented | `ORA-B003` |
| Full normalized request snapshot | Not persisted | preserve | `ORA-B003` |
| Full terminal `ResponseResource` | Not persisted | derive | `ORA-B003` |
| `contract_snapshot_version` | Not persisted | read-repair | `ORA-B003` |
| Older subset records | Replayable only if they already match the MVP shape | read-repair | `ORA-B003` |

## Output Item Families

| Family | Current Brownfield Reality | Classification | Follow-on |
| --- | --- | --- | --- |
| `message` | Implemented | implemented | `ORA-C002` |
| `function_call` | Implemented | implemented | `ORA-C002` |
| `function_call_output` | Public schema accepts it, runtime does not emit it in terminal response output | derive | `ORA-C002` |
| `reasoning` | Public schema accepts it, runtime does not emit it | terminal-summary | `ORA-C001` / `ORA-C002` |

## Streaming Event Families

| Family | Current Brownfield Reality | Classification | Follow-on |
| --- | --- | --- | --- |
| `response.in_progress`, `response.output_item.added`, `response.content_part.added`, `response.output_text.delta`, `response.output_text.done`, `response.content_part.done`, `response.output_item.done`, `response.function_call_arguments.delta`, `response.function_call_arguments.done` | Implemented in the MVP serializer | implemented | `ORA-C002` |
| `response.completed`, `response.failed` | Implemented with partial terminal response stubs | derive | `ORA-C003` |
| `response.created`, `response.queued`, `response.incomplete`, `error` | In snapshot facade only, not emitted by the serializer | derive | `ORA-C002` / `ORA-C003` |
| `response.refusal.*` | Not emitted | terminal-summary | `ORA-C001` / `ORA-C002` |
| `response.reasoning.*` | Not emitted | terminal-summary | `ORA-C001` / `ORA-C002` |
| `response.reasoning_summary_*` | Not emitted | terminal-summary | `ORA-C001` / `ORA-C002` |
| `response.output_text.annotation.added` | Not emitted | coarse-live | `ORA-C001` / `ORA-C002` |

## Official Harness Findings

The new `bun run test:compliance:official` harness is intentionally measuring mechanical black-box behavior before semantic parity:

- The fixture server should let all six official scenarios run against a live built package.
- Expected near-term failures are terminal `ResponseResource` completeness, terminal stream payload completeness, and broader event-family coverage.
- Those failures are now attributable to specific ORA-B and ORA-C tickets rather than missing local harness infrastructure.
