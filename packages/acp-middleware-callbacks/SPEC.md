# SPEC: @skroyc/acp-middleware-callbacks

## 1. Overview

This package provides **LangChain middleware and callbacks** that bridge LangChain `createAgent()` implementations to the **Agent Client Protocol (ACP)** for code editors.

### Scope

- **Provides:** Middleware hooks, callback handlers, and utility mappers
- **Does NOT provide:** Transport layer, Agent interface implementation, or stdio handling

### Architecture

```
LangChain Agent (createAgent)
         │
         ├── Session Middleware ──→ ACP session lifecycle
         ├── Tool Middleware ─────→ tool_call / tool_call_update events
         ├── Permission Middleware → HITL via interrupt()
         ├── Mode Middleware ─────→ current_mode_update events
         └── Callback Handler ────→ Streaming events to client
                 │
                 ▼
        @agentclientprotocol/sdk (transport)
                 │
                 ▼
        ACP Client (Editor)
```

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Session** | Isolated conversation context with unique sessionId |
| **Permission Flow** | HITL pattern: interrupt() → user approval → resume |
| **Content Blocks** | Structured content types (text, image, audio, resources) |
| **Stop Reason** | Why agent stopped: end_turn, max_tokens, refusal, cancelled |

### Version Requirements

| Component | Version |
|-----------|---------|
| LangChain | ^1.0.0 |
| @agentclientprotocol/sdk | ^0.12.0 |
| Node.js | >=18.0.0 |

### How This Differs from AG-UI

This package shares architectural patterns with `@skroyc/ag-ui-middleware-callbacks` but serves a different purpose:

| Aspect | AG-UI | ACP |
|--------|-------|-----|
| Communication | Backend → Frontend events | Editor ↔ Agent bidirectional |
| Session | No built-in management | Full session lifecycle |
| Permissions | Not supported | `requestPermission` workflow |
| Content Model | Events-based | Content blocks with annotations |
| Transport | SSE/WebSocket | Stdio/JSON-RPC |

---

## 2. Middleware Components

### 2.1 Session Middleware

Manages ACP session lifecycle within LangChain execution.

**Responsibilities:**
- Extract sessionId from config or context
- Track threadId and turn count
- Manage state snapshots (initial/final/all/none)
- Integrate with LangGraph checkpointer

**State Fields:**
- `acp_sessionId`: Current session identifier
- `acp_threadId`: Conversation thread identifier
- `acp_turnCount`: Number of turns in session

**Snapshot Configuration:**
- `initial`: Emit state when agent starts
- `final`: Emit state when agent completes
- `all`: Emit state at every checkpoint
- `none`: Don't emit state snapshots

**See:** `src/middleware/createACPSessionMiddleware.ts`

### 2.2 Tool Middleware

Intercepts LangChain tool calls and emits ACP tool events.

**Events Emitted:**
- `tool_call`: When tool is announced (status: pending)
- `tool_call_update`: Status changes (in_progress, completed, failed)

**Tool Categories:**
- `read`: File reading operations
- `edit`: File modification operations
- `delete`: File removal operations
- `move`: File relocation operations
- `search`: Search operations
- `execute`: Command execution
- `think`: Internal reasoning
- `fetch`: Network requests
- `switch_mode`: Mode switching

**Tool Kind Detection:** Uses heuristic-based pattern matching on tool names (e.g., "read_file" → `read`, "bash_command" → `execute`).

**See:** `src/middleware/createACPToolMiddleware.ts`

### 2.3 Permission Middleware

Implements HITL (Human-in-the-Loop) permission workflow.

**Pattern:**
1. `afterModel` hook intercepts tool calls after model generates them
2. Categorize tools: permission required vs auto-approved
3. Send `session/request_permission` notification
4. Call `interrupt()` to checkpoint state and pause
5. Resume with Command({ resume: { decisions } })
6. Process decisions: approve / edit / reject

**Policy Configuration:**
- Pattern-based tool matching (e.g., "delete_*", "*_file")
- Per-tool permission requirements
- Custom tool kind mapping

**Decision Outcomes:**

| Decision | Behavior | jumpTo |
|----------|----------|--------|
| `approve` | Tool proceeds unchanged | `undefined` |
| `edit` | Tool args replaced with edited version | `undefined` |
| `reject` | Tool removed, rejection message added | `"model"` |

When any rejection occurs, `jumpTo: "model"` triggers re-planning by the LLM.

**See:** `src/middleware/createACPPermissionMiddleware.ts`

### 2.4 Mode Middleware

Handles ACP mode switching for agents.

**Standard Modes:**
- `agentic`: Full autonomy, no restrictions
- `interactive`: User confirmation for sensitive operations
- `readonly`: Only read operations allowed
- `planning`: Emit plans, defer execution

**Responsibilities:**
- Track current mode in state
- Emit `current_mode_update` events
- Enforce mode restrictions (allowed tools, permission requirements)

**See:** `src/middleware/createACPModeMiddleware.ts`

---

## 3. Callback Handler

Extends LangChain's `BaseCallbackHandler` to emit ACP events.

