# TechSpec.md - Technical Specification

## @skroyc/ag-ui-middleware-callbacks

---

## 1. Stack Specification

### Runtime & Build

| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Bun / Node.js | bun >=1.0.0 / node >=20.0.0 |
| Language | TypeScript | 5.x |
| Build | tsup | 8.x |
| Output | ESM Only | - |

### Dependencies

| Package | Purpose | Type |
|---------|---------|------|
| @ag-ui/core | Event types & validation schemas | Dependency |
| @langchain/core | LangChain integration | Dependency |
| langchain | Agent runtime | Peer (1.2.3) |
| zod | Configuration validation | Dependency (^4.3.6) |
| fast-json-patch | JSON Patch for state deltas | Dependency |

---

## 2. Architecture Decision Records

### ADR 1: Hybrid Middleware + Callbacks

**Context:** LangChain separates middleware (lifecycle/state) from callbacks (streaming). No unified mechanism exists.

**Decision:** Use both mechanisms - middleware for lifecycle/state/activity events, callbacks for streaming events.

**Consequences:**
- Two event sources require careful ordering
- Developer must understand both mechanisms
- More complex than unified handler (not possible)

### ADR 2: Event Type Compliance

**Context:** AG-UI protocol defines 26 event types. The package must emit exactly these types.

**Decision:** Re-export event types from `@ag-ui/core` rather than defining custom types.

**Consequences:**
- Strict compliance with protocol
- Updates to `@ag-ui/core` may require package updates
- No custom event types except CUSTOM

### ADR 3: Configuration via Zod

**Context:** Package needs validation for user-provided configuration.

**Decision:** Use Zod schema validation with sensible defaults.

**Consequences:**
- Runtime validation catches errors early
- Schema can be introspected
- Additional dependency required

---

## 3. API Contracts

### 3.1 createAGUIMiddleware

```typescript
/**
 * Creates AG-UI protocol middleware for LangChain agents.
 * 
 * @param options - Middleware configuration options
 * @returns Middleware instance for use with createAgent()
 */
function createAGUIMiddleware(
  options: AGUIMiddlewareOptions
): ReturnType<typeof createMiddleware>;
```

**Options:**

```typescript
interface AGUIMiddlewareOptions {
  /** Required: Event callback function */
  onEvent: (event: BaseEvent) => void;
  
  /** When to emit state snapshots: "initial" | "final" | "all" | "none" */
  emitStateSnapshots?: "initial" | "final" | "all" | "none";
  
  /** Emit activity events */
  emitActivities?: boolean;
  
  /** Maximum payload size in bytes (default: 50KB) */
  maxUIPayloadSize?: number;
  
  /** Chunk large tool results */
  chunkLargeResults?: boolean;
  
  /** Override thread ID */
  threadIdOverride?: string;
  
  /** Override run ID */
  runIdOverride?: string;
  
  /** Error detail level: "full" | "message" | "code" | "none" */
  errorDetailLevel?: "full" | "message" | "code" | "none";
  
  /** Custom state mapper */
  stateMapper?: (state: any) => any;
  
  /** Custom result mapper */
  resultMapper?: (result: any) => any;
  
  /** Custom activity mapper */
  activityMapper?: (node: any) => any;
  
  /** Validate events against @ag-ui/core schemas */
  validateEvents?: boolean | "strict";
}
```

### 3.2 createAGUIAgent

```typescript
/**
 * Creates a LangChain agent with integrated AG-UI protocol support.
 * 
 * @param config - Agent configuration
 * @returns Configured agent with middleware and callbacks
 */
function createAGUIAgent<
  State extends AgentState = AgentState,
  Context extends AgentContext = AgentContext,
  Response extends AgentResponse = AgentResponse
>(config: AGUIAgentConfig<State, Context, Response>): any;
```

**Config:**

```typescript
interface AGUIAgentConfig<
  State extends AgentState = AgentState,
  Context extends AgentContext = AgentContext,
  Response extends AgentResponse = AgentResponse
> {
  /** LangChain model */
  model: any;
  
  /** Agent tools */
  tools?: any[];
  
  /** Event callback (required) */
  onEvent: (event: BaseEvent) => void;
  
  /** Callback handler options */
  callbackOptions?: AGUICallbackHandlerOptions;
  
  /** Middleware options */
  middlewareOptions?: Partial<AGUIMiddlewareOptions>;
  
  /** Other createAgent options */
  [key: string]: any;
}
```

