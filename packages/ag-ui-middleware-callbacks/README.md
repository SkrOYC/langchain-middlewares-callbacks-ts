# ag-ui-middleware-callbacks

LangChain.js integration providing middleware and callbacks for AG-UI protocol compatibility.

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
| `createSSETransport(req, res)` | Server-Sent Events transport |
| `createProtobufTransport(req, res)` | Protocol Buffer binary transport |

### Utilities

| Export | Description |
|--------|-------------|
| `AGUICallbackHandler` | Callback handler for streaming events |
| `encodeEventWithFraming(event)` | Encode protobuf with 4-byte length prefix |
| `decodeEventWithFraming(data)` | Decode framed protobuf event |
| `AGUI_MEDIA_TYPE` | `"application/vnd.ag-ui.event+proto"` |
| `validateEvent(event)` | Validate event against @ag-ui/core schemas |
| `isValidEvent(event)` | Boolean validation check |
| `createValidatingTransport(transport, options)` | Wrap transport with validation |

### Types

| Type | Description |
|------|-------------|
| `AGUIAgentConfig` | Configuration for `createAGUIAgent` |
| `AGUIMiddlewareOptions` | Middleware configuration options |
| `AGUITransport` | Transport interface with `emit(event)` |
| `ProtobufTransport` | Extended transport with `signal`, `encodeEvent`, `decodeEvent` |
| `EventType` | Event type enum from @ag-ui/core |
| `EventSchemas` | Zod discriminated union for all events |

## Quick Start

```typescript
import { createAGUIAgent, createSSETransport, AGUICallbackHandler } from "ag-ui-middleware-callbacks";

const transport = createSSETransport(req, res);

const agent = createAGUIAgent({
  model,
  tools,
  transport,
});

const eventStream = await agent.streamEvents(
  { messages },
  {
    version: "v2",
    callbacks: [new AGUICallbackHandler(transport)]
  }
);

for await (const event of eventStream) {
  // Events automatically emitted via transport
}
```

## Middleware Configuration

```typescript
const middleware = createAGUIMiddleware({
  transport,
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

## Protobuf Transport

```typescript
import { createProtobufTransport, AGUI_MEDIA_TYPE } from "ag-ui-middleware-callbacks";

const acceptProtobuf = req.headers.accept?.includes(AGUI_MEDIA_TYPE);
const transport = acceptProtobuf
  ? createProtobufTransport(req, res)
  : createSSETransport(req, res);
```

## Dependencies

- `@ag-ui/core` (^0.0.42)
- `@ag-ui/proto` (^0.0.42)
- `langchain` (^1.2.3)
- `zod` (^3.22.4)