# @skroyc/ag-ui-middleware-callbacks

AG-UI backend and producer primitives for LangChain.js.

## Status

The first contract-freeze epic is complete in docs. The frozen target package
shape is recorded in [docs/ContractFreeze.md](./docs/ContractFreeze.md).

Current implementation status:

- published runtime surface: backend adapter, run-scoped publisher, and
  low-level producers
- validated example set: CLI verifier plus GUI-backed default backend example
  and advanced custom-host example under `example/`
- `createAGUIAgent`: still present in source for transition work, but no longer
  treated as public package API

## Install

```bash
bun install @skroyc/ag-ui-middleware-callbacks
```

## Public Imports

Prefer explicit subpath imports:

```ts
import { AGUICallbackHandler } from "@skroyc/ag-ui-middleware-callbacks/callbacks";
import { createAGUIBackend } from "@skroyc/ag-ui-middleware-callbacks/backend";
import { createAGUIMiddleware } from "@skroyc/ag-ui-middleware-callbacks/middleware";
import { createAGUIRunPublisher } from "@skroyc/ag-ui-middleware-callbacks/publication";
```

The root export remains intentionally minimal:

```ts
import {
	AGUICallbackHandler,
	createAGUIMiddleware,
} from "@skroyc/ag-ui-middleware-callbacks";
```

## Default Backend Path

Use the backend subpath for the batteries-included serving path:

```ts
import { createAgent } from "langchain";
import { createAGUIBackend } from "@skroyc/ag-ui-middleware-callbacks/backend";

const backend = createAGUIBackend({
  agentFactory: ({ middleware }) =>
    createAgent({
      model,
      tools,
      middleware: [middleware],
    }),
});

export function handle(request: Request) {
  return backend.handle(request);
}
```

`handle(request)` expects a strict AG-UI `RunAgentInput` JSON payload and
returns a streamed `text/event-stream` response.

## Low-Level Example

```ts
import { AGUICallbackHandler } from "@skroyc/ag-ui-middleware-callbacks/callbacks";
import { createAGUIMiddleware } from "@skroyc/ag-ui-middleware-callbacks/middleware";

const publish = (event: unknown) => {
	console.log(event);
};

const middleware = createAGUIMiddleware({
	publish,
	emitStateSnapshots: "initial",
	errorDetailLevel: "message",
});

const callbacks = [
	new AGUICallbackHandler({
		publish,
		reasoningEventMode: "reasoning",
	}),
];
```

## Notes

- Reasoning events can be emitted as legacy `THINKING_*` or newer
  `REASONING_*` families.
- Thinking/reasoning content is derived from LangChain content blocks after the
  response is available; callback-only concurrent reasoning streaming is not
  currently possible.
- The backend contract is `agentFactory({ input, middleware })`, not the older
  frozen `{ agent }` shape. This is intentional because LangChain middleware is
  attached at agent construction time.