### 3.3 AGUICallbackHandler

```typescript
/**
 * Callback handler for streaming AG-UI events.
 * Extends LangChain's BaseCallbackHandler.
 */
class AGUICallbackHandler extends BaseCallbackHandler {
  constructor(options: AGUICallbackHandlerOptions);

  /**
   * Emit a text message chunk directly.
   * Expands to TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT, TEXT_MESSAGE_END.
   */
  emitTextChunk(messageId: string, role: string, delta: string): void;

  /**
   * Emit a tool call chunk directly.
   * Expands to TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END.
   */
  emitToolChunk(toolCallId: string, toolCallName: string, delta: string, parentMessageId?: string): void;

  /**
   * Clean up handler resources.
   */
  dispose(): void;
}
```

**Options:**

```typescript
interface AGUICallbackHandlerOptions {
  /** Event callback (required) */
  onEvent: (event: BaseEvent) => void;
  
  /** Enable/disable handler */
  enabled?: boolean;
  
  /** Emit text message events */
  emitTextMessages?: boolean;
  
  /** Emit tool call events */
  emitToolCalls?: boolean;
  
  /** Emit tool results */
  emitToolResults?: boolean;
  
  /** Emit thinking/reasoning events */
  emitThinking?: boolean;
  
  /** Reasoning mode: "thinking" (legacy) or "reasoning" (modern) */
  reasoningEventMode?: "thinking" | "reasoning";
  
  /** Maximum payload size */
  maxUIPayloadSize?: number;
  
  /** Chunk large results */
  chunkLargeResults?: boolean;
}
```

---

## 4. Event Type Definitions

### Event Source Mapping

Each AG-UI event is emitted via a specific LangChain mechanism:

**Middleware Hooks:**
- `beforeAgent` → RUN_STARTED
- `afterAgent` → RUN_FINISHED, RUN_ERROR
- `beforeModel` → STEP_STARTED, ACTIVITY_SNAPSHOT
- `afterModel` → STEP_FINISHED, ACTIVITY_DELTA

**Callbacks:**
- `handleLLMStart` → TEXT_MESSAGE_START, REASONING_START
- `handleLLMNewToken` → TEXT_MESSAGE_CONTENT
- `handleLLMEnd` → TEXT_MESSAGE_END
- `handleToolStart` → TOOL_CALL_START, TOOL_CALL_ARGS
- `handleToolEnd` → TOOL_CALL_END, TOOL_CALL_RESULT
- `handleToolError` → TOOL_CALL_ERROR
- `handleChainStart` → CHAIN_STARTED
- `handleChainEnd` → CHAIN_FINISHED
- `handleChainError` → CHAIN_ERROR

### Implemented Events

> **Note:** Per latest AG-UI skill, REASONING_* events are the NEW standard that replaces deprecated THINKING_* events. Both are implemented for backward compatibility.

| Event Type | Source | Payload |
|------------|--------|---------|
| RUN_STARTED | Middleware | `{ threadId, runId, parentRunId?, input }` |
| RUN_FINISHED | Middleware | `{ threadId, runId, result? }` |
| RUN_ERROR | Middleware | `{ message, code? }` |
| STEP_STARTED | Middleware | `{ stepName }` |
| STEP_FINISHED | Middleware | `{ stepName }` |
| TEXT_MESSAGE_START | Callback | `{ messageId, role }` |
| TEXT_MESSAGE_CONTENT | Callback | `{ messageId, delta }` |
| TEXT_MESSAGE_END | Callback | `{ messageId }` |
| TEXT_MESSAGE_CHUNK | Callback | `{ messageId, content, role }` |
| TOOL_CALL_START | Callback | `{ toolCallId, toolCallName, parentMessageId? }` |
| TOOL_CALL_ARGS | Callback | `{ toolCallId, delta }` |
| TOOL_CALL_END | Callback | `{ toolCallId }` |
| TOOL_CALL_RESULT | Callback | `{ messageId, toolCallId, content, role? }` |
| TOOL_CALL_CHUNK | Callback | `{ toolCallId, name, args, id? }` |
| STATE_SNAPSHOT | Middleware | `{ snapshot }` |
| MESSAGES_SNAPSHOT | Middleware | `{ messages }` |
| ACTIVITY_SNAPSHOT | Middleware | `{ messageId, activityType, content, replace? }` |
| ACTIVITY_DELTA | Middleware | `{ messageId, activityType, patch }` |
| REASONING_START | Callback | `{ messageId }` |
| REASONING_MESSAGE_START | Callback | `{ messageId, role }` |
| REASONING_MESSAGE_CONTENT | Callback | `{ messageId, delta }` |
| REASONING_MESSAGE_END | Callback | `{ messageId }` |
| REASONING_END | Callback | `{ messageId }` |

