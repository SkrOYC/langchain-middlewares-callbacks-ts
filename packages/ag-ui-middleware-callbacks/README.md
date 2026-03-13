# @skroyc/ag-ui-middleware-callbacks

Low-level AG-UI producer primitives for LangChain.js.

## Status

The first contract-freeze epic is complete in docs. The frozen target package
shape is recorded in [docs/ContractFreeze.md](./docs/ContractFreeze.md).

Current implementation status:

- published runtime surface: low-level middleware and callback producers
- frozen future surface: backend adapter plus run-scoped publisher
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
import { createAGUIMiddleware } from "@skroyc/ag-ui-middleware-callbacks/middleware";
```

The root export remains intentionally minimal:

```ts
import {
	AGUICallbackHandler,
	createAGUIMiddleware,
} from "@skroyc/ag-ui-middleware-callbacks";
```

## Current Scope

This package currently ships producer primitives that emit AG-UI-compatible
event objects:

- `createAGUIMiddleware(...)` for lifecycle, state, and activity signals
- `AGUICallbackHandler` for text, tool, and reasoning observations

The batteries-included backend path defined in the contract freeze doc is not
implemented yet.

## Low-Level Example

```ts
import { AGUICallbackHandler } from "@skroyc/ag-ui-middleware-callbacks/callbacks";
import { createAGUIMiddleware } from "@skroyc/ag-ui-middleware-callbacks/middleware";

const publish = (event: unknown) => {
	console.log(event);
};

const middleware = createAGUIMiddleware({
	onEvent: publish,
	emitStateSnapshots: "initial",
	errorDetailLevel: "message",
});

const callbacks = [
	new AGUICallbackHandler({
		onEvent: publish,
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
- The audited demo in [`example/`](./example) still reflects the pre-backend
  wiring model and is not the frozen MVP public API.
