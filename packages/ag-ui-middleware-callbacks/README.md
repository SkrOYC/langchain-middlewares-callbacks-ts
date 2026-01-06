# ag-ui-middleware-callbacks

LangChain.js integration providing both middleware and callbacks for AG-UI protocol compatibility.

## Installation

To install dependencies:

```bash
bun install
```

## Usage

To run:

```bash
bun run index.ts
```

## Overview

This package provides a comprehensive solution for making LangChain.js agents fully compatible with any AG-UI protocol frontend. It offers:

- **Middleware**: Lifecycle and state management (beforeAgent, afterAgent, state snapshots)
- **Callbacks**: Streaming events (TEXT_MESSAGE_CONTENT, TOOL_CALL_ARGS, tool lifecycle)

For complete specifications and implementation details, see [SPEC.md](./SPEC.md).

## Streaming Events

For streaming events (TEXT_MESSAGE_CONTENT, TOOL_CALL_ARGS), callbacks must be passed at runtime:

```typescript
import { AGUICallbackHandler } from "ag-ui-middleware-callbacks";

const eventStream = await agent.streamEvents(
  { messages },
  {
    version: "v2",
    callbacks: [new AGUICallbackHandler(transport)]  // REQUIRED for streaming
  }
);

for await (const event of eventStream) {
  // Handle events
}
```

Note: The AGUICallbackHandler must be passed at runtime for streaming events to work correctly. See SPEC.md for details.

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
