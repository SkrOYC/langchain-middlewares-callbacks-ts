# @skroyc/acp-middleware-callbacks

LangChain.js integration providing middleware and callbacks for Agent Client Protocol (ACP) compatibility with code editors and AI development environments.

## Quick Start

```typescript
import { createAgent } from "@langchain/langgraph";
import { 
  createACPSessionMiddleware, 
  createACPToolMiddleware,
  ACPCallbackHandler 
} from "@skroyc/acp-middleware-callbacks";

const agent = createAgent({
  model: myModel,
  tools: myTools,
  middleware: [
    createACPSessionMiddleware({}),
    createACPToolMiddleware({ emitToolResults: true }),
  ],
  callbacks: [
    new ACPCallbackHandler({ connection: myACPConnection }),
  ],
});
```

## Scope

This package provides **LangChain middleware and callbacks** that bridge LangChain `createAgent()` implementations to the **Agent Client Protocol (ACP)** for code editors.

### What We Provide

- **Middleware hooks** for session management, tool execution, permission handling, and mode switching
- **Callback handlers** for streaming events to ACP clients
- **Utility mappers** for content blocks, errors, stop reasons, and session state

### What We Don't Provide

- **Transport layer** - Use `@agentclientprotocol/sdk` directly
- **Protocol initialization** - Managed by the ACP SDK
- **Connection management** - Handled by the ACP SDK
- **Agent interface implementation** - Use LangChain's `createAgent`

For detailed technical specifications, see [SPEC.md](./SPEC.md).

## Installation

```bash
bun install @skroyc/acp-middleware-callbacks
```

### Version Requirements

| Component | Version |
|-----------|---------|
| LangChain | ^1.2.3 |
| @agentclientprotocol/sdk | ^0.12.0 |
| Node.js | >=18.0.0 |

## Usage

### Basic Agent Setup

```typescript
import { createAgent } from "@langchain/langgraph";
import { 
  createACPSessionMiddleware, 
  createACPToolMiddleware,
  createACPModeMiddleware,
  ACPCallbackHandler,
} from "@skroyc/acp-middleware-callbacks";

const agent = createAgent({
  model: myModel,
  tools: myTools,
  middleware: [
    createACPSessionMiddleware({}),
    createACPToolMiddleware({ emitToolResults: true }),
    createACPModeMiddleware({ defaultMode: "agentic" }),
  ],
  callbacks: [
    new ACPCallbackHandler({
      connection: myACPConnection,
      sessionId: params.sessionId,
    }),
  ],
});
```

### Middleware Examples

#### Session Middleware

Manages ACP session lifecycle within LangChain execution.

```typescript
import { createACPSessionMiddleware } from "@skroyc/acp-middleware-callbacks";

const sessionMiddleware = createACPSessionMiddleware({
  emitStateSnapshots: "all",  // Emit state at every checkpoint
  sessionIdExtractor: (config) => config.configurable?.sessionId,
});
```

**Features:**
- Extracts sessionId from config or context
- Tracks threadId and turn count
- Manages state snapshots (initial/final/all/none)
- Integrates with LangGraph checkpointer

#### Tool Middleware

Intercepts LangChain tool calls and emits ACP tool events.

```typescript
import { createACPToolMiddleware } from "@skroyc/acp-middleware-callbacks";

const toolMiddleware = createACPToolMiddleware({
  emitToolResults: true,
  toolKindMapper: (name) => {
    if (name.includes("read")) return "read";
    if (name.includes("write") || name.includes("edit")) return "edit";
    if (name.includes("delete")) return "delete";
    return "execute";
  },
});
```

**Events Emitted:**
- `tool_call`: When tool is announced (status: pending)
- `tool_call_update`: Status changes (in_progress, completed, failed)

#### Permission Middleware

Implements Human-in-the-Loop (HITL) permission workflow.

```typescript
import { createACPPermissionMiddleware } from "@skroyc/acp-middleware-callbacks";

const permissionMiddleware = createACPPermissionMiddleware({
  permissionPolicy: {
    "delete_*": { requiresPermission: true, kind: "delete" },
    "read_*": { requiresPermission: false },
  },
  transport: myTransport,
});
```

**Workflow:**
1. Intercepts tool calls after model generates them
2. Categorizes tools: permission required vs auto-approved
3. Sends `session/request_permission` notification
4. Calls `interrupt()` to checkpoint state and pause
5. Resumes with `Command({ resume: { decisions } })`

#### Mode Middleware

Handles ACP mode switching for agents.

```typescript
import { createACPModeMiddleware, STANDARD_MODES } from "@skroyc/acp-middleware-callbacks";

const modeMiddleware = createACPModeMiddleware({
  modes: {
    [STANDARD_MODES.agentic]: {
      systemPrompt: "You have full autonomy to execute any operations.",
      description: "Full autonomy mode",
    },
    [STANDARD_MODES.interactive]: {
      systemPrompt: "You must ask for confirmation before executing sensitive operations.",
      description: "Interactive mode with permission checks",
    },
  },
  defaultMode: STANDARD_MODES.agentic,
  transport: myTransport,
});
```

**Standard Modes:**
- `agentic`: Full autonomy, no restrictions
- `interactive`: User confirmation for sensitive operations
- `readonly`: Only read operations allowed
- `planning`: Emit plans, defer execution

### Callback Configuration