### Missing Events - Future Implementation

> **Note:** Per latest AG-UI skill, STATE_DELTA and RAW are stable events in the protocol. THINKING_* events are deprecated (use REASONING_* instead). Chain events require handleChain* callbacks which are not yet standardized in LangChain.

| Event Type | Purpose | Priority |
|------------|---------|----------|
| STATE_DELTA | JSON Patch for incremental state | High |
| RAW | Passthrough events | Low |
| REASONING_MESSAGE_CHUNK | Convenience chunk for reasoning | Medium |
| REASONING_ENCRYPTED_VALUE | Encrypted chain-of-thought | Low |
| TOOL_CALL_ERROR | Tool execution error | Medium |
| CHAIN_STARTED | Chain started | Low |
| CHAIN_FINISHED | Chain finished | Low |
| CHAIN_ERROR | Chain error | Low |
| THINKING_START | Deprecated: use REASONING_START | Deprecated |
| THINKING_TEXT_MESSAGE_START | Deprecated: use REASONING_MESSAGE_START | Deprecated |
| THINKING_TEXT_MESSAGE_CONTENT | Deprecated: use REASONING_MESSAGE_CONTENT | Deprecated |
| THINKING_TEXT_MESSAGE_END | Deprecated: use REASONING_MESSAGE_END | Deprecated |
| THINKING_END | Deprecated: use REASONING_END | Deprecated |
---

## 5. Project Structure
```
src/
├── callbacks/
│   └── AGUICallbackHandler.ts    # Streaming event handler
├── events/
│   └── index.ts                  # Re-export @ag-ui/core types
├── middleware/
│   ├── createAGUIMiddleware.ts   # Middleware factory
│   ├── idResolution.ts           # Thread/run ID resolution
│   └── types.ts                  # Middleware types & Zod schema
├── utils/
│   ├── cleaner.ts                # Data cleaning utilities
│   ├── eventNormalizer.ts        # Event transformation
│   ├── idGenerator.ts            # ID generation
│   ├── messageMapper.ts          # LangChain → AG-UI message mapping
│   ├── reasoningBlocks.ts       # Reasoning event handling
│   ├── stateDiff.ts              # State delta computation
│   └── validation.ts            # Event validation
├── createAGUIAgent.ts           # Unified factory
└── index.ts                     # Public exports
```

---

## 6. Configuration Schema (Zod)

```typescript
// Middleware options schema
const AGUIMiddlewareOptionsSchema = z.object({
  onEvent: z.custom<(event: BaseEvent) => void>(),
  emitStateSnapshots: z.enum(["initial", "final", "all", "none"]).default("initial"),
  emitActivities: z.boolean().default(false),
  maxUIPayloadSize: z.number().positive().default(50 * 1024),
  chunkLargeResults: z.boolean().default(false),
  threadIdOverride: z.string().optional(),
  runIdOverride: z.string().optional(),
  errorDetailLevel: z.enum(["full", "message", "code", "none"]).default("message"),
  stateMapper: z.custom<(state: any) => any>().optional(),
  resultMapper: z.custom<(result: any) => any>().optional(),
  activityMapper: z.custom<(node: any) => any>().optional(),
  validateEvents: z.union([z.boolean(), z.literal("strict")]).default(false),
});
```

---

## 7. Implementation Guidelines

### Event Emission Order

1. Middleware events always emit before callback events for same operation
2. Lifecycle: RUN_STARTED → STEP_STARTED → [model] → STEP_FINISHED → RUN_FINISHED
3. Streaming: START → CONTENT* → END

### Error Handling

- Middleware: Try-catch in every hook, emit RUN_ERROR on failure
- Callbacks: Return Promise, errors logged but not thrown
- Transport: Fail-silent, never crash agent

### Validation

- Events validated against @ag-ui/core schemas when `validateEvents: true`
- Strict mode throws on invalid events
- Default: No validation for performance
