# SPEC V2: @skroyc/acp-middleware-callbacks

## Table of Contents

1. [Overview](#1-overview)
2. [Requirements](#2-requirements)
3. [Architecture](#3-architecture)
4. [Middleware Implementation](#4-middleware-implementation)
5. [Callback Handler Implementation](#5-callback-handler-implementation)
6. [Content Block Mapping](#6-content-block-mapping)
7. [Session Update Types](#7-session-update-types)
8. [Error Handling & stopReason Mapping](#8-error-handling--stopreason-mapping)
9. [MCP Tool Loader](#9-mcp-tool-loader)
10. [Appendix: LangChain Type Reference](#10-appendix-langchain-type-reference)
11. [Example Usage](#11-example-usage)
12. [Protocol Stability Indicators](#12-protocol-stability-indicators)
13. [Summary: Scope Decision Matrix](#13-summary-scope-decision-matrix)

---

## 1. Overview

### 1.1 Purpose

This package provides **LangChain middleware and callbacks** that bridge LangChain `createAgent()` implementations to the **Agent Client Protocol (ACP)** for code editors and AI development environments.

**Core Responsibilities:**
- **Middleware:** Lifecycle hooks for session management, tool execution, and permission handling
- **Callbacks:** Streaming event emission for real-time agent updates
- **Utilities:** Content block mappers for LangChain ↔ ACP format conversion

**What this package is NOT:**
- It does NOT provide transport layer (use `@agentclientprotocol/sdk` directly)
- It does NOT provide stdio transport implementation
- It does NOT implement the Agent interface (developer responsibility)

### 1.2 Scope Boundary

```
┌─────────────────────────────────────────────────────────────────┐
│                      LangChain Agent (createAgent)               │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐   │
│  │ Core Agent  │   │  Model Calls│   │   Tool Execution    │   │
│  │   Logic     │──▶│             │──▶│                     │   │
│  └─────────────┘   └─────────────┘   └─────────────────────┘   │
└────────────────────────────┬──────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │ ACP Middleware  │  ← THIS PACKAGE
                    │   + Callbacks   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   @agentclientprotocol/sdk   │  ← SDK PROVIDES TRANSPORT
                    │   (AgentSideConnection)      │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ ACP Client      │
                    │ (Editor)        │
                    └─────────────────┘
```

### 1.3 Protocol Overview

ACP is a protocol standardizing editor-to-agent communication with:
- **Structured session management:** `newSession`, `prompt`, `loadSession`
- **Permission-based tool execution:** `requestPermission` workflow
- **Rich content blocks:** text, image, audio, resources
- **Standardized updates:** `sessionUpdate` notifications
- **Bidirectional communication:** JSON-RPC 2.0 over stdio (handled by SDK)

### 1.4 Key Differences from AG-UI

This package shares architectural patterns with `@skroyc/ag-ui-middleware-callbacks` but is fundamentally different:

| Aspect | AG-UI | ACP |
|--------|-------|-----|
| Communication | Backend → Frontend event streaming | Editor ↔ Agent bidirectional |
| Transport | SSE/WebSocket | Stdio with JSON-RPC 2.0 |
| Session State | No built-in session management | Full session lifecycle |
| Permission Flow | No built-in support | `requestPermission` workflow |
| Content Model | Events-based | Content blocks with annotations |

### 1.5 LangChain Integration

This package works with **LangChain v1.0.0+** which uses LangGraph under the hood:

- `createAgent()`: High-level API that compiles a StateGraph with middleware support
- `thread_id`: Session identifier via `configurable.thread_id` for checkpoint retrieval
- **Checkpoint:** Persisted state snapshot containing messages, custom state, and middleware state
- **Checkpointer:** Storage backend (e.g., `MemorySaver`, database) for checkpoints

### 1.6 Version Compatibility

| Component | Version | Notes |
|-----------|---------|-------|
| **LangChain** | ^1.0.0 | Middleware API introduced in v1.0.0 |
| **@langchain/core** | ^1.1.0 | Content block system required |
| **@agentclientprotocol/sdk** | ^0.12.0 | Current stable version |
| **Node.js** | >=18.0.0 | Universal runtime minimum |
| **TypeScript** | >=5.0.0 | Strict mode required |
| **ACP Protocol** | v1 | Current stable version |

**Note:** SDK version is `^0.12.0`, NOT `^1.0.0` (which doesn't exist yet).

---

## 2. Requirements

### 2.1 Core Requirements

| Requirement | Description |
|-------------|-------------|
| **Middleware API** | Must integrate with `createMiddleware()` from LangChain |
| **Callback Handler** | Must extend `BaseCallbackHandler` from LangChain |
| **Content Mapping** | Must provide bidirectional LangChain ↔ ACP content block mapping |
| **Session State** | Must track sessionId per prompt, toolCallId per tool |
| **Permission Flow** | Must support HITL via `afterModel` hook with `interrupt()` |
| **Mode Support** | Must handle mode switching with full logic |

### 2.2 Functional Requirements

- Convert LangChain callback events to ACP `sessionUpdate` notifications
- Provide session middleware that extracts sessionId from config/context
- Provide tool middleware that emits `tool_call` and `tool_call_update` events
- Provide permission middleware that intercepts via `afterModel` hook
- Provide mode middleware that handles `current_mode_update` events
- Provide content block mapper (bidirectional: LangChain ↔ ACP)
- Provide stopReason mapper (LangChain state → ACP stopReason)

---

## 3. Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      LangChain Agent (createAgent)               │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐   │
│  │ Core Agent  │   │  Model Calls│   │   Tool Execution    │   │
│  │   Logic     │──▶│             │──▶│                     │   │
│  └─────────────┘   └─────────────┘   └─────────────────────┘   │
└────────────────────────────┬──────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │ ACP Middleware  │  ← THIS PACKAGE
                    │   + Callbacks   │
                    │                 │
                    │ Middleware:     │
                    │ • Session       │
                    │ • Tool          │
                    │ • Permission    │
                    │ • Mode          │
                    │                 │
                    │ Callbacks:      │
                    │ • ACPCallback   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  @agentclientprotocol/sdk           │
                    │  (AgentSideConnection)              │
                    │  - Transport                        │
                    │  - JSON-RPC                         │
                    │  - Connection lifecycle             │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ ACP Client      │
                    │ (Editor)        │
                    └─────────────────┘
```

### 3.2 Package Structure

```
packages/acp-middleware-callbacks/
├── src/
│   ├── index.ts                    # Main exports
│   ├── middleware/
│   │   ├── index.ts                # Middleware exports
│   │   ├── createACPSessionMiddleware.ts
│   │   ├── createACPToolMiddleware.ts
│   │   ├── createACPPermissionMiddleware.ts
│   │   └── createACPModeMiddleware.ts
│   ├── callbacks/
│   │   ├── index.ts                # Callback exports
│   │   └── ACPCallbackHandler.ts
│   ├── utils/
│   │   ├── index.ts                # Utility exports
│   │   ├── contentBlockMapper.ts
│   │   ├── stopReasonMapper.ts
│   │   ├── errorMapper.ts
│   │   └── mcpToolLoader.ts        # MCP tool integration
│   └── types/
│       ├── index.ts                # Type exports
│       ├── acp.ts                  # ACP protocol types (re-exports)
│       └── middleware.ts           # Middleware config types
├── tests/
│   ├── unit/
│   │   ├── middleware/
│   │   ├── callbacks/
│   │   └── utils/
│   ├── integration/
│   └── fixtures/
├── example/
│   └── ...
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

**Removed from scope:**
- `src/stdio/` directory (transport is SDK's responsibility)
- `src/utils/ndJsonStream.ts` (SDK provides this)
- Any transport-related code

---

## 4. Middleware Implementation

### 4.1 Session Middleware (`createACPSessionMiddleware`)

Manages ACP session lifecycle within LangChain execution.

**Key Concepts:**
- Session ID **MUST** equal LangGraph checkpoint thread_id
- Middleware configures checkpointer to use sessionId as thread_id
- Enables full state recovery across all turns
- ACP session is multi-turn (maintains conversation history)

**State Schema:**
```typescript
interface ACPSessionState {
  acp_sessionId?: SessionId;
  acp_threadId?: string;
  acp_turnCount?: number;
}
```

**Interface:**
```typescript
interface ACPSessionMiddlewareConfig {
  sessionIdExtractor?: (config: RunnableConfig) => string | undefined;
  emitStateSnapshots?: "initial" | "final" | "all" | "none";
  stateMapper?: (state: any) => any;
}

export function createACPSessionMiddleware(
  config: ACPSessionMiddlewareConfig
): AgentMiddleware;
```

**Usage:**
```typescript
const sessionMiddleware = createACPSessionMiddleware({
  sessionIdExtractor: (config) => config.configurable?.sessionId,
  emitStateSnapshots: "final",
});

const agent = createAgent({
  model: "claude-sonnet-4-20250529",
  middleware: [sessionMiddleware],
});
```

**State Flow:**
- Middleware merges `acp_sessionId`, `acp_threadId`, `acp_turnCount` into agent state
- State is **NOT** persisted by middleware; LangGraph's checkpointer handles persistence
- State is available to other middleware via agent state

### 4.2 Tool Middleware (`createACPToolMiddleware`)

Intercepts LangChain tool calls and emits ACP `tool_call` / `tool_call_update` events.

**ToolKind Mapping:**

| Tool Category | ToolKind | Examples |
|---------------|----------|----------|
| File reading | `read` | `read_file`, `get_file`, `view` |
| File editing | `edit` | `edit_file`, `modify_file`, `apply_patch` |
| File deletion | `delete` | `delete_file`, `remove_file`, `unlink` |
| File moving | `move` | `move_file`, `rename_file`, `mv` |
| Search operations | `search` | `search_files`, `grep`, `find` |
| Command execution | `execute` | `run_command`, `exec`, `bash`, `shell`, `command` |
| Internal reasoning | `think` | `reason`, `think`, `analyze` |
| Network requests | `fetch` | `http_get`, `fetch_url`, `curl` |
| Mode switching | `switch_mode` | `set_mode`, `change_mode`, `switch_context` |
| Other | `other` | Any tool that doesn't fit above |

**Tool Kind Mapper Implementation:**
```typescript
function mapToolKind(toolName: string): ToolKind {
  const name = toolName.toLowerCase();
  
  // File reading operations
  if (name.includes('read') || name.includes('get') || name.includes('view') || name.includes('load')) {
    return 'read';
  }
  
  // File editing operations
  if (name.includes('edit') || name.includes('modify') || name.includes('patch') || name.includes('update')) {
    return 'edit';
  }
  
  // File deletion operations
  if (name.includes('delete') || name.includes('remove') || name.includes('unlink') || name.includes('rm')) {
    return 'delete';
  }
  
  // File moving/renaming operations
  if (name.includes('move') || name.includes('rename') || name.includes('mv')) {
    return 'move';
  }
  
  // Search operations
  if (name.includes('search') || name.includes('grep') || name.includes('find') || name.includes('query')) {
    return 'search';
  }
  
  // Command execution
  if (name.includes('bash') || name.includes('run') || name.includes('exec') || 
      name.includes('shell') || name.includes('command') || name.includes('execute')) {
    return 'execute';
  }
  
  // Internal reasoning/thinking
  if (name.includes('think') || name.includes('reason') || name.includes('analyze')) {
    return 'think';
  }
  
  // Network requests
  if (name.includes('fetch') || name.includes('http') || name.includes('curl') || 
      name.includes('wget') || name.includes('url')) {
    return 'fetch';
  }
  
  // Mode switching
  if (name.includes('mode') || name.includes('context') || name.includes('switch')) {
    return 'switch_mode';
  }
  
  return 'other';
}
```

**Interface:**
```typescript
interface ACPToolMiddlewareConfig {
  emitToolResults?: boolean;
  emitToolStart?: boolean;
  toolKindMapper?: (toolName: string) => ToolKind;
  contentMapper?: (result: any) => ToolCallContent[];
}

export function createACPToolMiddleware(
  config: ACPToolMiddlewareConfig
): AgentMiddleware;
```

**Events Emitted:**
- `tool_call`: When tool is announced (status: "pending")
- `tool_call_update`: When tool status changes (status: "in_progress" / "completed" / "failed")

### 4.3 Permission Middleware (`createACPPermissionMiddleware`)

Implements HITL (Human-in-the-Loop) permission workflow for ACP agents.

**Pattern:** Uses `afterModel` hook with `interrupt()` for durable execution, aligned with LangChain's built-in HITL middleware pattern.

#### 4.3.1 Architecture Overview

The permission middleware intercepts tool calls after the model generates them and before execution. It categorizes tools into those requiring permission vs auto-approved, sends ACP protocol notifications, and uses LangGraph's `interrupt()` to checkpoint state and pause execution.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Agent Execution                              │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       afterModel Hook                                │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   extractToolCallsFromState()                        │
│           Extract tool calls from last AIMessage                    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 categorizeToolCalls(policy)                          │
│    ┌──────────────────────┐    ┌──────────────────────┐            │
│    │  permissionRequired  │    │    autoApproved      │            │
│    │  (needs approval)    │    │  (proceed directly)  │            │
│    └──────────────────────┘    └──────────────────────┘            │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
           ┌────────────────┐          ┌────────────────┐
           │ Auto-Approved  │          │ Permission     │
           │ → Proceed      │          │ Required       │
           └────────────────┘          └────────────────┘
                                               │
                                               ▼
                                   ┌────────────────────────┐
                                   │ emitToolStatus(pending)│
                                   └────────────────────────┘
                                               │
                                               ▼
                                   ┌────────────────────────┐
                                   │session/request_permission│
                                   │      notification       │
                                   └────────────────────────┘
                                               │
                                               ▼
                                   ┌────────────────────────┐
                                   │   interrupt(HITLReq)   │
                                   │  (checkpoint + pause)  │
                                   └────────────────────────┘
                                               │
                              ┌────────────────┴────────────────┐
                              ▼                                 ▼
                      ┌──────────────┐                 ┌──────────────┐
                      │   User UI    │                 │  LangGraph   │
                      │  Reviews     │                 │  Checkpoints │
                      │  Decision    │                 │  State       │
                      └──────────────┘                 └──────────────┘
                              │                                 │
                              ▼                                 │
                      ┌──────────────┐                          │
                      │ Command({    │◄─────────────────────────┘
                      │ resume: {    │
                      │ decisions }) │
                      └──────────────┘
                              │
                              ▼
                   ┌────────────────────────┐
                   │  processDecisions()    │
                   │  approve / edit / reject│
                   └────────────────────────┘
                              │
                              ▼
                   ┌────────────────────────┐
                   │  Update State & Return │
                   │  jumpTo: "model" if    │
                   │  rejection occurred    │
                   └────────────────────────┘
```

#### 4.3.2 HITL Types

```typescript
/**
 * Request sent to interrupt() containing tools requiring approval
 */
interface HITLRequest {
  /** Tools that require human approval */
  actionRequests: Array<{
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
    description?: string;
  }>;
  /** Configuration for each tool's review UI */
  reviewConfigs: Array<{
    actionName: string;
    allowedDecisions: Array<'approve' | 'edit' | 'reject'>;
    argsSchema?: Record<string, unknown>;
  }>;
}

/**
 * Decision types from human review
 * Aligned with LangChain's builtin HITL middleware pattern.
 * Decisions are matched to tool calls by array order.
 */
type HITLDecision =
  | { type: 'approve' }
  | {
      type: 'edit';
      editedAction: { name: string; args: Record<string, unknown> };
    }
  | { type: 'reject'; message?: string };

/**
 * Response structure passed to Command.resume
 */
interface HITLResponse {
  decisions: HITLDecision[];
}
```

#### 4.3.3 Middleware Interface

```typescript
interface ACPPermissionMiddlewareConfig {
  /** Permission policy: tool name pattern -> configuration */
  permissionPolicy: Record<string, PermissionPolicyConfig>;
  
  /** ACP transport for notifications */
  transport: {
    sendNotification(method: string, params: unknown): void;
    sessionUpdate(params: {
      sessionId: SessionId;
      update: ToolCall | ToolCallUpdate;
    }): Promise<void>;
  };
  
  /** Optional: callback when session is cancelled */
  onSessionCancel?: (sessionId: SessionId) => void;
  
  /** Optional: custom message mapper for decision responses */
  contentMapper?: (message: string) => Array<ToolCallContent>;
  
  /** Optional: description prefix for permission requests */
  descriptionPrefix?: string;
}

interface PermissionPolicyConfig {
  /** Whether this tool requires permission (default: true) */
  requiresPermission?: boolean;
  /** Tool kind for ACP protocol */
  kind?: ToolKind;
  /** Human-readable description for approval UI */
  description?: string;
}

export function createACPPermissionMiddleware(
  config: ACPPermissionMiddlewareConfig
): AgentMiddleware;
```

#### 4.3.4 Usage Example

```typescript
import { createAgent } from "langchain";
import { createACPPermissionMiddleware } from "@skroyc/acp-middleware-callbacks";
import { Command } from "@langchain/langgraph";

// Create permission middleware with policy
const permissionMiddleware = createACPPermissionMiddleware({
  permissionPolicy: {
    "delete_*": { requiresPermission: true, kind: "delete" },
    "*_file": { requiresPermission: true, kind: "edit" },
    "read_*": { requiresPermission: false },
  },
  transport: acpTransport,
  descriptionPrefix: "File operation requires approval",
});

// Create agent with middleware
const agent = createAgent({
  model: "claude-sonnet-4-20250514",
  middleware: [permissionMiddleware],
});

// Configuration for the agent run
const config = {
  configurable: {
    thread_id: "user-session-123",
    session_id: "acp-session-456",
  },
};

// Invoke agent
const initialResult = await agent.invoke(
  { messages: [new HumanMessage("Delete old data and write config")] },
  config
);

// If interrupted, check state
const state = await agent.graph.getState(config);
if (state.next?.length > 0) {
  // Get interrupt data (contains tools awaiting approval)
  const interruptData = state.tasks[0].interrupts[0].value as HITLRequest;
  
  // Display to user for approval in your UI...
  // For each tool in interruptData.actionRequests, show approval UI
  
  // Resume with decisions via Command
  const resumedResult = await agent.invoke(
    new Command({
      resume: {
        decisions: [
          {
            type: "approve",
            toolCallId: interruptData.actionRequests[0].toolCallId
          },
          {
            type: "edit",
            toolCallId: interruptData.actionRequests[1].toolCallId,
            editedAction: {
              name: "write_file",
              args: { path: "safe_path.txt", content: "Sanitized content" }
            }
          }
        ]
      }
    }),
    config
  );
}
```

#### 4.3.5 Checkpointing Behavior

The middleware leverages LangGraph's checkpoint system for durable HITL execution:

1. **Before Interrupt:** The agent state (messages, tool calls, context) is captured
2. **During Interrupt:** `interrupt()` triggers checkpoint creation via configured saver (MemorySaver, PostgresSaver, etc.)
3. **After Resume:** State is restored from checkpoint, modified with decisions

```typescript
// Checkpointer must be configured in agent for checkpointing
const agent = createAgent({
  model: "claude-sonnet-4-20250514",
  middleware: [permissionMiddleware],
  checkpointer: new MemorySaver(),  // Or PostgresSaver, etc.
});

// After interrupt, state can be retrieved from checkpointer
const state = await agent.graph.getState(config);
// state.tasks[0].interrupts[0].value contains the HITLRequest
// state.channel_values contains checkpointed state
```

#### 4.3.6 Workflow Summary

| Step | Description | Hook/Method |
|------|-------------|-------------|
| 1 | Extract tool calls from AIMessage | `extractToolCallsFromState()` |
| 2 | Categorize by permission policy | `categorizeToolCalls()` |
| 3 | Emit pending status for tools | `emitToolStatus('pending')` |
| 4 | Send ACP notification | `transport.sendNotification()` |
| 5 | Checkpoint and pause | `runtime.interrupt()` |
| 6 | Wait for Command resume | - |
| 7 | Process decisions | `processDecisions()` |
| 8 | Update state, handle rejections | Return `{ messages, jumpTo }` |

#### 4.3.7 Decision Outcomes

| Decision | Behavior | jumpTo |
|----------|----------|--------|
| `approve` | Tool proceeds unchanged | `undefined` |
| `edit` | Tool args replaced with edited version | `undefined` |
| `reject` | Tool removed, rejection message added | `"model"` |

When any rejection occurs, `jumpTo: "model"` triggers re-planning by the LLM.

### 4.4 Mode Middleware (`createACPModeMiddleware`)

Handles mode switching for ACP-compatible LangChain agents.

**Standard Modes:**
| Mode ID | Description |
|---------|-------------|
| `agentic` | Full autonomous agent mode (default) |
| `interactive` | Agent suggests, user approves |
| `readonly` | Agent can only read, no modifications |

**Interface:**
```typescript
interface ACPModeMiddlewareConfig {
  defaultMode?: string;
  allowedModes?: string[];
  onModeChange?: (mode: string) => void;
}

interface ACPModeConfig {
  modeId: string;
  description?: string;
  allowedTools?: string[];
  restrictions?: {
    maxTokens?: number;
    requiresPermission?: string[];
    readonly?: boolean;
  };
}

export function createACPModeMiddleware(
  config: ACPModeMiddlewareConfig
): AgentMiddleware;

export const STANDARD_MODES: Record<string, ACPModeConfig>;
```

**Responsibilities:**
- Track current mode in state
- Enforce mode restrictions (e.g., readonly can't write files)
- Emit `current_mode_update` events
- Handle mode switching logic

---

## 5. Callback Handler Implementation

### 5.1 ACPCallbackHandler

Extends LangChain's `BaseCallbackHandler` to emit ACP events.

**Configuration (Constructor Fields):**
```typescript
interface ACPCallbackHandlerConfig {
  // Destination for events (two patterns supported)
  
  // Pattern 1: Direct emitter interface
  emitter?: {
    sessionUpdate(params: SessionUpdateParams): Promise<void>;
  };
  
  // Pattern 2: SDK connection (user passes their AgentSideConnection)
  sdkConnection?: AgentSideConnection;
  
  // Session ID - set by agent implementation
  sessionId?: string;
  
  // Filtering options
  ignoreLLM?: boolean;
  ignoreChain?: boolean;
  ignoreTool?: boolean;
  ignoreRetriever?: boolean;
  
  // Mapping options
  contentBlockMapper?: ContentBlockMapper;
  emitReasoningAsThought?: boolean;
}
```

**Event Mapping (Hardcoded):**

| LangChain Callback | ACP SessionUpdate Event |
|-------------------|------------------------|
| `handleLLMStart` | (empty message start) |
| `handleLLMNewToken` | `agent_message_chunk` |
| `handleLLMEnd` | (implicit, use stopReason) |
| `handleToolStart` | `tool_call` (pending) |
| `handleToolEnd` | `tool_call_update` (completed) |
| `handleToolError` | `tool_call_update` (failed) |
| `handleAgentAction` | `tool_call` |
| `handleAgentEnd` | `agent_message_chunk` (final) |

**Usage Pattern:**
```typescript
// Developer creates handler with their transport
const handler = new ACPCallbackHandler({
  sdkConnection: connection,  // Their AgentSideConnection
  sessionId: params.sessionId, // From prompt request
});

// Developer passes sessionId when available
handler.setSessionId(params.sessionId);

// Pass to agent
const agent = createAgent({
  model: model,
  tools: tools,
  callbacks: [handler],
});
```

**Key Design Decisions:**
1. **Extends BaseCallbackHandler** - Follows LangChain patterns
2. **Two configuration patterns** - Emitter interface OR SDK connection
3. **Hardcoded event mapping** - No user configuration needed
4. **SessionId set by agent** - Agent implementation passes sessionId from prompt request
5. **State merged into agent state** - Middleware pattern

---

## 6. Content Block Mapping

### 6.1 ACP Content Block Types

ACP defines five content block types as a discriminated union:

```typescript
export type ContentBlock =
  | (TextContent & { type: 'text'; })
  | (ImageContent & { type: 'image'; })
  | (AudioContent & { type: 'audio'; })
  | (ResourceLink & { type: 'resource_link'; })
  | (EmbeddedResource & { type: 'resource'; });
```

**Content Block Definitions:**

**TextContent:**
```typescript
interface TextContent {
  _meta?: Record<string, unknown> | null;
  annotations?: Annotations | null;
  text: string;
}
```

**ImageContent:**
```typescript
interface ImageContent {
  _meta?: Record<string, unknown> | null;
  annotations?: Annotations | null;
  data: string;          // Base64-encoded
  mimeType: string;      // e.g., "image/png"
  uri?: string;
}
```

**AudioContent:**
```typescript
interface AudioContent {
  _meta?: Record<string, unknown> | null;
  annotations?: Annotations | null;
  data: string;          // Base64-encoded
  mimeType: string;      // e.g., "audio/mp3"
}
```

**ResourceLink:**
```typescript
interface ResourceLink {
  _meta?: Record<string, unknown> | null;
  annotations?: Annotations | null;
  uri: string;
  name: string;
  description?: string | null;
  mimeType?: string | null;
  size?: bigint | null;
  title?: string | null;
}
```

**EmbeddedResource:**
```typescript
interface EmbeddedResource {
  _meta?: Record<string, unknown> | null;
  annotations?: Annotations | null;
  resource: TextResourceContents | BlobResourceContents;
}

interface TextResourceContents {
  _meta?: Record<string, unknown> | null;
  uri: string;
  text: string;
  mimeType?: string | null;
}

interface BlobResourceContents {
  _meta?: Record<string, unknown> | null;
  uri: string;
  blob: string;          // Base64-encoded
  mimeType?: string | null;
}
```

### 6.2 Annotations

ACP supports annotations on content blocks:

```typescript
interface Annotations {
  _meta?: Record<string, unknown> | null;
  audience?: Array<'user' | 'assistant'> | null;
  lastModified?: string | null;
  priority?: number | null;
}
```

### 6.3 LangChain to ACP Mapping

| LangChain Type | ACP Type | Notes |
|---------------|----------|-------|
| `AIMessage` | `agent_message_chunk` | Text content from agent |
| `HumanMessage` | `user_message_chunk` | User input |
| `ToolMessage` | `tool_call_update` | Tool results |
| `AIMessageChunk` | `agent_message_chunk` | Streaming tokens |
| Reasoning content | `agent_thought_chunk` | Internal reasoning with `audience: ['assistant']` |

### 6.4 Bidirectional Mapping

The `contentBlockMapper` utility provides **bidirectional** conversion:

**LangChain → ACP:**
- `AIMessage` → `agent_message_chunk` with `ContentBlock[]`
- `HumanMessage` → `user_message_chunk` with `ContentBlock[]`
- `ToolMessage` → `tool_call_update` with `ContentBlock[]`

**ACP → LangChain:**
- `agent_message_chunk` → `AIMessage` with content
- `tool_call_update` → `ToolMessage` with result content

---

## 7. Session Update Types

### 7.1 Standard SessionUpdate Types

| Update Type | Purpose | Key Fields |
|-------------|---------|------------|
| `agent_message_chunk` | Stream agent text output | `content: ContentChunk` |
| `agent_thought_chunk` | Stream internal reasoning | `content: ContentChunk` |
| `user_message_chunk` | Stream user message parts | `content: ContentChunk` |
| `tool_call` | Announce new tool call | `toolCallId`, `title`, `kind`, `status`, `locations` |
| `tool_call_update` | Update tool progress | `toolCallId`, `status`, `content`, `rawOutput` |
| `plan` | Show execution plan | `entries: Array<PlanEntry>` |
| `available_commands_update` | Update command list | `availableCommands` |
| `current_mode_update` | Notify mode change | `currentModeId` |
| `config_option_update` | Update config state | `configOptions` |
| `session_info_update` | Update session metadata | `title`, `updatedAt` |

### 7.2 Tool Call Status Flow

```
pending → in_progress → completed
                    → failed
```

---

## 8. Error Handling & stopReason Mapping

### 8.1 stopReason Values

The `stopReason` in `PromptResponse` indicates why the agent stopped generating:

```typescript
export type StopReason =
  | 'end_turn'             // The language model finishes responding without requesting more tools
  | 'max_tokens'           // The maximum token limit is reached
  | 'max_turn_requests'    // The maximum number of model requests in a single turn is exceeded
  | 'refusal'              // The Agent refuses to continue
  | 'cancelled';           // The Client cancels the turn
```

### 8.2 stopReason Mapper

Maps LangChain agent state to ACP stop reason:

```typescript
export function mapToStopReason(state: Record<string, unknown>): StopReason {
  // 1. Check for user cancellation first (highest priority)
  if (state.cancelled === true || 
      state.permissionDenied === true ||
      state.userRequested === true ||
      state.interrupted === true) {
    return 'cancelled';
  }
  
  // 2. Check for refusal
  if (state.refusal === true || state.modelRefused === true) {
    return 'refusal';
  }
  
  // 3. Check for token limit
  const llmOutput = state.llmOutput as Record<string, unknown> | undefined;
  if (llmOutput?.finish_reason === 'length' ||
      llmOutput?.finish_reason === 'context_length' ||
      llmOutput?.finish_reason === 'token_limit' ||
      state.tokenLimitReached === true ||
      state.contextLengthExceeded === true ||
      state.maxTokensReached === true) {
    return 'max_tokens';
  }
  
  // 4. Check for turn/request limit
  const turnRequests = state.turnRequests as number | undefined;
  const maxTurnRequests = state.maxTurnRequests as number | undefined;
  if ((turnRequests !== undefined && maxTurnRequests !== undefined && turnRequests >= maxTurnRequests) ||
      state.maxStepsReached === true ||
      state.maxTurnsReached === true) {
    return 'max_turn_requests';
  }
  
  // 5. Default to end_turn for normal completion
  return 'end_turn';
}
```

### 8.3 Error to stopReason Mapping

Maps errors to appropriate stop reasons:

```typescript
export function createStopReasonFromError(error: Error | unknown): StopReason {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error);
  const errorName = error instanceof Error ? error.name : '';
  
  // 1. Cancellation keywords
  if (message.includes('cancelled') || message.includes('canceled') || 
      message.includes('aborted') || message.includes('interrupted') ||
      errorName.includes('Cancelled') || errorName.includes('AbortError')) {
    return 'cancelled';
  }
  
  // 2. Permission denial
  if (message.includes('permission') || message.includes('unauthorized') || 
      message.includes('forbidden') || message.includes('access denied') ||
      errorName.includes('Permission') || errorName.includes('Unauthorized')) {
    return 'cancelled';
  }
  
  // 3. Refusal
  if (message.includes('refuse') || message.includes('declined') ||
      errorName.includes('Refusal') || errorName.includes('Refused')) {
    return 'refusal';
  }
  
  // 4. Token limit
  if (message.includes('token') || message.includes('length') || 
      message.includes('context') || message.includes('limit') ||
      errorName.includes('Token') || errorName.includes('Length')) {
    return 'max_tokens';
  }
  
  // 5. Turn/request limit
  if (message.includes('turn') || message.includes('step') || 
      message.includes('max') || message.includes('request') ||
      errorName.includes('Turn') || errorName.includes('Step')) {
    return 'max_turn_requests';
  }
  
  // 6. Default to end_turn for other errors
  return 'end_turn';
}
```

### 8.4 Error Scenarios Mapping

| Error Scenario | Mechanism |
|---------------|-----------|
| Method execution failure | JSON-RPC error response |
| Agent encounters error | `stopReason: "end_turn"` in PromptResponse (emit error via sessionUpdate) |
| Client cancels operation | `stopReason: "cancelled"` |
| Tool execution failure | `tool_call_update` with `status: "failed"` |

### 8.5 Type Guards

```typescript
export function isStopReason(value: unknown): value is StopReason {
  return (
    value === 'cancelled' ||
    value === 'refusal' ||
    value === 'max_tokens' ||
    value === 'max_turn_requests' ||
    value === 'end_turn'
  );
}

export function asStopReason(
  value: unknown,
  defaultReason: StopReason = 'end_turn'
): StopReason {
  if (isStopReason(value)) {
    return value;
  }
  return defaultReason;
}
```

---

## 9. MCP Tool Loader

### 9.1 Integration

The package integrates `@langchain/mcp-adapters` to load MCP tools.

**Important:** `MultiServerMCPClient` is from **`@langchain/mcp-adapters`**, NOT the official MCP SDK.

**Basic Usage:**

```typescript
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const mcpClient = new MultiServerMCPClient({
  mcpServers: {
    filesystem: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      restart: { enabled: true, maxAttempts: 3 },
    },
    math: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-math"],
    },
  },
  prefixToolNameWithServerName: true,
  additionalToolNamePrefix: "mcp",
});

const tools = await mcpClient.getTools();
// Tool names like: "mcp__filesystem__read_file", "mcp__math__add"
```

**Note:** MCP is orthogonal to ACP (it's a tool source, not a protocol). The loader is provided as a convenience utility but is **NOT** required for ACP functionality.

---

## 10. Appendix: LangChain Type Reference

### 10.1 `createMiddleware()` Function

```typescript
export function createMiddleware<
  TSchema extends InteropZodObject | undefined = undefined,
  TContextSchema extends InteropZodObject | undefined = undefined,
  TTools extends readonly (ClientTool | ServerTool)[] = readonly (
    | ClientTool
    | ServerTool
  )[],
>(config: MiddlewareConfig<TSchema, TContextSchema, TTools>): AgentMiddleware;
```

### 10.2 Hook Types

```typescript
// Lifecycle hooks
type BeforeAgentHandler<TSchema, TContext> = (
  state: TSchema,
  runtime: Runtime<TContext>
) => PromiseOrValue<MiddlewareResult<TSchema>>;

type AfterModelHandler<TSchema, TContext> = (
  state: TSchema,
  runtime: Runtime<TContext>,
  controls: ModelControls
) => PromiseOrValue<MiddlewareResult<Partial<TSchema>>>;

// Wrapper hooks
type WrapToolCallHook<TSchema, TContext> = (
  request: ToolCallRequest,
  handler: ToolCallHandler
) => PromiseOrValue<ToolMessage | Command>;
```

### 10.3 MiddlewareResult

```typescript
type MiddlewareResult<TState> =
  | (TState & {
      jumpTo?: "model" | "tools" | "end";
    })
  | void;
```

### 10.4 BaseCallbackHandler

```typescript
abstract class BaseCallbackHandler implements CallbackHandler {
  name: string;
  ignoreLLM?: boolean;
  ignoreChain?: boolean;
  ignoreAgent?: boolean;
  ignoreRetriever?: boolean;
  ignoreCustomEvent?: boolean;
  awaitHandlers?: boolean;
  raiseError?: boolean;
  
  constructor(input?: BaseCallbackHandlerInput);
  
  async handleLLMStart(...): Promise<void>;
  async handleLLMNewToken(...): Promise<void>;
  async handleLLMEnd(...): Promise<void>;
  async handleLLMError(...): Promise<void>;
  async handleChainStart(...): Promise<void>;
  async handleChainEnd(...): Promise<void>;
  async handleChainError(...): Promise<void>;
  async handleToolStart(...): Promise<void>;
  async handleToolEnd(...): Promise<void>;
  async handleToolError(...): Promise<void>;
  async handleAgentAction(...): Promise<void>;
  async handleAgentEnd(...): Promise<void>;
}
```

---

## 11. Example Usage

### 11.1 Complete Agent Example

```typescript
import * as acp from "@agentclientprotocol/sdk";
import { createAgent } from "langchain";
import { createACPSessionMiddleware } from "./middleware/createACPSessionMiddleware";
import { createACPToolMiddleware } from "./middleware/createACPToolMiddleware";
import { createACPModeMiddleware, STANDARD_MODES } from "./middleware/createACPModeMiddleware";
import { ACPCallbackHandler } from "./callbacks/ACPCallbackHandler";

// Developer implements Agent interface
class MyAgent implements acp.Agent {
  private sessions: Map<string, SessionState> = new Map();
  private connection: acp.AgentSideConnection;
  
  constructor(connection: acp.AgentSideConnection) {
    this.connection = connection;
  }
  
  async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: { http: true, sse: true },
      },
    };
  }
  
  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, { cwd: params.cwd });
    return { sessionId };
  }
  
  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error("Session not found");
    
    // Create agent with middleware
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
          sdkConnection: this.connection,
          sessionId: params.sessionId,
        }),
      ],
    });
    
    // Invoke agent
    const result = await agent.invoke({ messages: params.prompt });
    
    return {
      stopReason: "end_turn",
      content: result.messages.map(msg => msg.content),
    };
  }
  
  async cancel(params: acp.CancelNotification): Promise<void> {
    // Handle cancellation
  }
}

// Create and start transport
const connection = new acp.AgentSideConnection(
  (conn) => new MyAgent(conn),
  stream
);

await connection.listen();
```

---

## 12. Protocol Stability Indicators

### 12.1 Stability Levels

| Indicator | Meaning |
|-----------|---------|
| **STABLE** | Guaranteed by protocol specification; won't break |
| **UNSTABLE** | May change in future protocol versions |
| **EXPERIMENTAL** | Likely to change; for testing only |

### 12.2 Current Stability Map

**Session Update Types:**

| Type | Stability | Notes |
|------|-----------|-------|
| `user_message_chunk` | STABLE | Core functionality |
| `agent_message_chunk` | STABLE | Core functionality |
| `agent_thought_chunk` | UNSTABLE | Not yet in stable schema |
| `tool_call` | STABLE | Core functionality |
| `tool_call_update` | STABLE | Core functionality |
| `plan` | STABLE | Core functionality |
| `available_commands_update` | EXPERIMENTAL | `@experimental` tag |
| `current_mode_update` | STABLE | Used in stable API |
| `config_option_update` | EXPERIMENTAL | `@experimental` tag |
| `session_info_update` | STABLE | Used in stable API |

**Error Codes:**

| Code | Stability | Description |
|------|-----------|-------------|
| -32700 to -32603 | STABLE | JSON-RPC 2.0 standard |
| -32000, -32002 | STABLE | ACP-specific |

**Methods:**

| Method | Stability | Notes |
|--------|-----------|-------|
| `initialize` | STABLE | Protocol handshake |
| `session/new` | STABLE | Create session |
| `session/prompt` | STABLE | Send prompt |
| `session/cancel` | STABLE | Cancel turn |
| `session/set_mode` | STABLE | Change mode |
| `session/load` | STABLE | Load session |
| `session/request_permission` | STABLE | Permission requests |
| `session/list_sessions` | UNSTABLE | List sessions |
| `session/fork` | UNSTABLE | Fork session |
| `session/resume` | UNSTABLE | Resume session |

---

## 13. Summary: Scope Decision Matrix

| Component | In Scope? | Reason |
|-----------|-----------|--------|
| Session middleware | ✅ Yes | Core ACP session lifecycle |
| Tool middleware | ✅ Yes | Tool call ↔ sessionUpdate mapping |
| Permission middleware | ✅ Yes | HITL via afterModel hook |
| Mode middleware | ✅ Yes | Mode switching logic |
| Callback handler | ✅ Yes | LangChain ↔ ACP event bridging |
| Content block mapper | ✅ Yes | Bidirectional format conversion |
| stopReason mapper | ✅ Yes | State to stopReason conversion |
| Error mapping | ✅ Yes | Error pattern handling |
| MCP tool loader | ✅ Yes | Convenience utility |
| Stdio transport | ❌ No | SDK provides this |
| NDJSON stream | ❌ No | SDK provides this |
| Connection management | ❌ No | SDK provides this |
| Protocol initialization | ❌ No | SDK provides this |
| Request-response correlation | ❌ No | SDK provides this |
| Write queue serialization | ❌ No | SDK provides this |

---

**For transport and connection management, use `@agentclientprotocol/sdk` directly:**
- `AgentSideConnection` for agent-side connections
- `ndJsonStream()` for NDJSON stream handling
- Protocol initialization and handshake

See [@agentclientprotocol/sdk on npm](https://www.npmjs.com/package/@agentclientprotocol/sdk) for complete documentation.

---

**END OF SPEC V2**