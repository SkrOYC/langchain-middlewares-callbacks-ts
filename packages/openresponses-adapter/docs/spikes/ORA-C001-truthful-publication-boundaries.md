# ORA-C001 Truthful Publication Boundaries

Date: 2026-03-25
Status: Verified

## Goal

Document which snapshot-required streaming families can be published live from the current LangChain callback surface, and which families must fall back to coarse-live or terminal-summary publication.

## Verified Observation Surfaces

- Raw model text is available from `handleLLMNewToken(token, ...)`.
- Structured live payloads are available only when LangChain passes a callback chunk. The adapter can inspect:
  - `fields.chunk.message.contentBlocks`
  - v1 `message.content`
  - `additional_kwargs`
  - tool-call chunk metadata
- Final structured truth is available from `handleLLMEnd(...)` and `handleAgentEnd(...)`.

## Publication Matrix

| Family | Preferred Mode | Allowed Fallbacks | Truth Source |
| --- | --- | --- | --- |
| `output_text` | `live-delta` | `coarse-live` | raw token deltas, finalized output text blocks |
| `function_call_arguments` | `live-delta` | `coarse-live` | tool-call chunks, agent action deltas, final observed arguments |
| `reasoning` | `live-delta` | `coarse-live`, `terminal-summary` | LangChain content blocks / v1 output, final structured message |
| `reasoning_summary` | `coarse-live` | `terminal-summary` | structured summary parts when present, otherwise final reasoning payload |
| `refusal` | `coarse-live` | `terminal-summary` | refusal blocks or `additional_kwargs.refusal` |
| `output_text.annotation` | `coarse-live` | `terminal-summary` | annotation arrays on observed output text blocks |

## Rules

- Never fabricate deltas for reasoning, refusal, annotations, or tool arguments.
- If a family is not exposed live, finish it from the final structured message instead of inventing stream history.
- `function_call_output` is an output-item family, not a specialized delta family. It is published truthfully only when tool output is actually observed.
