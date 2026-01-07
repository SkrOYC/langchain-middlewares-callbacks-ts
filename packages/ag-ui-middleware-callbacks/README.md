# ag-ui-middleware-callbacks

LangChain.js integration providing both middleware and callbacks for AG-UI protocol compatibility.

Now with official `@ag-ui/core` types and `@ag-ui/proto` support for Protocol Buffer encoding!

## Installation

```bash
bun install ag-ui-middleware-callbacks
```

## Features

- **Official Protocol Types**: Uses `@ag-ui/core` for type definitions and validation schemas
- **Protocol Buffer Support**: Binary encoding via `@ag-ui/proto` (60-80% smaller payloads)
- **SSE Transport**: Traditional Server-Sent Events transport
- **Middleware**: Lifecycle and state management (beforeAgent, afterAgent, state snapshots)
- **Callbacks**: Streaming events (TEXT_MESSAGE_CONTENT, TOOL_CALL_ARGS, tool lifecycle)
- **Validation**: Optional runtime validation using official Zod schemas

For complete specifications and implementation details, see [SPEC.md](./SPEC.md).

## Quick Start

### SSE Transport (Default)

```typescript
import { createAGUIAgent, createSSETransport, AGUICallbackHandler } from "ag-ui-middleware-callbacks";

// Create SSE transport
const transport = createSSETransport(req, res);

// Create AG-UI enabled agent
const agent = createAGUIAgent({
  model,
  tools,
  transport,
});

// Stream with callbacks (required for TEXT_MESSAGE events)
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

### Protobuf Transport (New!)

For bandwidth-efficient binary encoding:

```typescript
import { 
  createAGUIAgent, 
  createProtobufTransport, 
  AGUI_MEDIA_TYPE,
  AGUICallbackHandler 
} from "ag-ui-middleware-callbacks";

app.post('/api/agent', (req, res) => {
  // Check client preference via Accept header
  const acceptProtobuf = req.headers.accept?.includes(AGUI_MEDIA_TYPE);
  
  const transport = acceptProtobuf
    ? createProtobufTransport(req, res)
    : createSSETransport(req, res);
  
  const agent = createAGUIAgent({
    model,
    tools,
    transport,
  });
  
  // ... stream events
});
```

## API Reference

### Transports

| Function | Description |
|----------|-------------|
| `createSSETransport(req, res)` | Server-Sent Events (text/event-stream) |
| `createProtobufTransport(req, res)` | Protocol Buffer binary encoding |

### Protobuf Utilities

```typescript
import { 
  encodeEventWithFraming,  // Encode event with 4-byte length prefix
  decodeEventWithFraming,  // Decode framed protobuf event
  AGUI_MEDIA_TYPE,         // "application/vnd.ag-ui.event+proto"
} from "ag-ui-middleware-callbacks";
```

### Validation

```typescript
import { 
  validateEvent,           // Validate event against @ag-ui/core schemas
  isValidEvent,            // Boolean check for event validity
  createValidatingTransport, // Wrap transport with validation
} from "ag-ui-middleware-callbacks";

// Optional: Enable validation in development
const validatingTransport = createValidatingTransport(transport, {
  throwOnInvalid: false,  // Log warnings instead of throwing
});
```

### @ag-ui/core Re-exports

```typescript
import {
  EventType,       // Event type enum (RUN_STARTED, TEXT_MESSAGE_CONTENT, etc.)
  EventSchemas,    // Zod discriminated union for all events
  encodeProtobuf,  // Direct access to @ag-ui/proto encode
  decodeProtobuf,  // Direct access to @ag-ui/proto decode
} from "ag-ui-middleware-callbacks";
```

## Configuration

### Middleware Options

```typescript
const agent = createAGUIAgent({
  model,
  tools,
  transport,
  middlewareOptions: {
    emitStateSnapshots: "initial", // "initial" | "final" | "none"
    emitActivities: false,
    validateEvents: false,  // Enable for debugging
    // ... other options
  },
});
```

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

## Protocol Compliance

This package uses official `@ag-ui/core` (v0.0.42+) types and schemas:
- All 26 stable event types are supported
- Zod schemas for runtime validation
- Protocol Buffer encoding via `@ag-ui/proto`

### Known Limitations

Some events are not yet supported by `@ag-ui/proto` for binary encoding:
- `TOOL_CALL_RESULT`
- `ACTIVITY_SNAPSHOT`
- `ACTIVITY_DELTA`

These events will be encoded but may fail decoding. Use SSE transport for full event support.

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Build
bun run build
```

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
