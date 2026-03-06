# Architecture.md - Logical Architecture

## @skroyc/ag-ui-middleware-callbacks

---

## 1. Architectural Strategy

### Pattern: Hybrid Event Handler

This package implements a **Hybrid Event Handler** pattern, combining LangChain's Middleware and Callbacks systems to achieve complete AG-UI protocol coverage.

**Justification (Martin Fowler):**
The hybrid approach is necessitated by LangChain's architectural separation between middleware (for agent lifecycle and state) and callbacks (for observability and streaming). This follows the **Separate Interface** pattern - each mechanism has a distinct responsibility and cannot be unified due to LangChain's API constraints.

### Key Architectural Decision

**Why two mechanisms?**

LangChain.js intentionally separates middleware from callbacks:
- **Middleware** operates at the agent orchestration level, with full access to state and runtime
- **Callbacks** operate at the streaming level, observing events without modifying them

This separation is by design (per LangChain's architecture), not a flaw. Our hybrid approach works within these constraints.

---

## 2. System Containers

| Container | Type | Responsibility |
|-----------|------|----------------|
| **AGUIMiddleware** | Middleware | Intercepts agent lifecycle, emits lifecycle/state/activity events |
| **AGUICallbackHandler** | Callback Handler | Observes streaming events, emits text/tool/reasoning events |
| **createAGUIAgent** | Factory | Combines middleware + callbacks into unified agent creation |
| **Event Normalizer** | Utility | Transforms internal events to AG-UI protocol format; expands convenience events (TEXT_MESSAGE_CHUNK → START/CONTENT/END) |
| **State Manager** | Utility | Computes state snapshots and deltas |

---

## 2.1 Middleware vs Callbacks Separation

This package uses two distinct LangChain mechanisms because no single mechanism can emit all required AG-UI events.

### LangChain Middleware (Agent Integration Layer)

**When to use:** Agent lifecycle, state management, activity tracking

| Hook | AG-UI Events |
|------|--------------|
| `beforeAgent` | RUN_STARTED |
| `afterAgent` | RUN_FINISHED, RUN_ERROR |
| `beforeModel` | STEP_STARTED, ACTIVITY_SNAPSHOT |
| `afterModel` | STEP_FINISHED, ACTIVITY_DELTA |

#### Execution Order

LangChain middleware hooks execute in a predictable sequence:

```
beforeAgent (forward) → beforeModel → wrapModelCall → model
    → afterModel (reverse) → wrapToolCall → tool(s) → repeat → afterAgent (reverse)
```

- **Forward order:** `beforeAgent`, `beforeModel` run middleware[0] → middleware[n]
- **Reverse order:** `afterAgent`, `afterModel` run middleware[n] → middleware[0]

> **Design Decision:** This package uses only simple hooks (`beforeAgent`, `afterAgent`, `beforeModel`, `afterModel`). The `wrapModelCall` and `wrapToolCall` hooks are intentionally not used because:
> - They require calling `handler(request)` to continue execution, adding complexity
> - The package's purpose is event emission (observability), not execution control
> - Simple hooks are sufficient for emitting lifecycle and state events

#### JumpTo Control Flow

LangChain middleware supports `jumpTo` for controlling execution flow:

- `jumpTo: "end"` - Skip to afterAgent (exit the run)
- `jumpTo: "tools"` - Skip afterModel, go directly to tool execution
- `jumpTo: "model"` - Skip tools, go to next model call

Requires `canJumpTo` declaration in middleware configuration.

> **Technical Debt:** JumpTo is not implemented. This is tracked as future work (M-2) for advanced control flow patterns like rate limiting and conditional routing.

#### Private State

Fields prefixed with `_` are internal and excluded from invoke results:

```typescript
stateSchema = z.object({
  publicCounter: z.number().default(0),
  _internalFlag: z.boolean().default(false), // Private - not exposed
})
```

**Capabilities:**
- ✅ Full access to agent state
- ✅ Full access to runtime
- ✅ Can modify execution flow
- ❌ Cannot access streaming tokens

### LangChain Callbacks (Observability Layer)

**When to use:** Streaming events, token-by-token emission

| Callback | AG-UI Events |
|----------|--------------|
| `handleLLMStart` | TEXT_MESSAGE_START, REASONING_START |
| `handleLLMNewToken` | TEXT_MESSAGE_CONTENT |
| `handleLLMEnd` | TEXT_MESSAGE_END |
| `handleToolStart` | TOOL_CALL_START, TOOL_CALL_ARGS |
| `handleToolEnd` | TOOL_CALL_END, TOOL_CALL_RESULT |
| `handleToolError` | TOOL_CALL_ERROR |
| `handleChainStart` | CHAIN_STARTED |
| `handleChainEnd` | CHAIN_FINISHED |
| `handleChainError` | CHAIN_ERROR |

**Capabilities:**
- ✅ Access to streaming tokens
- ✅ Message boundaries
- ❌ Cannot access agent state
- ❌ Cannot modify execution

### Why Both Are Required

LangChain intentionally separates these systems:
- **Middleware** = Agent orchestration (state, flow control)
- **Callbacks** = Observability (streaming, logging)

This separation is mandated by LangChain's API architecture, not an arbitrary choice.

---

## 3. Container Diagram

```mermaid
C4Container
  Person(LangChainDev, "LangChain Developer", "Uses the package")
  
  Container(LangChainRuntime, "LangChain Runtime", "Node.js", "Executes agent logic via createAgent()")
  
  Container(AGUIMiddleware, "AGUIMiddleware", "TypeScript", "Emits lifecycle events (RUN_*, STEP_*, STATE_*, ACTIVITY_*)")
  Container(AGUICallbackHandler, "AGUICallbackHandler", "TypeScript", "Emits streaming events (TEXT_*, TOOL_*, REASONING_*)")
  Container(createAGUIAgent, "createAGUIAgent", "TypeScript", "Factory combining middleware + callbacks")
  
  Container(Transport, "User Transport", "TypeScript", "Developer-provided: SSE, WebSocket, or custom")
  Container(AGUIFrontend, "AG-UI Frontend", "Any", "Consumes AG-UI events")

  Rel(LangChainDev, createAGUIAgent, "Creates agent with")
  Rel(createAGUIAgent, AGUIMiddleware, "Adds")
  Rel(createAGUIAgent, AGUICallbackHandler, "Binds")
  Rel(AGUIMiddleware, LangChainRuntime, "Intercepts")
  Rel(AGUICallbackHandler, LangChainRuntime, "Observes")
  Rel(AGUIMiddleware, Transport, "Emits events via onEvent callback")
  Rel(AGUICallbackHandler, Transport, "Emits events via onEvent callback")
  Rel(Transport, AGUIFrontend, "Delivers via SSE/WS/Protobuf")
```

---

## 4. Critical Execution Flows

### Flow 1: Agent Invocation

```mermaid
sequenceDiagram
  participant Dev as Developer
  participant Agent as LangChain Agent
  participant Middleware as AGUIMiddleware
  participant Transport as User Transport
  participant Frontend as AG-UI Frontend

  Dev->>Agent: agent.streamEvents(input, { callbacks: [handler] })
  Agent->>Middleware: beforeAgent hook
  Middleware->>Transport: emit(RUN_STARTED)
  Transport->>Frontend: SSE/WS stream
  
  loop Model Iteration
    Agent->>Middleware: beforeModel hook
    Middleware->>Transport: emit(STEP_STARTED)
    Agent->>Agent: Model executes
    Agent->>Middleware: afterModel hook
    Middleware->>Transport: emit(STEP_FINISHED)
  end
  
  Agent->>Middleware: afterAgent hook
  Middleware->>Transport: emit(RUN_FINISHED)
```

### Flow 2: Token Streaming

```mermaid
sequenceDiagram
  participant Model as LLM
  participant Handler as AGUICallbackHandler
  participant Transport as User Transport
  participant Frontend as AG-UI Frontend

  Model->>Handler: handleLLMStart
  Handler->>Transport: emit(TEXT_MESSAGE_START)
  
  loop Token by Token
    Model->>Handler: handleLLMNewToken(token)
    Handler->>Transport: emit(TEXT_MESSAGE_CONTENT)
  end
  
  Model->>Handler: handleLLMEnd
  Handler->>Transport: emit(TEXT_MESSAGE_END)
```

### Flow 3: Tool Execution

```mermaid
sequenceDiagram
  participant Agent as LangChain Agent
  participant Handler as AGUICallbackHandler
  participant Tool as Tool Function
  participant Transport as User Transport
  participant Frontend as AG-UI Frontend

  Agent->>Handler: handleToolStart
  Handler->>Transport: emit(TOOL_CALL_START)
  Handler->>Transport: emit(TOOL_CALL_ARGS)
  
  Agent->>Tool: execute(input)
  Tool-->>Agent: result
  
  Agent->>Handler: handleToolEnd
  Handler->>Transport: emit(TOOL_CALL_END)
  Handler->>Transport: emit(TOOL_CALL_RESULT)
```

---

## 5. Resilience & Cross-Cutting Concerns

### Event Ordering Strategy

**Challenge:** Middleware and callbacks are separate systems with different emission paths.

**Solution:** The package guarantees ordering by:
1. Middleware hooks always fire before callbacks for the same logical operation
2. RUN_STARTED is emitted in `beforeAgent` (first hook)
3. RUN_FINISHED is emitted in `afterAgent` (last hook)

### Error Handling

| Layer | Strategy |
|-------|----------|
| **Middleware** | Try-catch in every hook; emit RUN_ERROR on failure |
| **Callbacks** | Return Promise; errors logged but not thrown |
| **Transport** | Fail-silent - errors caught, never crash agent |

### Observability

- **Correlation IDs:** All events include `runId`, `threadId` for tracing
- **Metadata:** Events include optional `metadata` for debugging

---

## 6. Logical Risks

### Constraint 1: Two Event Sources

**Issue:** Events come from two different mechanisms (middleware + callbacks).

**Mitigation:** 
- Clear documentation of which events come from where
- Event ordering guarantees (see above)
- Unified factory (`createAGUIAgent`) to reduce cognitive load

### Constraint 2: No State Access in Callbacks

**Issue:** Callbacks cannot access or modify agent state.

**Mitigation:**
- State events (STATE_SNAPSHOT) emitted via middleware only
- Message IDs passed through metadata or generated independently

### Constraint 3: Streaming Only via Callbacks

**Issue:** Middleware cannot access token streaming.

**Mitigation:**
- Text content events emitted via callbacks only
- Clear documentation of mechanism requirements
