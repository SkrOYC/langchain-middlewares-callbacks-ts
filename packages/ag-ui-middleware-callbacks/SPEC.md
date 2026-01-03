# LangChain.js ag-ui-middleware-callbacks (Middleware & Callbacks) by SkrOYC

## Specification Document

---

## 1. Overview

### 1.1 Purpose
Create a plug-and-play LangChain.js integration providing both middleware and callbacks that makes any agent created with `createAgent()` fully compatible with any AG-UI protocol frontend.

## 2. Architectural Principles

### 2.1 Integration Philosophy
LangChain.js agents require a **hybrid integration approach** to achieve full AG-UI protocol compatibility. This is because:
- **Middleware** cannot access streaming tokens (TEXT_MESSAGE_CONTENT, TOOL_CALL_ARGS) - design limitation
- **Callbacks** cannot access agent state (STATE_SNAPSHOT, STATE_DELTA) - architectural separation
- **createAgent()** does not accept a `callbacks` parameter - API constraint

**Solution:** Use the appropriate mechanism for each event type based on its requirements.

**Two Supported Approaches:**

| Approach | Description | Use Case | Complexity | User Experience |
|----------|-------------|----------|------------|----------------|
| **A) AG-UI Agent Wrapper** | Creates a wrapper class that automatically adds callbacks to all invocations | Production, plug-and-play | Medium | ⭐⭐ **Best for most cases** |
| **B) Middleware + User-Passed Callbacks** | Returns middleware and callbacks; user passes callbacks to each invoke/stream | Testing, flexible | Low | Best for flexibility |
| **C) AG-UI Backend Endpoint** | Exposes agent via AG-UI protocol server endpoint | Server deployment, full protocol control | High | Best for multi-tenant deployments |

### 2.2 Transport Abstraction (Driver Pattern)
- **Runtime-Only Transport**: Transports (WS, SSE) are live handles and **must not** be persisted in agent state.
- **Interface-based**: Transport is an abstraction, allowing the middleware to remain decoupled from the network layer.
- **Context-Injected**: Transports are provided at runtime via the agent's context, supporting session re-attachment after checkpoint resumption.

### 2.3 Configuration Philosophy
- **Sensible defaults**: Works immediately without configuration
- **Progressive disclosure**: Complexity available but not required
- **Zero config mode**: Add middleware to agent, it works
- **Explicit overrides**: Users can customize when needed

### 2.4 Protocol Compliance
- **Single Source of Truth**: Strictly follows to `ag-ui-protocol-spec` authoritative definitions.
- **Streaming-First**: Prioritizes chunks and deltas (JSON Patch) to minimize latency.
- **Event Ordering**: Guaranteed emission order to ensure frontend state consistency.

### 2.5 State Coordination Pattern

**The Challenge:**

