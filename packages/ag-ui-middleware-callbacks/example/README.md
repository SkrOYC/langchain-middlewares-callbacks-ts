# AG-UI Middleware Callbacks Examples

## Status

This directory now mirrors the frozen backend-adapter package contract:

- `server.ts`: default backend example using
  `createAGUIBackend(...).handle(request)`
- `verify.ts`: CLI verifier that streams and validates the same backend handler
- `custom-host.ts`: advanced host example using publisher + middleware +
  callback primitives directly

The examples intentionally avoid `createAGUIAgent` and internal `../src/*`
imports in example code.

## Prerequisites

- **Bun** 1.3+
- Optional: an OpenAI-compatible API key and base URL if you want to switch the
  GUI from the built-in mock model to a live provider

## Quick Start

```bash
cd packages/ag-ui-middleware-callbacks/example

bun install

# Verify the default backend contract from the CLI
bun run verify

# Use the bundled OpenRouter template for live testing
# (Bun auto-loads .env)
cp .env.example .env

# Verify both handlers against a deterministic OpenAI-compatible mock
bun run verify:llmock

# Inspect live LangChain contentBlocks and then verify AG-UI output
bun run probe

# Capture a strict Responses API / v1 fixture for offline replay tests
bun run capture-fixture

# Start the default backend GUI
bun run dev
```

Then open http://localhost:3000 in your browser.

The default GUI runs against the same `/chat` backend handler that the CLI
verifier exercises.

## Default Backend Example

- Uses `@skroyc/ag-ui-middleware-callbacks/backend`
- Accepts strict AG-UI `RunAgentInput`
- Streams one canonical AG-UI event per SSE frame
- Defaults to a local mock model so verification works without external secrets
- Can switch to a live OpenAI-compatible endpoint from the GUI or env vars
- Supports explicit Responses API / output-version selection for stricter
  LangChain message testing

Relevant env vars for `verify.ts`:

- `EXAMPLE_PROVIDER=mock|openai-compatible`
- `EXAMPLE_BASE_URL=https://api.openai.com/v1`
- `EXAMPLE_API_KEY=...`
- `EXAMPLE_MODEL=gpt-4.1-mini`
- `EXAMPLE_USE_RESPONSES_API=true|false`
- `EXAMPLE_OUTPUT_VERSION=v0|v1`

`verify.ts` now validates each emitted event with `@ag-ui/core` `EventSchemas`
in addition to lifecycle ordering.

`probe.ts` is the live inspection tool. It streams the LangChain model directly,
prints only non-empty chunks, and fails if standardized `contentBlocks`
reasoning does not appear before standardized text. After the direct probe, it
runs the same AG-UI verifier against the selected handler.

`capture-fixture.ts` saves the direct LangChain chat-model stream to
`tests/fixtures/langchain` so callback replay tests can validate the strict
Responses API / `v1` `contentBlocks` path without calling a live provider every
run.

For a live OpenRouter setup, see `example/.env.example`. It is preconfigured to
use `nvidia/nemotron-3-super-120b-a12b:free`, which is the free model/profile
verified here for the full strict lifecycle: reasoning markers,
`contentBlocks` `v1`, tool-call streaming, tool result follow-up, and terminal
`RUN_FINISHED`.

## Deterministic OpenAI-Compatible Verification

- Uses `@copilotkit/llmock` as a real HTTP server, so the example still goes
  through LangChain's `ChatOpenAI`
- Forces the model name to `big-pickle`
- Validates every emitted event against AG-UI runtime schemas
- Exercises both `server.ts` and `custom-host.ts`
- Reports whether a tool-call trace emitted `TOOL_CALL_ARGS` and whether an
  assistant message completed with no text deltas

Run it with:

```bash
bun run verify:llmock
```

This is the recommended regression check when you want deterministic traces
without depending on external rate limits.

## Advanced Custom Host Example

- Uses `@skroyc/ag-ui-middleware-callbacks/publication`,
  `/middleware`, and `/callbacks` directly
- Demonstrates a host-owned concern outside the package: header auth via
  `x-example-key`
- Keeps the run publisher as the single semantic writer

Start it with:

```bash
bun run custom-host

# Or verify it directly
bun run verify:custom-host
```

The custom-host verifier automatically sends the default auth token
`demo-secret`. Override it with `EXAMPLE_AUTH_TOKEN` if needed.

## Notes

- The GUI is intentionally simple; it exists to show the backend-adapter path,
  not to be a production UI.
- The CLI is the primary contract check: it prints streamed events and fails if
  the lifecycle ordering is wrong.
- The live probe is stricter about reasoning: if a provider does not surface
  standardized LangChain `contentBlocks` for reasoning, the probe fails instead
  of silently falling back to provider-native payloads.
- Some OpenRouter models advertise reasoning + tools but still reject the
  second `function_call_output` request on the Responses API. That is a
  provider/model capability issue, not an AG-UI event translation issue.
