# ag-ui-middleware-callbacks

LangChain.js integration providing middleware and callbacks for AG-UI protocol compatibility.

## Package Scope

This package focuses exclusively on **intercepting LangChain execution and emitting AG-UI events as JavaScript objects**.

**Package responsibility:**
- Intercept LangChain execution via middleware + callbacks
- Emit AG-UI events as JavaScript objects (using `@ag-ui/core` types)

**Developer responsibility:**
- All HTTP/server setup
- Wire formatting (SSE framing, Protobuf framing)
- Content negotiation
- Client communication

## Installation

```bash
bun install ag-ui-middleware-callbacks
```

## Exports

### Factory Functions

| Function | Description |
|----------|-------------|
| `createAGUIAgent(config)` | Creates LangChain agent with AG-UI integration |
| `createAGUIMiddleware(options)` | Creates middleware for lifecycle events |

### Callback Handler

| Export | Description |
|--------|-------------|
| `AGUICallbackHandler` | Callback handler for streaming events |

## Quick Start

```typescript
import { createAGUIAgent, AGUICallbackHandler } from "ag-ui-middleware-callbacks";
import { EventType } from "@ag-ui/core";

// Create callback to handle events
const handleEvent = (event) => {
  console.log('AG-UI Event:', event.type, event);
};

// Create AG-UI enabled agent
const agent = createAGUIAgent({
  model,
  tools,
  onEvent: handleEvent,
});

// Stream events with callback handler
const eventStream = await agent.streamEvents(
  { messages },
  {
    version: "v2",
    callbacks: [new AGUICallbackHandler({ onEvent: handleEvent })]
  }
);

for await (const event of eventStream) {
  // Events automatically emitted via callback
}
```

## Middleware Configuration

```typescript
const middleware = createAGUIMiddleware({
  onEvent: (event) => console.log(event),
  emitToolResults: true,
  emitStateSnapshots: "initial",  // "initial" | "final" | "all" | "none"
  emitActivities: false,
  maxUIPayloadSize: 50 * 1024,
  chunkLargeResults: false,
  errorDetailLevel: "message",    // "full" | "message" | "code" | "none"
  validateEvents: false,           // true | "strict" | false
  stateMapper: (state) => state,
  resultMapper: (result) => result,
  activityMapper: (node) => node,
});
```

## Events

| Event | Source | Description |
|-------|--------|-------------|
| `RUN_STARTED` | Middleware | Agent execution started |
| `RUN_FINISHED` | Middleware | Agent execution completed |
| `RUN_ERROR` | Middleware | Agent execution failed |
| `STEP_STARTED` | Middleware | Model turn started |
| `STEP_FINISHED` | Middleware | Model turn completed |
| `TEXT_MESSAGE_START` | Callback | Text message streaming started |
| `TEXT_MESSAGE_CONTENT` | Callback | Text message chunk |
| `TEXT_MESSAGE_END` | Callback | Text message streaming ended |
| `TOOL_CALL_START` | Callback | Tool execution started |
| `TOOL_CALL_ARGS` | Callback | Tool call arguments chunk |
| `TOOL_CALL_END` | Callback | Tool execution ended |
| `TOOL_CALL_RESULT` | Callback | Tool execution result |
| `STATE_SNAPSHOT` | Middleware | State snapshot (after streaming) |
| `MESSAGES_SNAPSHOT` | Middleware | Messages snapshot |
| `ACTIVITY_SNAPSHOT` | Middleware | New activity detected |
| `ACTIVITY_DELTA` | Middleware | Activity update |

## Wire Formatting (Developer Responsibility)

Developers must implement their own transport/wire formatting:

### SSE Example

```typescript
const handleEvent = (event) => {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};
```

### Protobuf Example

```typescript
import { encode, decode } from "@ag-ui/proto";

const handleEvent = (event) => {
  const bytes = encode(event);
  const lengthPrefix = createLengthPrefix(bytes);
  res.write(Buffer.concat([lengthPrefix, bytes]));
};
```

## Dependencies

- `@ag-ui/core` (^0.0.42)
- `langchain` (^1.2.3)
- `zod` (^3.22.4)