Middleware and Callbacks are separate LangChain.js systems with different capabilities:
- **Middleware** can access and modify agent state (via `stateSchema`), has full `runtime` access, but **cannot access streaming tokens**
- **Callbacks** can access streaming tokens via `handleLLMNewToken`, but **cannot access agent state** (by design - they're for observability)
- Callbacks receive `runId`, `parentRunId`, and `metadata` parameters for correlation and context
- Callbacks do NOT receive full `runtime` object (to keep them lightweight)

**The Requirement:**

Both middleware and callbacks need access to:
- `messageId` - For linking streaming tokens to message boundaries
- `toolCallId` - For linking tool streaming to tool execution
- Session metadata (threadId, runId) - For proper event correlation

### 2.5.1 Callback Parameter Access

Callbacks receive comprehensive data for event correlation:

| Parameter | Available In | Description |
|-----------|---------------|-------------|
| `runId` | All callbacks | Unique ID for this run |
| `parentRunId` | All callbacks (optional) | Parent run's ID for hierarchical linking |
| `metadata` | `handle*Start` callbacks | Runtime metadata (includes `thread_id`, custom keys) |
| `output` | `handle*End` callbacks | Result/output from the operation |

**Key Insights:**

1. **`runId` is the correlation key** - Same runId shared across all callbacks and middleware hooks in a single invocation
2. **`parentRunId` links events hierarchically** - Tool callbacks receive the LLM's `runId` as `parentRunId`, enabling linkage:
   ```typescript
   async handleLLMStart(llm, prompts, runId, parentRunId, tags, metadata) {
     this.messageIds.set(runId, messageId);
   }

   async handleToolStart(tool, input, runId, parentRunId, tags, metadata) {
     // Look up parent LLM's messageId
     const messageId = this.messageIds.get(parentRunId || "");
   }
   ```
3. **`metadata` provides threadId** - LangChain automatically copies `configurable.thread_id` to `metadata`:
   ```typescript
   // Access threadId in callbacks
   async handleLLMStart(llm, prompts, runId, parentRunId, tags, metadata) {
     const threadId = metadata?.thread_id;  // Auto-copied from configurable
   }
   ```
4. **`output` provides tool results** - `handleToolEnd` receives the tool's output directly, no need to access state:
   ```typescript
   async handleToolEnd(output, runId, parentRunId, tags) {
     // Emit TOOL_CALL_RESULT with direct access to tool output
     this.transport.emit({
       type: "TOOL_CALL_RESULT",
       content: output  // Tool result - directly available
     });
   }
   ```

**Why No State Access in Callbacks?**
- Callbacks are designed for **observability** (logging, tracing), not state modification
- State manipulation is responsibility of middleware hooks
- This separation ensures callbacks remain lightweight and cannot interfere with agent logic

---

**The Solution: Metadata Propagation + Callback Internal State**

Since middleware cannot directly pass data to callbacks, we use two coordinated mechanisms:

1. **Middleware writes to `runtime.config.metadata`** - This is mutable and propagates to callbacks
2. **Callbacks use internal state (Map)** - Store IDs keyed by `runId` for lookup during streaming

**Why This Works:**

| Step | Mechanism | What Happens | Why It Works |
|------|-----------|--------------|--------------|
| 1 | Middleware | Generates messageId, stores in `runtime.config.metadata` | Metadata is mutable and passed to callbacks |
| 2 | Callback `handleLLMStart` | Reads messageId from metadata, stores in internal Map by runId | runId is same for all callbacks in invocation |
| 3 | Callback `handleLLMNewToken` | Retrieves messageId from Map using runId | No access to metadata needed during streaming |
| 4 | Cleanup | `handleLLMEnd` removes messageId from Map | Prevents memory leaks |

**Implementation Pattern:**

```typescript
// Middleware: Set metadata before model invocation
beforeModel: async (state, runtime) => {
  const messageId = generateId();
  
  // Emit message start
  runtime.context.transport?.emit({
    type: "TEXT_MESSAGE_START",
    messageId,
    role: "assistant"
  });
  
  // Store in metadata for callbacks - THIS PROPAGATES TO CALLBACKS
  runtime.config.metadata = {
    ...runtime.config.metadata,
    agui_messageId: messageId
  };
  
  return {}; // No state changes needed
}
```

```typescript
// Callback Handler: Internal state storage
class AGUICallbackHandler extends BaseCallbackHandler {
  private messageIds = new Map<string, string>();
  private toolCallIds = new Map<string, string>();
  
  name = "ag-ui-streaming";
  
  // handleLLMStart receives metadata - this is where we capture IDs
  async handleLLMStart(llm, prompts, runId, parentRunId, tags, metadata) {
    const messageId = metadata?.agui_messageId;
    if (messageId) {
      this.messageIds.set(runId, messageId);
    }
  }
  
  // handleLLMNewToken - streaming tokens, need messageId from internal state
  async handleLLMNewToken(token, idx, runId, parentRunId, tags, fields) {
    const messageId = this.messageIds.get(runId);
    if (!messageId) return;
    
    // Emit streaming token - use this.transport, not runtime.context
    this.transport.emit({
      type: "TEXT_MESSAGE_CONTENT",
      messageId,
      delta: token
    });
    
    // Tool call args are available directly in tool_call_chunks
    const toolCallChunks = fields?.chunk?.message?.tool_call_chunks;
    toolCallChunks?.forEach(chunk => {
      this.transport.emit({
        type: "TOOL_CALL_ARGS",
        toolCallId: chunk.id,
        delta: chunk.args
      });
    });
  }
  
  // handleToolStart - extract toolCallId from stringified input
  async handleToolStart(tool, input, runId, parentRunId, tags, metadata) {
    // Input is JSON-stringified ToolCall: {"id":"...","name":"...","args":{...}}
    let toolCallId: string | undefined;
    try {
      const parsed = JSON.parse(input);
      toolCallId = parsed.id;
    } catch {
      toolCallId = undefined;
    }
    
    if (toolCallId) {
      this.toolCallIds.set(runId, toolCallId);
    }
    
    const messageId = this.messageIds.get(parentRunId || "");
    
    this.transport.emit({
      type: "TOOL_CALL_START",
      toolCallId: toolCallId || runId,
      toolCallName: tool.name,
      parentMessageId: messageId
    });
  }
  
  async handleToolEnd(output, runId, parentRunId, tags) {
    const toolCallId = this.toolCallIds.get(runId);
    this.toolCallIds.delete(runId);
    
    this.transport.emit({
      type: "TOOL_CALL_END",
      toolCallId: toolCallId || runId
    });
  }
  
  async handleLLMEnd(output, runId, parentRunId, tags) {
    this.messageIds.delete(runId);
  }
}
```

**Key Insights:**

1. **`runId` is the correlation key** - It's unique per agent invocation and shared across all callbacks and middleware hooks
2. **`runtime.config.metadata` is mutable** - Middleware can add keys, callbacks receive them in `handle*Start` methods
3. **Tool call IDs are directly available** - `handleLLMNewToken` receives `tool_call_chunks` which include the `id` field
4. **Input stringification** - `handleToolStart` receives stringified `ToolCall` which can be parsed for the tool call ID

### 2.6 Callback Handler Implementation Pattern

This section provides the complete pattern for implementing an AG-UI callback handler.

**Required Pattern Elements:**

1. **Internal state storage** - Use `Map<runId, string>` to store message/tool IDs
2. **Metadata reading** - Read IDs from `metadata` in `handle*Start` methods
3. **Internal state cleanup** - Remove IDs in `handle*End` methods
4. **Parent run correlation** - Use `parentRunId` to link child callbacks to parent

**Complete Implementation:**

```typescript
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";

  export class AGUICallbackHandler extends BaseCallbackHandler {
    name = "ag-ui-callback";

    // Internal state: Map runId -> messageId/toolCallId
    private messageIds = new Map<string, string>();
    private toolCallIds = new Map<string, string>();
    private transport: AGUITransport;

    constructor(transport: AGUITransport) {
      // ✅ FAIL-SAFE: Never raise errors from AG-UI callbacks
      super({ raiseError: false });
      this.transport = transport;
    }

    // ✅ MEMORY CLEANUP: Required for long-running agents
    dispose(): void {
      this.messageIds.clear();
      this.toolCallIds.clear();
    }
  
  // ===== LLM Callbacks =====
  
  async handleLLMStart(llm: BaseLanguageModel, prompts: string[], runId: string, parentRunId?: string, tags?: string[], metadata?: Record<string, unknown>): Promise<void> {
    // Capture messageId from metadata (set by middleware)
    const messageId = metadata?.agui_messageId as string | undefined;
    if (messageId) {
      this.messageIds.set(runId, messageId);
    }
  }
  
  async handleLLMNewToken(token: string, idx: NewTokenIndices, runId: string, parentRunId?: string, tags?: string[], fields?: HandleLLMNewTokenCallbackFields): Promise<void> {
    // Retrieve messageId from internal state
    const messageId = this.messageIds.get(runId);
    if (!messageId) return;
    
    // Emit TEXT_MESSAGE_CONTENT
    this.transport.emit({
      type: "TEXT_MESSAGE_CONTENT",
      messageId,
      delta: token
    });
    
    // Emit TOOL_CALL_ARGS (ID available directly in chunks)
    const toolCallChunks = fields?.chunk?.message?.tool_call_chunks;
    toolCallChunks?.forEach(chunk => {
      if (chunk.id) {
        this.transport.emit({
          type: "TOOL_CALL_ARGS",
          toolCallId: chunk.id,
          delta: chunk.args
        });
      }
    });
  }
  
  async handleLLMEnd(output: LLMResult, runId: string, parentRunId?: string, tags?: string[]): Promise<void> {
    // Cleanup messageId
    this.messageIds.delete(runId);
  }
  
  // ===== Tool Callbacks =====
  
  async handleToolStart(tool: Serialized, input: string, runId: string, parentRunId?: string, tags?: string[], metadata?: Record<string, unknown>): Promise<void> {
    // Extract toolCallId from stringified ToolCall input
    // Input format: {"id":"...","name":"...","args":{...}}
    let toolCallId: string | undefined;
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === 'object' && 'id' in parsed) {
        toolCallId = parsed.id;
      }
    } catch {
      toolCallId = undefined;
    }
    
    // Store for handleToolEnd
    if (toolCallId) {
      this.toolCallIds.set(runId, toolCallId);
    }
    
    // Retrieve parent messageId using parentRunId
    const messageId = this.messageIds.get(parentRunId || "");
    
    // Emit TOOL_CALL_START
    this.transport.emit({
      type: "TOOL_CALL_START",
      toolCallId: toolCallId || runId,
      toolCallName: tool.name,
      parentMessageId: messageId
    });
  }
  
  async handleToolEnd(output: string, runId: string, parentRunId?: string, tags?: string[]): Promise<void> {
    // Retrieve toolCallId from internal state
    const toolCallId = this.toolCallIds.get(runId);
    this.toolCallIds.delete(runId);

    // Retrieve parent messageId via parentRunId
    const messageId = this.messageIds.get(parentRunId || "");

    // Emit TOOL_CALL_END
    this.transport.emit({
      type: "TOOL_CALL_END",
      toolCallId: toolCallId || runId,
      parentMessageId: messageId
    });

    // Emit TOOL_CALL_RESULT
    this.transport.emit({
      type: "TOOL_CALL_RESULT",
      messageId: generateId(),
      toolCallId: toolCallId || runId,
      parentMessageId: messageId,
      content: output,
      role: "tool"
    });
  }
  
  // ===== Error Handling =====
  
  async handleLLMError(error: Error, runId: string): Promise<void> {
    this.messageIds.delete(runId);
  }
  
  async handleToolError(error: Error, runId: string): Promise<void> {
    this.toolCallIds.delete(runId);
  }
}
```

**Why This Pattern Works:**

1. **runId is consistent** - Same runId passed to all callbacks in a single invocation chain
2. **Metadata propagates** - `runtime.config.metadata` mutations are visible to callbacks
3. **Internal state is safe** - Each handler instance maintains its own Map
4. **Parent-child linking** - `parentRunId` enables linking tool callbacks to LLM run
5. **Cleanup prevents leaks** - Always delete from Maps in `handle*End` methods
6. **Callback has all needed data** - `runId`, `parentRunId`, `output`, and `metadata` provide complete access for emitting all events

**Integration with Middleware:**

```typescript
// Middleware sets metadata
const middleware = createAGUIMiddleware({
  transport: sseTransport,
  
  beforeModel: async (state, runtime) => {
    const messageId = generateId();
    
    // Emit TEXT_MESSAGE_START
    runtime.context.transport.emit({
      type: "TEXT_MESSAGE_START",
      messageId,
      role: "assistant"
    });
    
    // Store in metadata for callbacks
    runtime.config.metadata = {
      ...runtime.config.metadata,
      agui_messageId: messageId
    };
    
    return {};
  }
});

// Callbacks read from metadata
const callbacks = [new AGUICallbackHandler(sseTransport)];

// User invokes with both
await agent.invoke(input, {
  middleware: [middleware],
  callbacks
});
```

**Context Schema Requirement:**

The `contextSchema` includes the transport, session identifiers, and cancellation support:

```typescript
contextSchema = z.object({
  transport: AGUITransport,              // Live connection handle
  threadId: z.string().optional(),       // Session override
  runId: z.string().optional(),         // Run override
  signal: z.instanceof(AbortSignal).optional() // ✅ Cancellation support
})
```

**Abort Signal Usage:**
```typescript
// SSE transport creates signal on client disconnect
const sseTransport = createSSETransport(req, res);

// Signal propagates to agent for cancellation
await agent.invoke(input, {
  context: { transport: sseTransport },
  signal: sseTransport.signal  // ✅ Agent stops on disconnect
});
```

**Note on Coordination:** Message and tool call IDs are NOT stored in context. They are:
- **Passed via metadata**: `runtime.config.metadata.agui_messageId`
- **Stored in callback state**: Internal `Map<runId, messageId>`
- **Ephemeral**: Not persisted across invocations

**Why This Works:**

| Coordination Data | Stored By | Accessed By | Access Path |
|-----------------|-----------|-----------|-------------|
| messageId | Middleware (metadata) | Callbacks | `metadata.agui_messageId` in `handleLLMStart` |
| toolCallId | Model (in chunks) | Callbacks | Direct from `tool_call_chunks` in `handleLLMNewToken` or parsed from `handleToolStart` input |
| runId | LangChain (generated) | Both | Same across all hooks and callbacks |

---

#### 2.7 Approach A: AG-UI Agent Wrapper Class ⭐⭐ Recommended for Production

**Description:** Creates a wrapper class that automatically adds callbacks to all invocations.

**Factory Signature:**
```typescript
createAGUIAgent(config: AGUIAgentConfig): AGUIAgent
```

**Implementation:**
```typescript
class AGUIAgent {
  private agent: Agent;
  private transport: AGUITransport;
  private middleware: AgentMiddleware;
  private callbacks: BaseCallbackHandler[];
  
  constructor(config) {
    // Create middleware for lifecycle & state
    this.middleware = createAGUIMiddleware({
      transport: config.transport
    });
    
    // Create callbacks for streaming
    this.callbacks = [
      createAGUICallbackHandler({
        transport: config.transport
      })
    ];
    
    // Create base agent
    this.agent = createAgent({
      model: config.model,
      tools: config.tools,
      middleware: [this.middleware]
    });
  }
  
  async invoke(input, config?) {
    return this.agent.invoke(input, {
      ...config,
      callbacks: [...(config?.callbacks || []), ...this.callbacks]
    });
  }
  
  async stream(input, config?) {
    return this.agent.stream(input, {
      ...config,
      callbacks: [...(config?.callbacks || []), ...this.callbacks]
    });
  }
}
```

**Usage:**
```typescript
const agent = createAGUIAgent({
  model,
  tools,
  transport: sseTransport
});

// Plug-and-play! No need to pass callbacks
await agent.invoke({ messages: [...] });
```

**Pros:**
- ✅ **Zero user friction:** Once created, agent works like a standard LangChain.js agent
- ✅ **Full AG-UI coverage:** All events emitted automatically
- ✅ **Per-agent control:** Each instance has its own transport/callbacks
- ✅ **Error-proof:** Users can't forget to pass callbacks

**Cons:**
- ⚠️ **Wrapper complexity:** Requires maintaining a proxy class
- ⚠️ **Maintenance:** Must update `invoke`/`stream` methods if Agent API changes
- ⚠️ **Not technically "middleware":** It's a wrapper around middleware

**Maintenance Burden:** **Low** - Only 2 core methods to maintain (`invoke`, `stream`)

**When to Choose:**
- Production applications requiring plug-and-play
- Multiple agents with different configurations
- Teams that want zero-friction setup

**Alternative: Using `withConfig` (Simpler)**

LangChain.js provides a `withConfig` method that automatically binds callbacks to all invocations, eliminating the need for a manual wrapper class:

```typescript
function createAGUIAgent(config: AGUIAgentConfig) {
  const middleware = createAGUIMiddleware({
    transport: config.transport
  });
  const callbacks = [new AGUICallbackHandler(config.transport)];

  const agent = createAgent({
    model: config.model,
    tools: config.tools,
    middleware: [middleware]
  });

  // Automatic callback binding - no wrapper class needed!
  // This merges callbacks with any user-provided callbacks
  return agent.withConfig({ callbacks });
}

// Usage - identical to wrapper class
const agent = createAGUIAgent({ model, tools, transport: sseTransport });
await agent.invoke({ messages: [...] });

// User callbacks are automatically merged
await agent.invoke(
  { messages: [...] },
  {
    callbacks: [userCallback]  // Merged with AG-UI callbacks automatically
  }
);
```

**Benefits of `withConfig` approach:**
- ✅ Simpler implementation (10 lines vs 50+ line wrapper class)
- ✅ Automatic callback merging (built into LangChain)
- ✅ No manual method proxying needed
- ✅ Type-safe (returns properly typed agent)
- ✅ Same API for users (transparent)

**How `withConfig` Works:**
- `withConfig({ callbacks })` creates a `RunnableBinding` that automatically merges callbacks
- When user calls `invoke({ callbacks: [userCb] })`, LangChain merges: `[userCb, ...agUICallbacks]`
- Middleware is baked into the agent's graph structure at creation time
- `withConfig` does NOT add middleware - it only affects runtime config

**Choose `withConfig` over wrapper class for:**
- New implementations (simpler codebase)
- Projects that value type safety and built-in LangChain features
- When you don't need to customize `invoke`/`stream` behavior

---

#### 2.8 Approach B: Middleware + User-Passed Callbacks

**Description:** Returns separate middleware and callbacks; user passes callbacks to each invocation.

**Factory Signatures:**
```typescript
function createAGUISystem(options: AGUISystemOptions): {
  middleware: AgentMiddleware,
  callbacks: BaseCallbackHandler[]
}

function createAGUICallbackHandler(transport: AGUITransport): BaseCallbackHandler
```

**Implementation:**
```typescript
function createAGUISystem(options) {
  const { transport } = options;
  
  // Middleware for lifecycle & state
  const middleware = createAGUIMiddleware({ transport });
  
  // Callbacks for streaming
  const callbacks = [
    new BaseCallbackHandler({
      name: "ag-ui-streaming",
      handleLLMNewToken: async (token, idx, runId, parentRunId, tags, fields) => {
        transport.emit({
          type: "TEXT_MESSAGE_CONTENT",
          delta: token
        });
        
        const toolCallChunks = fields?.chunk?.message?.tool_call_chunks;
        toolCallChunks?.forEach(chunk => {
          transport.emit({
            type: "TOOL_CALL_ARGS",
            toolCallId: chunk.id,
            delta: chunk.args
          });
        });
      }
    })
  ];
  
  return { middleware, callbacks };
}
```

**Usage:**
```typescript
const { middleware, callbacks } = createAGUISystem({ transport });

const agent = createAgent({
  model,
  tools,
  middleware: [middleware]
});

// ⚠️ User must remember to pass callbacks
await agent.invoke(
  { messages: [...] },
  { callbacks }  // Required!
);
```

**Pros:**
- ✅ **Transparent:** Clean separation of concerns
- ✅ **Flexible:** User can add/omit callbacks per invocation
- ✅ **No wrapper overhead:** Direct API access to agent
- ✅ **Testing friendly:** Easy to test middleware and callbacks independently

**Cons:**
- ⚠️ **User friction:** Easy to forget to pass callbacks
- ⚠️ **Error-prone:** Forgetting callbacks breaks AG-UI integration
- ⚠️ **Inconsistent:** Different users might implement differently

**Maintenance Burden:** **Zero** - Pure middleware and callbacks, no wrapper code

**When to Choose:**
- Testing and development phases
- When you need per-invocation callback flexibility
- Educational/demonstration code

---

#### 2.9 Approach C: AG-UI Backend Endpoint

**Description:** Creates a server endpoint that wraps agents and exposes them via AG-UI protocol.

**Implementation:**
```typescript
import express from 'express';
import { EventEncoder } from '@ag-ui/encoder';

app.post('/ag-ui-agent', async (req, res) => {
  const { threadId, runId, messages, tools } = req.body;
  const encoder = new EventEncoder({ accept: req.headers.accept });
  
  res.setHeader('Content-Type', encoder.getContentType());
  res.write(encoder.encode({ type: 'RUN_STARTED', threadId, runId }));
  
  const agent = createAgent({ model, tools });
  const stream = await agent.stream({ messages });
  
  for await (const chunk of stream) {
    res.write(encoder.encode({
      type: 'TEXT_MESSAGE_CONTENT',
      delta: chunk
    }));
  }
  
  res.write(encoder.encode({ type: 'RUN_FINISHED', threadId, runId }));
  res.end();
});
```

**Usage:**
```typescript
// Frontend uses AG-UI client SDK
const agent = new HttpAgent({ url: 'https://api.com/agent' });
await agent.runAgent({ messages: [...] });
```

**Pros:**
- ✅ **Full AG-UI compliance:** Uses official AG-UI protocol
- ✅ **Frontend SDK compatible:** Works with `@ag-ui/client` out of box
- ✅ **Protocol control:** Complete control over transport layer
- ✅ **Multi-tenant:** Single server can serve multiple agents

**Cons:**
- ⚠️ **Server deployment:** Requires backend infrastructure
- ⚠️ **Not agent-level:** Introduces HTTP layer
- ⚠️ **Complexity:** Requires server implementation

**Maintenance Burden:** **High** - Must maintain server infrastructure

**When to Choose:**
- Enterprise deployments with existing AG-UI frontends
- Multi-tenant SaaS applications
- When you need custom transport implementations

---

### Approach Comparison Summary

| Factor | Approach A (Wrapper) | Approach B (User Callbacks) | Approach C (Backend) |
|--------|----------------------|------------------------|-----------------|
| **Plug-and-Play** | ✅ Yes | ⚠️ No (user friction) | ⚠️ No (requires server) |
| **User Friction** | ✅ Zero | ⚠️ High (must remember) | ✅ Zero (transparent) |
| **Flexibility** | ⚠️ Medium (requires wrapper updates) | ✅ High (per-invocation) | ✅ High (endpoint control) |
| **Maintenance** | ⚠️ Low (wrapper class) | ✅ Zero (pure middleware) | ⚠️ High (server) |
| **Best For** | Production apps | Testing/Dev | Enterprise deployments |

---

## 3. Core Architecture

### 3.1 Middleware Structure

```typescript
createAGUIMiddleware(options: AGUIMiddlewareOptions): AgentMiddleware
```

**Inputs:**
- Optional configuration object (persistence-safe options)

**Outputs:**
- Fully configured AgentMiddleware instance

### 3.2 Context Schema (The Driver)

The `context` is the designated location for non-serializable objects.

```typescript
contextSchema = z.object({
  transport: AGUITransport, // Live connection handle
  threadId: z.string().optional(),
  runId: z.string().optional(),
  signal: z.instanceof(AbortSignal).optional()
})
```

**Persistence Rule:**
- The `transport` object is **never** saved to checkpoints. 
- If an agent is resumed, the application must provide a new `transport` in the `invoke` context.

**Context vs Metadata for Coordination:**

- **`runtime.context`** is read-only in middleware hooks (enforced by `readonly` modifier)
- **`runtime.config.metadata`** is mutable and propagates to callbacks (see Section 2.5)
- For middleware-to-callback coordination, use `runtime.config.metadata`

### 3.3 State Schema (Persistence & Isolation)

The middleware uses state for configuration and tracking, but NOT for message/tool correlation (that's handled via metadata + callbacks).

```typescript
stateSchema = z.object({
  // Public: Persisted by checkpointer
  // Configuration options that should survive checkpoint resumption
  
  // Private: Ephemeral (prefixed with '_', not persisted)
  _stepIndex: z.number().default(0)
})
```

**Why No messageId/toolCallId in State:**

1. **Message IDs are ephemeral** - Each model invocation generates a new message boundary
2. **Persisting causes ID collisions** - On checkpoint resumption, old IDs would be reused
3. **Metadata handles coordination** - `runtime.config.metadata` passes IDs to callbacks (see Section 2.5)
4. **Callback internal state** - Callbacks store IDs in `Map<runId, messageId>` for streaming

**Isolation Rule:**
- Fields prefixed with `_` are used by the middleware for internal tracking and are filtered out of public state types using `FilterPrivateProps`.
- Public fields are for configuration that should persist across checkpoint resumption.

---

## 4. Event Mapping

### 4.1 Lifecycle Events

| AG-UI Event | Mechanism | LangChain Feature | Trigger |
|-------------|-----------|----------------|---------|
| RUN_STARTED | **Middleware** | `beforeAgent` hook | Agent invocation begins |
| RUN_FINISHED | **Middleware** | `afterAgent` hook | Agent invocation completes successfully |
| RUN_ERROR | **Middleware** | Error handling in hooks | Exception during execution |
| STEP_STARTED | **Middleware** | `beforeModel` hook | Before each model invocation |
| STEP_FINISHED | **Middleware** | `afterModel` hook | After each model invocation |

**Interrupt Handling**: When an agent is interrupted (e.g., via HITL), `afterAgent` runs **after** resumption. The middleware detects interrupts via `state.__interrupt__` and emits `RUN_FINISHED` with appropriate context.

### 4.2 Text Message Events

| AG-UI Event | Best Mechanism | LangChain Feature | Trigger |
|-------------|----------------|----------------|---------|
| TEXT_MESSAGE_START | **Middleware** | `beforeModel` hook | Model begins generating response |
| TEXT_MESSAGE_CONTENT | **Callbacks** (handleLLMNewToken) | Token-level streaming from model |
| TEXT_MESSAGE_END | **Middleware** (afterModel hook) | Model stream completes |

**Why This Split?**

| Event | Why Middleware? | Why Callbacks? |
|-------|-----------------|-------------------|
| TEXT_MESSAGE_START | Agent workflow boundary | Too early for streaming |
| TEXT_MESSAGE_CONTENT | **Cannot access tokens** | **Callbacks required** (handleLLMNewToken) |
| TEXT_MESSAGE_END | Agent workflow boundary | Fires after streaming complete |

**Streaming Implementation:**

All TEXT_MESSAGE_CONTENT events require callbacks (handleLLMNewToken). Middleware cannot access streaming tokens.

Note: All streaming events (TEXT_MESSAGE_CONTENT, TOOL_CALL_ARGS, tool lifecycle) require callbacks. Middleware has no streaming capability.

**Key Requirement:** Callbacks need access to message IDs and tool call IDs. This is achieved via:
1. **Metadata propagation**: Middleware stores messageId in `runtime.config.metadata.agui_messageId`
2. **Internal state storage**: Callbacks store IDs in `Map<runId, messageId>`
3. **Parent run correlation**: `parentRunId` links tool callbacks to LLM callbacks

See Section 2.6 for complete callback handler implementation.

**Middleware Implementation for Boundaries:**

```typescript
createMiddleware({
  name: "ag-ui-lifecycle",
   
   beforeModel: async (state, runtime) => {
     // Emit message start and set ID for callbacks
     const messageId = generateId();
     runtime.context.transport.emit({
       type: "TEXT_MESSAGE_START",
       messageId,
       role: "assistant"
     });
     
     // Store in metadata for callbacks
     runtime.config.metadata = {
       ...runtime.config.metadata,
       agui_messageId: messageId
     };
     
     return {};
   },
   
   afterModel: async (state, runtime) => {
     // Retrieve messageId from metadata
     const messageId = runtime.config.metadata?.agui_messageId;
     
     if (messageId) {
       runtime.context.transport.emit({
         type: "TEXT_MESSAGE_END",
         messageId
       });
     }
     
     // Clean up metadata
     delete runtime.config.metadata?.agui_messageId;
     
     return {};
   }
 });
```

### 4.3 Tool Call Events

| AG-UI Event | Mechanism | LangChain Feature | Trigger |
|-------------|-----------|----------------|---------|
| TOOL_CALL_START | **Callbacks** (handleToolStart) | Tool execution begins | When tool starts |
| TOOL_CALL_ARGS | **Callbacks** (handleLLMNewToken) | Streaming tool arguments | During token streaming |
| TOOL_CALL_END | **Callbacks** (handleToolEnd) | Tool execution completes | When tool finishes |
| TOOL_CALL_RESULT | **Callbacks** (handleToolEnd) | Tool output available | After tool execution |

**Why Pure Callbacks?**

| Event | Why Callbacks? |
|-------|-----------------|
| TOOL_CALL_START | Callbacks receive tool execution context via `runId` and `parentRunId` |
| TOOL_CALL_ARGS | **ONLY mechanism for streaming** - requires `handleLLMNewToken` |
| TOOL_CALL_END | Callbacks receive `output` parameter with tool result |
| TOOL_CALL_RESULT | Callbacks have `output` parameter; can link via `parentRunId` to parent message |

**Note:** All tool events use callbacks. Middleware is NOT used for tool lifecycle events, keeping implementation simpler and consistent with streaming events.

**Implementation:**

All tool lifecycle events are handled via callbacks with full context:

```typescript
class AGUICallbackHandler extends BaseCallbackHandler {
  private messageIds = new Map<string, string>();
  private toolCallIds = new Map<string, string>();
  private transport: AGUITransport;

  constructor(transport: AGUITransport) {
    super();
    this.transport = transport;
  }

  async handleToolStart(tool: Serialized, input: string, runId: string, parentRunId?: string, tags?: string[], metadata?: Record<string, unknown>): Promise<void> {
    // Extract toolCallId from stringified ToolCall input
    // Input format: {"id":"...","name":"...","args":{...}}
    let toolCallId: string | undefined;
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === 'object' && 'id' in parsed) {
        toolCallId = parsed.id;
      }
    } catch {
      toolCallId = undefined;
    }

    // Store in internal state for handleToolEnd
    if (toolCallId) {
      this.toolCallIds.set(runId, toolCallId);
    }

    // Retrieve parent messageId via parentRunId
    const messageId = this.messageIds.get(parentRunId || "");

    // Emit TOOL_CALL_START
    this.transport.emit({
      type: "TOOL_CALL_START",
      toolCallId: toolCallId || runId,
      toolCallName: tool.name,
      parentMessageId: messageId
    });
  }

  async handleToolEnd(output: string, runId: string, parentRunId?: string, tags?: string[]): Promise<void> {
    // Retrieve toolCallId from internal state
    const toolCallId = this.toolCallIds.get(runId);
    this.toolCallIds.delete(runId);

    // Retrieve parent messageId via parentRunId
    const messageId = this.messageIds.get(parentRunId || "");

    // Emit TOOL_CALL_END
    this.transport.emit({
      type: "TOOL_CALL_END",
      toolCallId: toolCallId || runId,
      parentMessageId: messageId
    });

    // Emit TOOL_CALL_RESULT
    this.transport.emit({
      type: "TOOL_CALL_RESULT",
      messageId: generateId(),
      toolCallId: toolCallId || runId,
      parentMessageId: messageId,
      content: output,
      role: "tool"
    });
  }
}
```

**Streaming Tool Arguments:**

Tool arguments are streamed via `handleLLMNewToken` using `tool_call_chunks`:

```typescript
async handleLLMNewToken(token: string, idx: NewTokenIndices, runId: string, parentRunId?: string, tags?: string[], fields?: HandleLLMNewTokenCallbackFields): Promise<void> {
  const messageId = this.messageIds.get(runId);
  if (!messageId) return;

  // Emit TEXT_MESSAGE_CONTENT
  this.transport.emit({
    type: "TEXT_MESSAGE_CONTENT",
    messageId,
    delta: token
  });

  // Emit TOOL_CALL_ARGS - ID is directly available in chunks
  const toolCallChunks = fields?.chunk?.message?.tool_call_chunks;
  toolCallChunks?.forEach(chunk => {
    if (chunk.id) {
      this.transport.emit({
        type: "TOOL_CALL_ARGS",
        toolCallId: chunk.id,
        delta: chunk.args
      });
    }
  });
}
```

**Key Requirements:**

1. **Metadata propagation**: Middleware stores `messageId` in `runtime.config.metadata.agui_messageId` (Section 2.5)
2. **Internal state storage**: Callbacks store IDs in `Map<runId, messageId>` during `handleLLMStart`
3. **Parent run correlation**: `handleToolStart` receives `parentRunId` to look up the messageId
4. **Tool result access**: `handleToolEnd` receives `output` parameter with tool result directly

See Section 2.6 for complete callback handler implementation including all event types.

### 4.4 State Management Events

| AG-UI Event | Mechanism | LangChain Feature | Trigger |
|-------------|-----------|----------------|---------|
| STATE_SNAPSHOT | **Middleware** | `beforeAgent`, `afterAgent` | Initial and final state |
| STATE_DELTA | **Middleware** | State comparison logic | State changes during execution |
| MESSAGES_SNAPSHOT | **Middleware** | `beforeAgent` | Initial message history |

**Why Middleware Only**: State management requires full access to agent state and the ability to compute JSON Patch deltas. Callbacks cannot access or modify agent state.

### 4.5 Special Events

| AG-UI Event | Mechanism | LangChain Feature | Trigger |
|-------------|-----------|----------------|---------|
| CUSTOM | **Either** | Middleware or Callbacks | Application-specific events |
| RAW | **Either** | Middleware or Callbacks | External system events passthrough |

---

## 5. Configuration System

### 5.1 Configuration Schema Validation

**Package Responsibility:** All middleware options are validated using Zod schemas to ensure type safety and prevent runtime errors.

**Schema Definition:**
```typescript
import { z } from 'zod';

export const AGUIMiddlewareOptionsSchema = z.object({
  // Transport (required)
  transport: z.custom<AGUITransport>((val) => val && typeof val.emit === 'function'),

  // Event control
  emitToolResults: z.boolean().default(true),
  emitStateSnapshots: z.enum(['initial', 'final', 'all', 'none']).default('initial'),
  emitActivities: z.boolean().default(false),

  // Smart Emission Policy
  maxUIPayloadSize: z.number().positive().default(50 * 1024), // 50KB
  chunkLargeResults: z.boolean().default(false),

  // Session Override
  threadIdOverride: z.string().optional(),
  runIdOverride: z.string().optional(),

  // Error Handling
  errorDetailLevel: z.enum(['full', 'message', 'code', 'none']).default('message')
});
```

**Usage:**
```typescript
export function createAGUIMiddleware(options: AGUIMiddlewareOptions): AgentMiddleware {
  // ✅ Package validates all options at creation time
  const validated = AGUIMiddlewareOptionsSchema.parse(options);
  // ... implementation
}
```

### 5.2 Configuration Options

```typescript
interface AGUIMiddlewareOptions {
  // Transport (required)
  transport: AGUITransport;              // Live connection handle for event emission

  // Event control
  emitToolResults?: boolean;            // Default: true
  emitStateSnapshots?: "initial" | "final" | "all" | "none";
  emitActivities?: boolean;             // Default: false (activities are UI-only)

  // Smart Emission Policy
  maxUIPayloadSize?: number;           // Max bytes for TOOL_CALL_RESULT (Default: 50KB)
  chunkLargeResults?: boolean;         // Whether to split large payloads into chunks

  // Session Override
  threadIdOverride?: string;           // Override LangGraph thread_id
  runIdOverride?: string;             // Override LangGraph run_id

  // Error Handling
  errorDetailLevel?: "full" | "message" | "code" | "none";
}
```

### 5.2 Configuration Sources (Priority Order)

1. **Runtime configurable**: Highest priority, passed per-invocation (e.g., `agent.invoke(input, { configurable: { thread_id: "t1" } })`)
2. **Runtime context**: Second priority, passed per-invocation (e.g., `agent.invoke(input, { context: { transport, threadId } })`)
3. **Middleware options**: Lowest priority, set at middleware creation via `createAGUIMiddleware()`

### 5.3 Configuration Access Pattern

```typescript
beforeAgent: async (state, runtime) => {
  // Access configurable (LangGraph's config)
  const threadId = runtime.configurable?.thread_id;
  const runId = runtime.configurable?.run_id;
  
  // Access context (runtime context schema)
  const transport = runtime.context?.transport;
  const contextThreadId = runtime.context?.threadId;
  
  // Apply priority: configurable > context > options
  const finalThreadId = threadId || contextThreadId || options.threadIdOverride;
}
```

---

## 6. Transport Interface

### 6.1 Core Interface

**Note:** This `AGUITransport` interface is a custom abstraction defined by this middleware, **not** part of the AG-UI protocol specification. The AG-UI protocol defines the event format and types, but leaves transport mechanisms implementation-defined. This interface provides a simple abstraction for event emission that works with any transport mechanism (SSE, WebSocket, EventEmitter, etc.).

```typescript
/**
 * Transport interface for AG-UI event emission.
 * 
 * This is a custom abstraction layer - the AG-UI protocol defines event
 * formats (TEXT_MESSAGE_START, TOOL_CALL_ARGS, etc.) but does not mandate
 * a specific transport interface. This interface provides a simple,
 * portable way to emit events that works with any backend transport.
 */
interface AGUITransport {
  /**
   * Emit an AG-UI protocol event.
   * @param event - The event to emit (must conform to AG-UI event schema)
   */
  emit(event: AGUIEvent): void;
  
  // Optional connection lifecycle methods (implementations may omit these)
  connect?(): Promise<void>;
  disconnect?(): void;
  isConnected?(): boolean;
}
```

**Usage Examples:**

```typescript
// 1. EventEmitter (for testing/in-memory)
const emitter = new EventEmitter();
const transport: AGUITransport = {
  emit: (event) => emitter.emit('ag-ui-event', event)
};

// 2. Custom SSE implementation
const sseTransport: AGUITransport = {
  emit: (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
};

// 3. WebSocket transport
const wsTransport: AGUITransport = {
  emit: (event) => {
    ws.send(JSON.stringify(event));
  }
};

// 4. AG-UI protocol encoder (for server-side streaming)
import { EventEncoder } from '@ag-ui/encoder';
const encoder = new EventEncoder({ accept: req.headers.accept });
const protocolTransport: AGUITransport = {
  emit: (event) => {
    res.write(encoder.encode(event));
  }
};
```

**Why a Custom Interface?**

1. **Abstraction Level**: The middleware instruments agents (producing events), while AG-UI's `AbstractAgent` is for consuming events (client-side). These are opposite directions.
2. **Simplicity**: A minimal `emit(event)` interface is sufficient for middleware purposes.
3. **Flexibility**: Users can wrap any transport (SSE, WebSocket, database, logging) without implementing a full agent.
4. **Protocol Compliance**: The actual AG-UI event formats are enforced by the event types we emit, not by the transport interface.

**For Full AG-UI Protocol Compliance:**

If you need a complete AG-UI protocol server (not just middleware), consider using the AG-UI SDK's `AbstractAgent` pattern instead:

```typescript
import { AbstractAgent } from '@ag-ui/client';

class LangChainBackendAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    // Wrap your LangChain agent and emit events
    return new Observable(subscriber => {
      // Full protocol implementation
    });
  }
}
```

### 6.2 Built-in Transport Implementations

#### A. Server-Sent Events (SSE) Transport
- ✅ **Proper SSE Headers**: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- ✅ **Fail-Safe Emission**: All writes wrapped in try-catch, never throws on client disconnect
- ✅ **Abort Signal Integration**: Propagates client disconnects to agent for cancellation
- ✅ **Backpressure Handling**: Queue-based emission with async draining

**Implementation:**
```typescript
import { IncomingMessage, ServerResponse } from 'http';

export interface SSETransport extends AGUITransport {
  signal: AbortSignal;
}

export function createSSETransport(req: IncomingMessage, res: ServerResponse): SSETransport {
  // ✅ Set proper SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // ✅ Abort signal for client disconnect handling
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  // ✅ Backpressure queue
  const queue: AGUIEvent[] = [];
  let draining = false;

  async function drain(): Promise<void> {
    draining = true;
    while (queue.length > 0 && res.writable) {
      const event = queue.shift()!;
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        break; // Client disconnected, stop draining
      }
    }
    draining = false;
  }

  return {
    emit: (event: AGUIEvent) => {
      queue.push(event);
      if (!draining) drain();
    },

    signal: controller.signal,

    disconnect: () => {
      res.end();
    }
  };
}
```

**Usage with Abort Signal:**
```typescript
const sseTransport = createSSETransport(req, res);

// Pass signal to agent for cancellation on client disconnect
await agent.invoke(input, {
  context: { transport: sseTransport },
  signal: sseTransport.signal
});
```

#### B. WebSocket Transport
- Full-duplex communication
- Message queuing during disconnects
- Connection state management
- Protocol framing

#### C. HTTP Streaming Transport
- Long-polling fallback
- Chunked transfer encoding
- Connection timeout handling

### 6.3 Custom Transport Support
Users can implement their own transport:
- Database event persistence
- Message queue integration
- Cloud event services
- Custom protocols

---

## 7. Session Management

### 7.1 Session Identifiers

**threadId (Source of Truth)**
1. Uses `runtime.configurable.thread_id` from LangChain by default (accessed in middleware hooks via `runtime.configurable`).
2. Uses `threadIdOverride` from options if provided.
3. Uses `context.threadId` as third priority (runtime context schema).

**runId**
1. Uses `runtime.configurable.run_id` from LangChain by default.
2. Uses `context.runId` as override (runtime context schema).

**Access Pattern in Middleware Hooks:**
```typescript
beforeAgent: async (state, runtime) => {
  const threadId = runtime.configurable?.thread_id 
    || options.threadIdOverride 
    || runtime.context?.threadId;
  const runId = runtime.configurable?.run_id 
    || runtime.context?.runId;
  // ...
}
```

**Why `runtime.configurable`**: LangChain injects configurable values (like `thread_id` and `run_id`) into the `Runtime` object's `configurable` property, not directly into the context schema.

### 7.2 Multi-Session Support
- Single middleware instance handles multiple concurrent sessions
- Context isolation per invocation
- No state leakage between sessions
- Efficient resource utilization

---

## 8. Error Handling Architecture

### 8.1 Fail-Safe Barrier
The middleware operates under a "Silent UI Failure" policy.
- All transport emissions must be wrapped in `try/catch`.
- Callbacks configured with `raiseError: false` (enforced).
- **Constraint:** A failure in emitting a UI event (e.g., transport disconnected) **must never** throw an error that interrupts the Agent's core reasoning loop.

**Package-Required Implementation:**
```typescript
// ✅ AGUICallbackHandler enforces fail-safe behavior
super({ raiseError: false });

// ✅ All transport writes are fail-safe
emit: (event: AGUIEvent) => {
  try {
    if (res.writable) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch {
    // Client disconnected - fail-safe, never throw
  }
}
```

### 8.2 Guaranteed Event Cleanup

**Critical Issue:** Middleware's `afterAgent` hook only runs on successful completion. If agent errors mid-execution, messages can be left in `TEXT_MESSAGE_START` state without `TEXT_MESSAGE_END`.

**Package Solution:** Use `withListeners` for guaranteed cleanup on both success and error.

**Implementation:**
```typescript
export function createAGUIAgent(config: AGUIAgentConfig) {
  let activeMessageId: string | undefined;

  const agent = createAgent({
    model: config.model,
    tools: config.tools,
    middleware: [createAGUIMiddleware({ transport: config.transport })]
  });

  // ✅ Guaranteed cleanup on both success and error
  return agent.withListeners({
    onEnd: (run) => {
      if (activeMessageId) {
        config.transport.emit({
          type: "TEXT_MESSAGE_END",
          messageId: activeMessageId
        });
      }
    },
    onError: (run) => {
      // ✅ Ensures cleanup even when agent fails
      if (activeMessageId) {
        config.transport.emit({
          type: "TEXT_MESSAGE_END",
          messageId: activeMessageId
        });
      }
    }
  });
}
```

**Why This Matters:**
- Agent errors (model failures, tool errors, timeouts) halt execution before `afterAgent` runs
- `withListeners({ onError })` guarantees cleanup regardless of failure mode
- Orphaned `TEXT_MESSAGE_START` events cause UI inconsistencies

### 8.2 Error Event Mapping

| Error Type | AG-UI Event | Content |
|------------|-------------|---------|
| Agent Error | RUN_ERROR | Message, code, stack (configurable) |
| Middleware Error | RUN_ERROR + log | Internal error handling |
| Transport Error | Connection events | Reconnection logic |
| Frontend Error | RAW/CUSTOM | Passthrough for debugging |

**Error Event Examples:**

```typescript
afterAgent: async (state, runtime) => {
  if (state.error) {
    runtime.context.transport.emit({
      type: "RUN_ERROR",
      message: state.error.message,
      code: "AGENT_EXECUTION_ERROR"
    });
  }
}
```

```typescript
wrapModelCall: async (request, handler) => {
  try {
    return await handler(request);
  } catch (error) {
    runtime.context.transport.emit({
      type: "RUN_ERROR",
      message: error.message,
      code: "MODEL_INVOCATION_ERROR"
    });
    throw error;
  }
}
```

### 8.3 Error Isolation
- Middleware errors don't crash agent execution
- Agent errors don't break event emission
- Transport errors trigger graceful degradation
- Error events are guaranteed even on failure

### 8.4 Error Detail Levels

**Level 1: Code Only**
```
{ type: "RUN_ERROR", code: "TIMEOUT" }
```

**Level 2: Message**
```
{ type: "RUN_ERROR", message: "Model invocation timed out after 30s" }
```

**Level 3: Full**
```
{ type: "RUN_ERROR", message: "Model invocation timed out", code: "TIMEOUT", stack: "..." }
```

---

## 9. Performance: Smart Emission Policy

### 9.1 Middleware Capabilities (wrapModelCall)

`wrapModelCall` intercepts model invocations but **cannot access streaming tokens**. It is useful for:

- Error handling around model calls
- Logging and instrumentation
- Request/response transformation
- Fallback logic for non-streaming models

**Implementation:**

```typescript
wrapModelCall: async (request, handler) => {
  try {
    return await handler(request);
  } catch (error) {
    // Error handling for model invocation
    throw error;
  }
}
```

**Note:** All streaming (TEXT_MESSAGE_CONTENT, TOOL_CALL_ARGS) requires callbacks.

**Why This Approach:**

- **Single Middleware**: Coordinates callbacks for all streaming events
- **Zero User Configuration**: Callbacks auto-injected via wrapper or context
- **Transparent**: Works with any agent configuration without changes
- **Fallback**: Gracefully degrades for non-streaming models

### 9.2 Tool Call Events

All tool lifecycle events (START, END, RESULT) are handled via callbacks. See Section 4.3 for complete implementation details.

**Note:** Middleware's `wrapToolCall` is NOT used for tool events to keep implementation simpler. Callbacks provide everything needed via `runId`, `parentRunId`, and `output` parameters.

### 9.3 Stability vs. UX
The middleware distinguishes between what the **Agent** needs and what the **UI** can handle.

**1. Chunking for Stability**
If a payload (like a tool result) is large but `chunkLargeResults` is enabled, the middleware will split the string into `TOOL_CALL_CHUNK` events. This prevents transport buffer overflows.

**2. Truncation for UX**
If `maxUIPayloadSize` is exceeded:
- The **Agent** receives the full, original result (no data loss for reasoning).
- The **UI** receives a `TOOL_CALL_RESULT` containing a truncated version or a metadata summary (e.g., `"[Truncated: 1.2MB of JSON data]"`).

---

## 9.5 Package vs Developer Responsibilities

**Philosophy:** We own LangChain.js integration and AG-UI protocol compliance. Developers own their application architecture.

### Package Responsibilities (Must Provide)
| **Concern** | **Package Action** | **Why** |
|-------------|-----------------|------|
| ✅ Memory cleanup | `AGUICallbackHandler.dispose()` | Internal Maps grow unbounded |
| ✅ Fail-safe emission | Try-catch + `res.writable` check | Prevents transport errors from crashing agents |
| ✅ Guaranteed cleanup | `withListeners({ onError, onEnd })` | `afterAgent` doesn't run on errors |
| ✅ Schema validation | Zod validation at creation time | Type safety, early error detection |
| ✅ Event completeness | Ensure start/end pairs | Prevents orphaned message states |
| ✅ SSE headers | Proper headers in `createSSETransport()` | Correct client connection |
| ✅ Abort handling | Propagate signal to agent | Client disconnect cancels execution |
| ✅ Built-in transports | Robust SSE/WebSocket implementations | Production-ready defaults |

### Developer Responsibilities (Not Our Job)
| **Concern** | **Developer Action** | **Why** |
|-------------|-------------------|------|
| ❌ Concurrency serialization | Serialize invocations per `thread_id` | Same-thread concurrent calls cause races |
| ❌ Thread lifecycle | Manage `thread_id` creation/expiration | Package is thread-agnostic |
| ❌ Manual callback lifecycle | Call `dispose()` when done | Own callback instances |
| ❌ Application retry logic | Wrap `agent.invoke()` in retry loops | Package doesn't dictate retry policy |
| ❌ Custom transport bugs | Debug own transport implementations | Package only provides interface |
| ❌ Application monitoring | Hook into our events | No built-in metrics/observability |
| ❌ Network reordering | Buffer events in client/transport | Package emits in order |
| ❌ Session timeouts | Manage idle connection cleanup | Package doesn't track session state |

**Key Principle:** If it affects how LangChain.js works with AG-UI protocol, it's our job. If it's about how developers structure their application, it's their job.

---

## 10. Compatibility Guarantees

### 10.1 LangChain.js Compatibility
- Works with all LangChain.js agent types
- Compatible with any LLM implementation
- Supports any tool configuration
- No dependencies beyond core LangChain.js

### 10.2 AG-UI Protocol Compatibility
- Full support for all finalized event types
- Draft event support (when finalized)
- Backward compatibility maintained

### 10.3 Frontend Compatibility
- Works with any AG-UI compliant frontend
- No frontend code changes required
- Standard event format
- Protocol-version agnostic

### 10.4 Breaking Changes Policy
- Major version bumps only for breaking changes
- Deprecation warnings
- Backward compatibility for 2 major versions
- Clear documentation

---

## 11. API Surface

### 11.1 Main Factory Function

```typescript
// Primary factory function
createAGUIMiddleware(options?: AGUIMiddlewareOptions): AgentMiddleware
```

**Usage:**
```typescript
const agent = createAgent({
  model,
  tools,
  middleware: [createAGUIMiddleware({
    transport: sseTransport,
    errorDetailLevel?: "full" | "message" | "code" | "none"
  })]
});
```

### 11.2 Transport Factory Functions

```typescript
// Built-in transports
createSSETransport(options?: SSETransportOptions): AGUITransport
createWebSocketTransport(options?: WebSocketTransportOptions): AGUITransport
createHTTPTransport(options?: HTTPTransportOptions): AGUITransport
```

### 11.3 Event Types

```typescript
// Event type enums
enum EventType { /* all AG-UI event types */ }

// Event interfaces
interface RunStartedEvent { /* ... */ }
interface RunFinishedEvent { /* ... */ }
interface TextMessageContentEvent { /* ... */ }
// ... all event interfaces
```

### 11.4 Configuration Types

```typescript
interface AGUIMiddlewareOptions { /* ... */ }
interface AGUIMiddlewareContext { /* ... */ }
interface PerformanceOptions { /* ... */ }
```

---

## 12. Usage Patterns

### 12.1 Setup Examples

```typescript
// Minimal setup (zero configuration)
const agent = createAgent({
  model,
  tools,
  middleware: [createAGUIMiddleware({ transport: sseTransport })]
});

// Customized setup (transport and error detail)
const agent2 = createAgent({
  model,
  tools,
  middleware: [createAGUIMiddleware({
    transport: customTransport,
    errorDetailLevel: "message"
  })]
});

// Debug setup (console transport, full error details)
const agent3 = createAgent({
  model,
  tools,
  middleware: [createAGUIMiddleware({
    transport: consoleTransport,
    errorDetailLevel: "full"
  })]
});
```

### 12.2 Multi-Client Setup
```typescript
// Create middleware with default transport
const middleware = createAGUIMiddleware({
  transport: baseTransport
});

const agent = createAgent({
  model,
  tools,
  middleware: [middleware]
});

// Invoke with different transports per client via context
await agent.invoke(
  { messages: [{ role: "user", content: "Hello" }] },
  {
    configurable: { thread_id: "t1", run_id: "r1" },
    context: { transport: client1Transport }
  }
);

await agent.invoke(
  { messages: [{ role: "user", content: "Hello again" }] },
  {
    configurable: { thread_id: "t1", run_id: "r2" },
    context: { transport: client2Transport }
  }
);
```

### 12.3 Streaming Text Response
```typescript
const stream = await agent.stream(
  { messages: [{ role: "user", content: "Hello" }] },
  {
    configurable: { thread_id: "session-123" },
    context: { transport: sseTransport }
  }
);

// Callbacks emit TEXT_MESSAGE_CONTENT events during streaming
```

---