**Responsibilities:**
- Stream LLM tokens via `agent_message_chunk`
- Stream reasoning content via `agent_thought_chunk`
- Emit tool lifecycle events
- Manage sessionId for session updates

**Event Mapping:**

| LangChain Callback | ACP Event |
|-------------------|-----------|
| handleLLMNewToken | agent_message_chunk |
| handleToolStart | tool_call (pending) |
| handleToolEnd | tool_call_update (completed) |
| handleToolError | tool_call_update (failed) |

**Configuration:**
- Requires ACP connection for session updates
- Optional content block mapper for format conversion
- Optional sessionId extraction

**See:** `src/callbacks/ACPCallbackHandler.ts`

---

## 4. Utility Mappers

### 4.1 Content Block Mapper

Converts between LangChain content and ACP format.

**Capabilities:**
- Text, image, audio, resource conversions
- Annotation preservation
- Bidirectional mapping

**See:** `src/utils/contentBlockMapper.ts`

### 4.2 Stop Reason Mapper

Maps LangChain agent state to ACP stop reasons.

**Mapping:**
- `cancelled`: User cancellation, permission denied
- `refusal`: Agent refuses to continue
- `max_tokens`: Token limit reached
- `max_turn_requests`: Turn/request limit reached
- `end_turn`: Normal completion (default)

**See:** `src/utils/stopReasonMapper.ts`

### 4.3 Session State Utilities

Helpers for managing ACP session state.

**Capabilities:**
- Extract session state from agent state
- Validate session state structure
- Serialize/deserialize for persistence

**See:** `src/utils/sessionStateMapper.ts`

### 4.4 Error Mapper

Maps LangChain errors to ACP error codes.

**Capabilities:**
- Error classification by type
- ACP error code generation
- Type guards for error identification

**See:** `src/utils/errorMapper.ts`

---

## 5. Integration Patterns

### 5.1 Basic Agent Setup

```typescript
// Create agent with ACP middleware and callbacks
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

### 5.2 Permission Workflow

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

### 5.3 Session Checkpointing

```typescript
// Configure checkpointer for state persistence
const agent = createAgent({
  model,
  tools,
  middleware: [sessionMiddleware],
  checkpointer: new MemorySaver(),  // Or PostgresSaver, etc.
});

// After interrupt, retrieve checkpointed state
const state = await agent.graph.getState(config);
// state.tasks[0].interrupts[0].value contains HITL request
```

---

## 6. Error Handling

### 6.1 Stop Reason Mapping

Errors map to stop reasons based on type:

| Error Type | Stop Reason |
|------------|-------------|
| Cancellation/abort | cancelled |
| Permission denied | cancelled |
| Refusal | refusal |
| Token/context limit | max_tokens |
| Turn/step limit | max_turn_requests |
| Other errors | end_turn |

### 6.2 Error Codes

ACP defines standard JSON-RPC error codes:

| Code | Meaning |
|------|---------|
| -32700 to -32603 | JSON-RPC 2.0 standard |
| -32000 | Authentication required |
| -32002 | Resource not found |
| -32013 | Permission denied |

**See:** `@agentclientprotocol/sdk` for complete error reference.

---

## 7. Protocol Stability

### Stable Features

- Session lifecycle (newSession, prompt, loadSession)
- Tool calls (tool_call, tool_call_update)
- Content blocks (text, image, audio, resources)
- Permission workflow (requestPermission)
- Mode switching (setSessionMode)

### Unstable Features

- Session forking, listing, resuming
- Custom protocol extensions
- Advanced configuration options

**See:** `@agentclientprotocol/sdk` for current stability status.

---

## 8. Reference Documentation

### External Resources

- **LangChain Middleware:** `langchain` package, `createMiddleware()` API
- **ACP Protocol:** `@agentclientprotocol/sdk` package
- **Content Blocks:** See ACP SDK content block types
- **Tool Kinds:** See ACP SDK ToolKind type
- **Stop Reasons:** See ACP SDK StopReason type

### Internal Resources

- **Source Code:** `src/middleware/`, `src/callbacks/`, `src/utils/`
- **Examples:** `examples/hitl-permission-workflow.ts`
- **Tests:** `tests/unit/`, `tests/integration/`

---

## 9. Scope Decision Matrix

| Component | In Scope | Reason |
|-----------|----------|--------|
| Session middleware | ✅ Yes | Core ACP session lifecycle |
| Tool middleware | ✅ Yes | Tool call ↔ sessionUpdate mapping |
| Permission middleware | ✅ Yes | HITL via afterModel hook |
| Mode middleware | ✅ Yes | Mode switching logic |
| Callback handler | ✅ Yes | LangChain ↔ ACP event bridging |
| Content block mapper | ✅ Yes | Bidirectional format conversion |
| stopReason mapper | ✅ Yes | State to stopReason conversion |
| MCP tool loader | ✅ Yes | Convenience utility |
| Transport layer | ❌ No | SDK provides this |
| Protocol initialization | ❌ No | SDK provides this |
| Connection management | ❌ No | SDK provides this |

---

**For transport and connection management, use `@agentclientprotocol/sdk` directly.**