# `@skroyc/openresponses-adapter`

Open Responses adapter for existing LangChain `createAgent()` runtimes.

It exposes a `POST /v1/responses` route, preserves `previous_response_id` replay semantics through a builder-controlled store, keeps tool policy enforcement separate from protocol publication, and targets the pinned OpenResponses snapshot vendored in this package.

## Status

This package targets conformance with the pinned OpenResponses snapshot for the JSON request surface, uses the official OpenResponses CLI runner as a baseline release gate, and adds a package-owned spec-conformance suite for runner-uncovered behaviors. That suite also retains a small set of stricter package invariants where the pinned upstream wording is softer or leaves behavior unspecified.

Implemented release-blocker capabilities:

- Non-streaming full `ResponseResource` JSON responses
- Streaming `text/event-stream` responses with semantic events, full terminal response payloads, literal `[DONE]`, and post-start `error` events
- `previous_response_id` continuation through `PreviousResponseStore`
- Tool-calling normalization and enforcement
- `input_image` pass-through support
- Package-local regressions separated from the official black-box compliance runner
- Package-owned black-box spec-conformance checks for JSON-surface framing and runner gaps
- Node 24 and Bun built-package smoke coverage for root, `./server`, and `./testing` entrypoints

Deliberate boundaries:

- `application/json` is the only accepted request-body encoding in this package milestone, even though the upstream vendored OpenAPI currently advertises a broader request-body surface
- No broad multimodal output support
- No bundled durable persistence adapter
- No synthetic text or function-call deltas when callbacks are too weak to support them truthfully

## Install

```bash
bun add @skroyc/openresponses-adapter hono langchain @langchain/core zod
```

Peer dependencies are provided by the consuming app:

- `langchain`
- `@langchain/core`
- `typescript`

## Minimal Usage

```ts
import { serve } from "@hono/node-server";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import {
  buildOpenResponsesApp,
  createInMemoryPreviousResponseStore,
  createOpenResponsesToolPolicyMiddleware,
  type OpenResponsesCompatibleAgent,
} from "@skroyc/openresponses-adapter";

const getWeather = tool(
  async ({ city }) => JSON.stringify({ city, forecast: "sunny" }),
  {
    name: "get_weather",
    description: "Return a simple forecast for a city",
    schema: z.object({ city: z.string() }),
  }
);

const agent = createAgent({
  model: process.env.OPENRESPONSES_MODEL ?? "gpt-4.1-mini",
  tools: [getWeather],
  middleware: [createOpenResponsesToolPolicyMiddleware()],
});

const openResponsesAgent: OpenResponsesCompatibleAgent = {
  invoke(input, config) {
    return agent.invoke(input, config);
  },
  async *stream(input, config) {
    const stream = await agent.stream(input, config);
    for await (const chunk of stream) {
      yield chunk;
    }
  },
};

const app = await buildOpenResponsesApp({
  agent: openResponsesAgent,
  previousResponseStore: createInMemoryPreviousResponseStore(),
  toolPolicySupport: "middleware",
});

serve({
  fetch: app.fetch,
  port: 3000,
});
```

The route is available at `POST /v1/responses`.

## Public Surface

- Root entrypoint exports the main factories plus types and testing helpers
- `./server` exports `buildOpenResponsesApp()`, `createOpenResponsesHandler()`, and `createOpenResponsesAdapter()`
- `./testing` exports deterministic clocks, IDs, fake agents, and the in-memory `PreviousResponseStore`
- `createOpenResponsesToolPolicyMiddleware()`
- `PreviousResponseStore`
- request, response, and stream event schemas/types

## Important Behavior

### Streaming truthfulness

Streaming output is derived from live LangChain callbacks observed during `agent.stream()`. The adapter does not replay the final answer as synthetic deltas.

If the runtime fails after headers are already sent, the stream emits `error`, then `response.failed`, and then terminates. If a strict persistence failure happens after stream completion, the stream closes without appending `[DONE]`.

### Compliance and release gating

Local regression tests, the official runner, and the spec-conformance suite are intentionally separate:

- `bun run test:compliance:local` covers package-owned regression scenarios
- `bun run test:compliance:official` runs the vendored official OpenResponses CLI mirror against the built package
- `bun run test:compliance:spec` runs the package-owned black-box JSON-surface conformance suite against the built package
- `bun run test:compliance:full` runs the official runner and the package-owned conformance suite together
- `bun run test:compliance` remains an alias to the local regression suite for backwards compatibility

The package-owned suite intentionally includes a few stronger checks than the pinned upstream MUST-level wording, including omission of SSE `id` fields, monotonic built-in `sequence_number` progression, and package-specific HTTP/runtime error mappings where the upstream contract is silent.

### Tool policy enforcement

If you need execution-time enforcement for `tool_choice`, `allowed_tools`, or serialized tool calls, configure:

- `toolPolicySupport: "middleware"`
- `createOpenResponsesToolPolicyMiddleware()` on the agent runtime

Without that middleware, metadata-only tool policies still normalize, but enforcement-required modes are rejected.

### Continuation

`previous_response_id` requires a configured `PreviousResponseStore`. The adapter replays:

`previous input -> previous output -> new input`

exactly in that order.

### Item References

`item_reference` is accepted as a schema-valid input item and preserved in the normalized request snapshot. The package does not currently invent dereference or re-hydration behavior for it at the LangChain runtime boundary, because the pinned public contract exposes the type more clearly than it defines its execution semantics.

### Image input

`input_image` is accepted and passed through as-is. The package does not fetch, proxy, transform, or store image binaries.

### Logging

The Hono boundary emits structured internal logs with:

- `contract_snapshot_version`
- `request_id`
- `response_id`
- `path`
- `stream`
- `status_code`
- `error_code`
- `terminal_status`
- `failure_class`
- `duration_ms`

Token content, request bodies, tool inputs, and tool outputs are excluded by default.

## Examples

- Node example: [`examples/node.ts`](./examples/node.ts)
- Bun example: [`examples/bun.ts`](./examples/bun.ts)

## Package Scripts

```bash
bun run build
bun run typecheck
bun run lint
bun run test
bun run test:golden-stream
bun run test:compliance
bun run test:compliance:local
bun run test:compliance:official
bun run test:compliance:spec
bun run test:compliance:full
bun run smoke:node
bun run smoke:bun
```

## Compatibility Notes

- Shared modules stay on Web Platform primitives
- Bun is the default package manager and test runner
- The package is built as ESM + CJS and smoke-tested as a built package before release

## Source References

- Open Responses specification: <https://openresponses.org/specification>
- Open Responses reference: <https://openresponses.org/reference>
- Hono streaming helper docs: <https://hono.dev/docs/helpers/streaming>
- LangChain callback handler reference: <https://reference.langchain.com/javascript/interfaces/_langchain_core.callbacks_base.CallbackHandlerMethods.html>
