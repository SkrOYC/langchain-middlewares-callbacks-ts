# `@skroyc/openresponses-adapter`

Spec-minimal Open Responses adapter for existing LangChain `createAgent()` runtimes.

It exposes a `POST /v1/responses` route, supports non-streaming JSON plus truthful SSE streaming, preserves `previous_response_id` replay semantics through a builder-controlled store, and keeps tool policy enforcement separate from protocol publication.

## Status

This package targets the MVP subset described in [`docs/TechSpec.md`](./docs/TechSpec.md), not full reference parity.

Implemented release-blocker capabilities:

- Non-streaming `application/json` responses
- Streaming `text/event-stream` responses with semantic events and literal `[DONE]`
- `previous_response_id` continuation through `PreviousResponseStore`
- Tool-calling normalization and enforcement
- Minimum `input_image` pass-through support
- Node and Bun smoke coverage

Deliberate boundaries:

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

const app = await buildOpenResponsesApp({
  agent,
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

- `buildOpenResponsesApp(options)`
- `createOpenResponsesHandler(options)`
- `createOpenResponsesAdapter(options)`
- `createOpenResponsesToolPolicyMiddleware()`
- `PreviousResponseStore`
- request, response, and stream event schemas/types

## Important Behavior

### Streaming truthfulness

Streaming output is derived from live LangChain callbacks observed during `agent.stream()`. The adapter does not replay the final answer as synthetic deltas.

If the runtime fails after headers are already sent, the stream emits `response.failed` and then terminates. If a strict persistence failure happens after stream completion, the stream closes without appending `[DONE]`.

### Tool policy enforcement

If you need execution-time enforcement for `tool_choice`, `allowed_tools`, or serialized tool calls, configure:

- `toolPolicySupport: "middleware"`
- `createOpenResponsesToolPolicyMiddleware()` on the agent runtime

Without that middleware, metadata-only tool policies still normalize, but enforcement-required modes are rejected.

### Continuation

`previous_response_id` requires a configured `PreviousResponseStore`. The adapter replays:

`previous input -> previous output -> new input`

exactly in that order.

### Image input

`input_image` is accepted and passed through as-is for MVP compliance coverage. The package does not fetch, proxy, transform, or store image binaries.

### Logging

The Hono boundary emits structured internal logs with:

- `request_id`
- `response_id`
- `path`
- `stream`
- `status_code`
- `error_code`
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
bun run smoke:node
bun run smoke:bun
```

## Compatibility Notes

- Shared modules stay on Web Platform primitives
- Bun is the default package manager and test runner
- The package is built as ESM + CJS

## Source References

- Open Responses specification: <https://openresponses.org/specification>
- Open Responses reference: <https://openresponses.org/reference>
- Hono streaming helper docs: <https://hono.dev/docs/helpers/streaming>
- LangChain callback handler reference: <https://reference.langchain.com/javascript/interfaces/_langchain_core.callbacks_base.CallbackHandlerMethods.html>