```typescript
import { ACPCallbackHandler } from "@skroyc/acp-middleware-callbacks";

const callbackHandler = new ACPCallbackHandler({
  connection: myACPConnection,
  sessionId: params.sessionId,
  contentBlockMapper: (block) => transformContent(block),
  stopReasonMapper: (state) => mapToStopReason(state),
});
```

**Responsibilities:**
- Stream LLM tokens via `agent_message_chunk`
- Stream reasoning content via `agent_thought_chunk`
- Emit tool lifecycle events
- Manage sessionId for session updates

## Middleware Reference

| Middleware | Purpose | See |
|------------|---------|-----|
| `createACPSessionMiddleware` | Session lifecycle management | [SPEC.md](./SPEC.md#21-session-middleware) |
| `createACPToolMiddleware` | Tool call events | [SPEC.md](./SPEC.md#22-tool-middleware) |
| `createACPPermissionMiddleware` | HITL permissions | [SPEC.md](./SPEC.md#23-permission-middleware) |
| `createACPModeMiddleware` | Mode switching | [SPEC.md](./SPEC.md#24-mode-middleware) |

## Callback Handler

| Handler | Description |
|---------|-------------|
| `ACPCallbackHandler` | Extends LangChain's `BaseCallbackHandler` to emit ACP events |

See [SPEC.md](./SPEC.md#3-callback-handler) for detailed callback event mapping.

## Utility Mappers

| Utility | Purpose |
|---------|---------|
| `ContentBlockMapper` | Converts between LangChain content and ACP format |
| `ACPErrorMapper` | Maps LangChain errors to ACP error codes |
| `StopReasonMapper` | Maps LangChain agent state to ACP stop reasons |
| `SessionStateMapper` | Helpers for managing ACP session state |
| `MCPToolLoader` | Loads tools from MCP servers |

See [SPEC.md](./SPEC.md#4-utility-mappers) for complete utility documentation.

## Integration Patterns

### Basic Setup

```typescript
const agent = createAgent({
  model: myModel,
  tools: myTools,
  middleware: [
    createACPSessionMiddleware({}),
    createACPToolMiddleware({ emitToolResults: true }),
    createACPModeMiddleware({ defaultMode: "agentic" }),
  ],
  callbacks: [
    new ACPCallbackHandler({
      connection: myACPConnection,
      sessionId: params.sessionId,
    }),
  ],
});
```

### Permission Workflow

```typescript
// Configure permission middleware with policy
const permissionMiddleware = createACPPermissionMiddleware({
  permissionPolicy: {
    "delete_*": { requiresPermission: true, kind: "delete" },
    "read_*": { requiresPermission: false },
  },
  transport: myTransport,
});

// Agent execution flow:
// 1. Model generates tool calls
// 2. afterModel hook intercepts
// 3. Permission-required tools → interrupt()
// 4. User approves/edits/rejects via Command
// 5. Agent resumes with decisions
```

### Session Checkpointing

```typescript
// Configure checkpointer for state persistence
const agent = createAgent({
  model,
  tools,
  middleware: [sessionMiddleware],
  checkpointer: new MemorySaver(),
});

// After interrupt, retrieve checkpointed state
const state = await agent.graph.getState(config);
// state.tasks[0].interrupts[0].value contains HITL request
```

## Recommended Middleware Ordering

For optimal ACP integration, use this middleware order:

1. **`createACPSessionMiddleware`** - First, to establish session context
2. **`createACPModeMiddleware`** - Early, to apply mode restrictions
3. **`createACPToolMiddleware`** - Before permission middleware, for tool tracking
4. **`createACPPermissionMiddleware`** - Last middleware, to intercept and control tool execution

```typescript
middleware: [
  createACPSessionMiddleware({}),
  createACPModeMiddleware({ defaultMode: "interactive" }),
  createACPToolMiddleware({ emitToolResults: true }),
  createACPPermissionMiddleware({ /* policy */ }),
]
```

**Rationale:**
- Session middleware must be first to initialize session state
- Mode middleware should be early to enforce restrictions before tool execution
- Tool middleware needs to run before permission middleware to emit tool events
- Permission middleware must be last to intercept tool calls after all other processing

## Examples

### HITL Permission Workflow

See [`examples/hitl-permission-workflow.ts`](./examples/hitl-permission-workflow.ts) for a complete example demonstrating:

- Basic HITL permission workflow
- Permission policy configuration
- Interrupt/resume pattern
- Decision handling (approve/edit/reject)

## Further Reading

- **[SPEC.md](./SPEC.md)** - Detailed technical specifications
- **[@agentclientprotocol/sdk](https://www.npmjs.com/package/@agentclientprotocol/sdk)** - Official ACP SDK documentation
- **[LangChain Middleware](https://js.langchain.com/docs/concepts/middleware)** - LangChain middleware patterns
- **[LangGraph Documentation](https://js.langchain.com/docs/langgraph)** - createAgent and checkpointing guide

## How This Differs from AG-UI

This package shares architectural patterns with `@skroyc/ag-ui-middleware-callbacks` but serves a different purpose:

| Aspect | AG-UI | ACP |
|--------|-------|-----|
| Communication | Backend → Frontend events | Editor ↔ Agent bidirectional |
| Session | No built-in management | Full session lifecycle |
| Permissions | Not supported | `requestPermission` workflow |
| Content Model | Events-based | Content blocks with annotations |
| Transport | SSE/WebSocket | Stdio/JSON-RPC |

See [SPEC.md](./SPEC.md#how-this-differs-from-ag-ui) for complete comparison.
