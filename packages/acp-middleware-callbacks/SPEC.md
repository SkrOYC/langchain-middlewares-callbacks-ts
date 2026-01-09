# SPEC: @skroyc/acp-middleware-callbacks

## 1. Overview

### 1.1 Purpose

This package provides TypeScript middleware and callbacks that bridge LangChain `createAgent()` implementations to the **Agent Client Protocol (ACP)** for code editors and AI development environments. The package enables any LangChain agent to become ACP-compliant with minimal configuration.

**Core Features:**
- **Middleware:** Lifecycle hooks for session management, tool execution, and permission handling
- **Callbacks:** Streaming event emission for real-time agent updates
- **Utilities:** Content block mappers, tool converters, and transport utilities

### 1.2 Protocol Overview

ACP is a protocol standardizing editor-to-agent communication with:
- **Structured session management:** `newSession`, `prompt`, `loadSession`
- **Permission-based tool execution:** `requestPermission` workflow
- **Rich content blocks:** text, image, audio, resources
- **Standardized updates:** `sessionUpdate` notifications
- **Bidirectional communication:** JSON-RPC 2.0 over stdio

### 1.3 Key Differences from AG-UI

This package shares architectural patterns with `@skroyc/ag-ui-middleware-callbacks` but is fundamentally different:

| Aspect | AG-UI | ACP |
|--------|-------|-----|
| Communication | Backend → Frontend event streaming | Editor ↔ Agent bidirectional |
| Transport | SSE/WebSocket | Stdio with JSON-RPC 2.0 |
| Session State | No built-in session management | Full session lifecycle |
| Permission Flow | No built-in support | `requestPermission` workflow |
| Content Model | Events-based | Content blocks with annotations |

### 1.4 LangChain Integration

This package works with **LangChain v1.0.0+** which uses LangGraph under the hood:

- ```createAgent()```: High-level API that compiles a StateGraph with middleware support
- ```thread_id```: Session identifier via `configurable.thread_id` for checkpoint retrieval
- **Checkpoint:** Persisted state snapshot containing messages, custom state, and middleware state
- **Checkpointer:** Storage backend (e.g., `MemorySaver`, database) for checkpoints

### 1.5 Version Compatibility

| Component | Version | Notes |
|-----------|---------|-------|
| **LangChain** | ^1.0.0 | Middleware API introduced in v1.0.0 |
| **@langchain/core** | ^1.1.0 | Content block system required |
| **@agentclientprotocol/sdk** | ^1.0.0 | ACP protocol types |
| **Node.js** | >=18.0.0 | Universal runtime minimum |
| **TypeScript** | >=5.0.0 | Strict mode required |
| **ACP Protocol** | v1 | Current stable version |

**Minimum Runtime:** Node.js 18 (for `structuredClone`, `ReadableStream`, `TextEncoder`)

---

## 2. Requirements

### 2.1 Core Requirements

| Priority | Requirement | Description |
|----------|-------------|-------------|
| **MUST** | ACP Session Integration | Support `session/new`, `session/prompt`, `session/update` flow |
| **MUST** | Tool Call Lifecycle | Emit `tool_call`, `tool_call_update` events with ACP format |
| **MUST** | Permission Handling | Implement HITL-style interruption for ACP `requestPermission` |
| **MUST** | Content Block Mapping | Convert LangChain messages to ACP content blocks |
| **MUST** | MCP Server Support | Integrate `@langchain/mcp-adapters` for MCP tool loading |
| **MUST** | Stdio Transport | ACP-compliant stdio communication pattern |
| **MUST** | Error Mapping | Map LangChain errors to ACP `stopReason` values |
| **SHOULD** | Reasoning Content | Map LangChain `reasoning` blocks to `agent_message_chunk` with audience annotation |
| **SHOULD** | Mode Middleware | Optional middleware for `current_mode_update` handling |
| **SHOULD** | Plan Updates | Optional middleware for `plan` session updates (custom extension) |
| **COULD** | Multi-Modal Support | Pass through image/audio content blocks |
| **WON'T** | Client Implementation | Only backend ACP layer, no frontend code |

### 2.2 Functional Requirements

**REQ-1:** A LangChain agent wrapped with this package must respond to ACP `session/prompt` requests by:
- Emitting streaming `sessionUpdate` notifications
- Handling permission requests via interruption
- Returning a valid `stopReason`

**REQ-2:** The package must automatically convert LangChain `AIMessage` content to ACP `agent_message_chunk` events. For reasoning content, emit as `agent_thought_chunk` with `audience: ['assistant']` annotation (using Role type from SDK).

**REQ-3:** The package must convert LangChain `ToolMessage` to ACP `tool_call_update` events with proper status lifecycle.

**REQ-4:** The package must accept MCP server configurations and dynamically load tools using `@langchain/mcp-adapters`.

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
                    │ ACP Middleware  │
                    │   + Callbacks   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  ACP Transport  │
                    │ (AgentSideConn) │
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
│   ├── stdio/
│   │   ├── index.ts                # Transport exports
│   │   └── createACPStdioTransport.ts
│   ├── utils/
│   │   ├── index.ts                # Utility exports
│   │   ├── contentBlockMapper.ts
│   │   ├── mcpToolLoader.ts
│   │   ├── errorMapper.ts
│   │   ├── stopReasonMapper.ts
│   │   └── sessionStateMapper.ts
│   └── types/
│       ├── index.ts                # Type exports
│       ├── acp.ts                  # ACP protocol types
│       ├── middleware.ts           # Middleware config types
│       └── callbacks.ts            # Callback config types
├── tests/
│   ├── unit/
│   │   ├── middleware/
│   │   ├── callbacks/
│   │   └── utils/
│   ├── integration/
│   │   └── stdio.test.ts
│   └── fixtures/
├── example/
│   ├── simple-agent.ts             # Basic ACP agent
│   ├── mcp-agent.ts                # MCP-enabled agent
│   └── tsconfig.json
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

---

## 4. Middleware Implementation

### 4.1 Session Middleware (`createACPSessionMiddleware`)

Manages ACP session lifecycle within LangChain execution.

**Key Concepts:**
- Session ID **MUST** equal LangGraph checkpoint thread_id
- Middleware configures checkpointer to use sessionId as thread_id
- Enables full state recovery across all turns
- ACP session is multi-turn (maintains conversation history)

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
  emitStateSnapshots: "none",
});

const agent = createAgent({
  model: "claude-sonnet-4-20250529",
  middleware: [sessionMiddleware],
});
```

**Session Lifecycle Events:**
- `newSession`: Creates a new session (called once at conversation start)
- `session/prompt`: Sends user message within existing session (called multiple times)
- `session/load`: Restores existing session and streams conversation history
- `session/cancel`: Handles cancellation gracefully

**Session Load Flow:**
1. Agent restores internal session state (checkpoints, MCP connections)
2. Agent streams entire conversation history via `user_message_chunk` and `agent_message_chunk`
3. Client receives notifications and reconstructs full conversation UI
4. Agent proceeds with next prompt using restored context

### 4.2 Tool Middleware (`createACPToolMiddleware`)

Intercepts LangChain tool calls and emits ACP `tool_call` / `tool_call_update` events.

**ToolKind Enum Values:**

The SDK defines the following ToolKind values for categorizing tool operations:

```typescript
type ToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other';
```

**ToolKind Mapping Guide:**

| Tool Category | Recommended ToolKind | Examples |
|---------------|---------------------|----------|
| File reading | `read` | `read_file`, `get_file`, `view` |
| File editing | `edit` | `edit_file`, `modify_file`, `apply_patch` |
| File deletion | `delete` | `delete_file`, `remove_file`, `unlink` |
| File moving | `move` | `move_file`, `rename_file`, `mv` |
| Search operations | `search` | `search_files`, `grep`, `find` |
| Command execution | `execute` | `run_command`, `exec`, `bash`, `shell`, `command` |
| Internal reasoning | `think` | `reason`, `think`, `analyze` |
| Network requests | `fetch` | `http_get`, `fetch_url`, `curl` |
| Mode switching | `switch_mode` | `set_mode`, `change_mode`, `switch_context` |
| Other | `other` | Any tool that doesn't fit above categories |

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
  if (name.includes('bash') || name.includes('run') || name.includes('exec') || name.includes('shell') || name.includes('command') || name.includes('execute')) {
    return 'execute';
  }
  
  // Internal reasoning/thinking
  if (name.includes('think') || name.includes('reason') || name.includes('analyze')) {
    return 'think';
  }
  
  // Network requests
  if (name.includes('fetch') || name.includes('http') || name.includes('curl') || name.includes('wget') || name.includes('url')) {
    return 'fetch';
  }
  
  // Mode switching
  if (name.includes('mode') || name.includes('context') || name.includes('switch')) {
    return 'switch_mode';
  }
  
  return 'other';
}
```

**Tool Call Lifecycle:**

```typescript
wrapToolCall: async (request, handler) => {
  const { toolCallId, name, args } = request;
  const sessionId = runtime.config.configurable?.sessionId;

  // 1. Emit pending tool call
  await connection.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: "tool_call",
      toolCallId,
      title: `Calling ${name}`,
      kind: mapToolKind(name),
      status: "pending",
      _meta: null,
      locations: extractLocations(args),
      rawInput: args,
      content: null,
      rawOutput: null,
    },
  });

  // 2. Emit in_progress status
  await connection.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "in_progress",
      _meta: null,
    },
  });

  // 3. Execute tool
  try {
    const result = await handler(request);

    // 4. Emit completed status
    await connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "completed",
        _meta: null,
        content: mapToContentBlocks(result),
        rawOutput: result,
      },
    });

    return result;
  } catch (error) {
    // 4. Emit failed status
    await connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "failed",
        _meta: null,
        content: [{ 
          type: "text", 
          _meta: null, 
          annotations: null, 
          text: error.message 
        }],
      },
    });
    throw error;
  }
}
```

**Tool Call Status Flow:**
```
pending → in_progress → completed
                    → failed
```

### 4.3 Permission Middleware (`createACPPermissionMiddleware`)

Implements HITL-style interruption for ACP permission requests.

**Permission System Overview:**

The permission system operates at two levels:
1. **Capability-based permissions:** Declared during initialization handshake
2. **Runtime permission requests:** User authorization for specific operations

**PermissionOptionKind Values:**

```typescript
type PermissionOptionKind =
  | 'allow_once'     // Allow this specific action once
  | 'allow_always'   // Allow this action permanently
  | 'reject_once'    // Deny this specific action once
  | 'reject_always'; // Deny this action permanently
```

**RequestPermissionOutcome Structure:**

```typescript
type RequestPermissionOutcome =
  | { outcome: 'cancelled' }
  | ({ outcome: 'selected' } & { optionId: string });
```

**Interface:**

```typescript
import * as acp from "@agentclientprotocol/sdk";

interface ACPPermissionMiddlewareConfig {
  permissionPolicy: {
    [toolPattern: string]: {
      kind: acp.ToolKind;
      requirePermission: boolean;
    };
  };
  transport: acp.AgentSideConnection;
}

export function createACPPermissionMiddleware(
  config: ACPPermissionMiddlewareConfig
): AgentMiddleware;
```

**Permission Flow:**

```typescript
wrapToolCall: async (request, handler) => {
  const toolCall = request.toolCall;
  const sessionId = runtime.config.configurable?.sessionId;

  // 1. Emit permission request
  const response = await connection.requestPermission({
    sessionId,
    toolCall: {
      toolCallId: toolCall.id,
      title: `Calling ${toolCall.name}`,
      kind: mapToolKind(toolCall.name),
      status: "pending",
      _meta: null,
      locations: extractLocations(toolCall.args),
      rawInput: toolCall.args,
      content: null,
      rawOutput: null,
    },
    options: [
      { optionId: "allowOnce", name: "Allow", kind: "allow_once" },
      { optionId: "allowAlways", name: "Always Allow", kind: "allow_always" },
      { optionId: "rejectOnce", name: "Deny", kind: "reject_once" },
      { optionId: "rejectAlways", name: "Never Allow", kind: "reject_always" },
    ],
  });

  // 2. Handle cancelled outcome
  if (response.outcome.outcome === "cancelled") {
    await connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: toolCall.id,
        status: "failed",
        _meta: null,
        content: [{ 
          type: "text", 
          _meta: null, 
          annotations: null, 
          text: "Permission request cancelled" 
        }],
      },
    });
    throw new Error("Permission request cancelled by user");
  }

  // 3. Handle selected outcome with optionId
  if (response.outcome.outcome === "selected") {
    const { optionId } = response.outcome;
    
    // Check for denial options
    if (optionId === "rejectOnce" || optionId === "rejectAlways") {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.id,
          status: "failed",
          _meta: null,
          content: [{ 
            type: "text", 
            _meta: null, 
            annotations: null, 
            text: "Permission denied by user" 
          }],
        },
      });
      throw new Error("Permission denied by user");
    }
    
    // Handle persistent permissions for "allowAlways"
    if (optionId === "allowAlways") {
      // Store persistent permission in client's permission store
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "permission_update",
          toolPattern: toolCall.name,
          permission: "granted",
        },
      });
    }
  }

  // 4. User approved - continue execution
  return await handler(request);
}
```

**Kind Descriptions:**
- `allow_once`: Permits the specific action one time only. Future similar actions will require new requests.
- `allow_always`: Creates a persistent permission stored by the client for future similar actions.
- `reject_once`: Denies the specific action this time only. Future similar actions will prompt again.
- `reject_always`: Creates a persistent denial stored by the client to auto-deny future requests.

### 4.4 Mode Middleware (`createACPModeMiddleware`) - Optional

Handles ACP mode changes via optional middleware.

**Interface:**

```typescript
interface ACPModeMiddlewareConfig {
  modes: {
    [modeId: string]: {
      systemPrompt: string;
      description?: string;
      allowedTools?: string[];
      requirePermission?: boolean;
    };
  };
  defaultMode: string;
}

export function createACPModeMiddleware(
  config: ACPModeMiddlewareConfig
): AgentMiddleware;
```

**Supported Modes:**

| Mode | Behavior |
|------|----------|
| `agentic` | Full autonomy, can use all tools without restrictions |
| `interactive` | Requires confirmation for sensitive operations |
| `readonly` | No tool execution, only read operations |
| `planning` | Emits `plan` updates; tool execution deferred |

**Mode Switching:**

```typescript
beforeAgent: async (state, runtime) => {
  const currentMode = getCurrentMode(runtime.config) || this.config.defaultMode;
  const modeConfig = this.config.modes[currentMode];

  const systemMessage = new SystemMessage(modeConfig.systemPrompt);

  runtime.config.configurable = {
    ...runtime.config.configurable,
    acp_mode: currentMode,
    acp_allowedTools: modeConfig.allowedTools,
    acp_requirePermission: modeConfig.requirePermission,
  };

  await connection.sessionUpdate({
    sessionId: runtime.config.configurable?.sessionId,
    update: {
      sessionUpdate: "current_mode_update",
      mode: {
        modeIds: Object.keys(this.config.modes),
        selectedModeId: currentMode,
      },
    },
  });

  return {};
},
```

---

## 5. Callback Handler Implementation

### 5.1 ACPCallbackHandler

Handles streaming events at the **LLM level** (token generation, message chunks). This is the **classic LangChain callback pattern** and is appropriate for intercepting model-level streaming events.

**When to Use Callbacks vs Middleware:**
- **Callbacks (`ACPCallbackHandler`):** Use for LLM-level token streaming, model start/end events, and when you need fine-grained control over model output chunks
- **Middleware:** Use for agent-level session management, tool execution lifecycle, and permission handling

**Interface:**

```typescript
interface ACPCallbackHandlerConfig {
  transport: ACPTransport;
  emitTextChunks?: boolean;
  contentBlockMapper?: ContentBlockMapper;
}

export class ACPCallbackHandler extends BaseCallbackHandler {
  constructor(config: ACPCallbackHandlerConfig);

  // LLM Callbacks
  handleLLMStart?(llm: Serialized, prompts: string[], runId: string): void;
  handleLLMNewToken?(token: string, idx: NewTokenIndices, runId: string): void;
  handleLLMEnd?(output: LLMResult, runId: string): void;
  handleLLMError?(error: Error, runId: string): void;

  // Tool Callbacks
  handleToolStart?(tool: Serialized, input: string, runId: string): void;
  handleToolEnd?(output: string, runId: string): void;
  handleToolError?(error: Error, runId: string): void;
}
```

**Token Streaming Implementation:**

```typescript
async handleLLMNewToken(token: string, run: Run) {
  if (!token) return;

  await connection.sessionUpdate({
    sessionId: runtime.config.configurable?.sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        _meta: null,
        annotations: null,
        text: token,
      },
    },
  });
}

async handleLLMEnd(output: LLMResult, run: Run) {
  // ACP doesn't require explicit end marker
  // Agent proceeds to next phase or returns stopReason
}
```

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

### 6.2 Content Block Definitions

**TextContent:**

```typescript
import type { Role } from '@agentclientprotocol/sdk';

export type TextContent = {
  _meta?: Record<string, unknown> | null;
  annotations?: Annotations | null;
  text: string;
};

export type Annotations = {
  _meta?: Record<string, unknown> | null;
  audience?: Array<Role> | null;
  lastModified?: string | null;
  priority?: number | null;
};
```

**ImageContent:**

```typescript
export type ImageContent = {
  _meta?: Record<string, unknown> | null;
  annotations?: Annotations | null;
  data: string;        // Base64-encoded
  mimeType: string;
  uri?: string | null;
};
```

**AudioContent:**

```typescript
export type AudioContent = {
  _meta?: Record<string, unknown> | null;
  annotations?: Annotations | null;
  data: string;        // Base64-encoded
  mimeType: string;
};
```

**ResourceLink:**

```typescript
export type ResourceLink = {
  _meta?: Record<string, unknown> | null;
  annotations?: Annotations | null;
  description?: string | null;
  mimeType?: string | null;
  name: string;
  size?: bigint | null;
  title?: string | null;
  uri: string;
};
```

**EmbeddedResource:**

```typescript
export type EmbeddedResource = {
  _meta?: Record<string, unknown> | null;
  annotations?: Annotations | null;
  resource: {
    uri: string;
    mimeType: string;
    text?: string;        // For text-based resources
    blob?: string;        // Base64-encoded for binary resources
  };
};
```

### 6.3 LangChain to ACP Mapping

| LangChain Content | ACP Content Block | Notes |
|-------------------|-------------------|-------|
| `text` | `agent_message_chunk` | User-facing response |
| `image` | `agent_message_chunk` | Base64-encoded image |
| `audio` | `agent_message_chunk` | Base64-encoded audio |
| `file` (reference) | `resource_link` | Reference without content |
| `file` (with content) | `resource` | Embedded resource |
| `reasoning` | `agent_message_chunk` | With audience annotation |

**Note on Reasoning:** ACP supports both `agent_message_chunk` for user-facing content and `agent_thought_chunk` for internal reasoning content. For reasoning content, emit as `agent_thought_chunk` with `audience: ['assistant']` annotation (using Role type from SDK) to indicate internal content. Use `agent_message_chunk` only for user-facing responses.

### 6.4 Content Block Mapper Implementation

```typescript
import type { Role } from '@agentclientprotocol/sdk';

class DefaultContentBlockMapper implements ContentBlockMapper {
  toACP(block: LangChainContentBlock): ContentBlock {
    switch (block.type) {
      case "text":
        return {
          type: "text",
          _meta: block._meta || null,
          annotations: this.mapAnnotations(block.annotations),
          text: block.text,
        };

      case "reasoning":
        return {
          type: "text",
          _meta: { _internal: true, reasoning: true },
          annotations: {
            audience: ['assistant'] as Role[],
            priority: block.priority || null,
          },
          text: block.reasoning,
        };

      case "image":
        return {
          type: "image",
          _meta: block._meta || null,
          annotations: this.mapAnnotations(block.annotations),
          data: block.url || block.data,
          mimeType: block.mimeType || "image/png",
        };

      case "audio":
        return {
          type: "audio",
          _meta: block._meta || null,
          annotations: this.mapAnnotations(block.annotations),
          data: block.data,
          mimeType: block.mimeType || "audio/wav",
        };

      case "file":
        if (block.content) {
          return {
            type: "resource",
            _meta: block._meta || null,
            annotations: this.mapAnnotations(block.annotations),
            resource: {
              uri: block.uri || block.url || "",
              mimeType: block.mimeType || "application/octet-stream",
              blob: block.content,
            },
          };
        } else {
          return {
            type: "resource_link",
            _meta: block._meta || null,
            annotations: this.mapAnnotations(block.annotations),
            description: block.description || null,
            mimeType: block.mimeType || null,
            name: block.name || "file",
            size: block.size ? BigInt(block.size) : null,
            title: block.title || null,
            uri: block.uri || block.url || "",
          };
        }

      default:
        // Log warning for unexpected content block types to aid debugging
        console.warn(`Unknown content block type: ${block.type}, converting to text`);
        return { type: "text", _meta: null, annotations: null, text: String(block) };
    }
  }

  private mapAnnotations(
    langChainAnnotations?: Record<string, unknown>
  ): Annotations | null {
    if (!langChainAnnotations) return null;
    return {
      _meta: null,
      audience: langChainAnnotations.audience as Annotations['audience'] || null,
      lastModified: langChainAnnotations.lastModified as string || null,
      priority: langChainAnnotations.priority as number || null,
    };
  }
}
```

---

## 7. Session Update Types

### 7.1 Standard SessionUpdate Types

```typescript
type SessionUpdate =
  | { sessionUpdate: "user_message_chunk"; content: ContentBlock }
  | { sessionUpdate: "agent_message_chunk"; content: ContentBlock }
  | { sessionUpdate: "agent_thought_chunk"; content: ContentBlock }
  | { sessionUpdate: "tool_call"; toolCallId: string; /* ToolCall fields */ }
  | { sessionUpdate: "tool_call_update"; /* ToolCallUpdate fields */ }
  | { sessionUpdate: "current_mode_update"; mode: { modeIds: string[]; selectedModeId: string } }
```

**Note:** Some SessionUpdate types like `available_commands_update` and `config_option_update` are optional/extension features. Verify client support before using these types.

**Note on Session Updates:** The SessionUpdate types above represent the core ACP protocol. Additional types like `plan` are custom extensions that require explicit client support and should not be used in production without verification.

---

## 8. Stdio Transport Implementation

### 8.1 Connection Architecture

The ACP SDK uses a robust connection architecture that ensures reliable message delivery through several mechanisms:

**Internal Connection Class:**
```typescript
class Connection {
  #pendingResponses: Map<string | number | null, PendingResponse> = new Map();
  #nextRequestId: number = 0;
  #writeQueue: Promise<void> = Promise.resolve();
  #abortController: AbortController;
  #stream: Stream;
  #requestHandler: (method: string, params: unknown) => Promise<unknown>;
  #notificationHandler: (method: string, params: unknown) => Promise<void>;
}

interface PendingResponse {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}
```

**Key Mechanisms:**
- **Pending Response Tracking:** The `#pendingResponses` Map correlates outgoing requests with their expected responses using request IDs
- **Sequential Request IDs:** The `#nextRequestId` counter generates sequential identifiers for new requests
- **Write Queue Serialization:** The `#writeQueue` Promise chain serializes all outgoing messages to prevent interleaving
- **Abort Controller:** Enables graceful shutdown of the receive loop when the connection closes

### 8.2 Write Queue Serialization

The connection uses a Promise chain to serialize outgoing messages, ensuring that concurrent writes do not interleave:

```typescript
async #sendMessage(message: AnyMessage): Promise<void> {
  this.#writeQueue = this.#writeQueue
    .then(async () => {
      const writer = this.#stream.writable.getWriter();
      try {
        await writer.write(JSON.stringify(message) + '\n');
      } finally {
        writer.releaseLock();
      }
    });
  return this.#writeQueue;
}
```

This pattern ensures:
- **Message Ordering:** All messages are sent in the order they were initiated
- **No Interleaving:** Concurrent operations don't corrupt the message stream
- **Protocol Compliance:** NDJSON format requires clean message boundaries

### 8.3 Request-Response Correlation

When a request is initiated, the connection creates a pending response entry:

```typescript
async sendRequest<Req, Resp>(method: string, params?: Req): Promise<Resp> {
  const id = this.#nextRequestId++;
  const responsePromise = new Promise((resolve, reject) => {
    this.#pendingResponses.set(id, { resolve, reject });
  });
  
  await this.#sendMessage({
    jsonrpc: '2.0',
    id,
    method,
    params
  });
  
  return responsePromise as Promise<Resp>;
}
```

### 8.4 NDJSON Stream Implementation

The SDK provides the `ndJsonStream` utility for stdio communication:

```typescript
import * as acp from "@agentclientprotocol/sdk";

// Create NDJSON stdio stream for subprocess communication
const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdin),
  Readable.toWeb(process.stdout)
);

// Create agent connection using callback pattern
const connection = new acp.AgentSideConnection(
  (conn) => agentImplementation,  // Callback receives AgentSideConnection, returns Agent
  stream
);
```

**NDJSON Format:** Each message is a JSON object followed by a newline character, enabling streaming parsing.

### 8.5 Initialization Handshake

The agent must perform an initialization handshake:

```typescript
async function initializeTransport(
  connection: acp.AgentSideConnection
): Promise<void> {
  // 1. Read initialization request
  const initRequest = await connection.readMessage<acp.InitializeRequest>();
  
  // 2. Validate protocol version
  if (initRequest.protocolVersion !== 1) {
    throw new Error(`Unsupported protocol version: ${initRequest.protocolVersion}`);
  }
  
  // 3. Extract client capabilities
  const clientCapabilities = initRequest.clientCapabilities;
  
  // 4. Prepare agent capabilities
  const agentCapabilities = {
    loadSession: true,
    promptCapabilities: {
      image: true,
      audio: true,
      embeddedContext: true,
    },
  };
  
  // 5. Send initialization response
  await connection.send({
    id: initRequest.id,
    result: {
      protocolVersion: 1,
      agentInfo: {
        name: "acp-middleware-callbacks-agent",
        version: "0.1.0",
      },
      agentCapabilities,
      authMethods: [],
    } as acp.InitializeResponse,
  });
}
```

### 8.6 Available Transport Methods

```typescript
// Session updates (notifications - fire and forget)
await connection.sessionUpdate({
  sessionId: string,
  update: SessionUpdate,
});

// Permission requests (waits for user response)
const response = await connection.requestPermission({
  sessionId: string,
  toolCall: ToolCallUpdate,
  options: PermissionOption[],
});

// Client resources
const fileContent = await connection.readTextFile({
  sessionId: string,
  path: string,
  line?: number,
  limit?: number,
});

await connection.writeTextFile({
  sessionId: string,
  path: string,
  content: string,
});
```

### 8.7 Complete Stdio Transport Example

```typescript
import { spawn } from 'child_process';
import * as acp from "@agentclientprotocol/sdk";
import { ndJsonStream } from '@agentclientprotocol/sdk';

// Spawn the agent process
const agentProcess = spawn('node', ['agent.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Create the NDJSON stream
const stream = acp.ndJsonStream(
  Writable.toWeb(agentProcess.stdin!),
  Readable.toWeb(agentProcess.stdout!)
);

// Create the agent connection
const connection = new acp.AgentSideConnection(
  (conn) => agentImplementation,
  stream
);

// Middleware receives connection for protocol operations
const permissionMiddleware = createACPPermissionMiddleware({
  permissionPolicy: {...},
  transport: connection,
});
```

---

## 9. Error & stopReason Mapping

### 9.1 stopReason Values

```typescript
export type StopReason =
  | 'user_requested'
  | 'tool_calls'
  | 'context_length'
  | 'max_steps'
  | 'completed'
  | 'error';
```

### 9.2 stopReason Mapper

```typescript
export function mapToStopReason(state: any): StopReason {
  // Check for user cancellation
  if (state.cancelled || state.permissionDenied) {
    return 'user_requested';
  }

  // Check for tool calls completion
  if (state.tool_calls_pending === false && state.last_tool_call_result) {
    return 'tool_calls';
  }

  // Check for context length signal
  if (state.llmOutput?.finish_reason === 'length') {
    return 'context_length';
  }

  // Check for max steps limit
  if (state.turns >= state.max_turns) {
    return 'max_steps';
  }

  // Check for explicit error
  if (state.error) {
    return 'error';  // Emit error via sessionUpdate instead
  }

  // Default to normal completion
  return 'completed';
```
}
```

### 9.3 Error Communication

Errors are communicated through:

| Error Scenario | Mechanism |
|---------------|-----------|
| Method execution failure | JSON-RPC error response |
| Agent encounters error | `stopReason: "error"` in PromptResponse |
| Client cancels operation | `stopReason: "user_requested"` |
| Tool execution failure | `tool_call_update` with `status: "failed"` |

### 9.4 ACP Error Codes & RequestError Class

ACP uses JSON-RPC 2.0 error codes with ACP-specific extensions. The SDK provides the `RequestError` class for type-safe error creation:

**RequestError Class Structure:**

```typescript
class RequestError extends Error {
  data?: unknown;
  
  constructor(
    public code: number,
    message: string,
    data?: unknown
  ) {
    super(message);
    this.name = 'RequestError';
    this.data = data;
  }
  
  toResult<T>(): Result<T> {
    return {
      error: {
        code: this.code,
        message: this.message,
        data: this.data
      }
    };
  }
  
  toErrorResponse(): ErrorResponse {
    return {
      code: this.code,
      message: this.message,
      data: this.data
    };
  }
}
```

**RequestError Factory Methods:**

```typescript
class RequestError {
  // JSON-RPC 2.0 Standard Errors
  static parseError(
    data?: unknown,
    additionalMessage?: string
  ): RequestError {
    return new RequestError(
      -32700,
      additionalMessage ?? 'Parse error' + (data ? `: ${JSON.stringify(data)}` : ''),
      data
    );
  }
  
  static invalidRequest(
    data?: unknown,
    additionalMessage?: string
  ): RequestError {
    return new RequestError(
      -32600,
      additionalMessage ?? 'Invalid request' + (data ? `: ${JSON.stringify(data)}` : ''),
      data
    );
  }
  
  static methodNotFound(method: string): RequestError {
    return new RequestError(
      -32601,
      `Method not found: ${method}`
    );
  }
  
  static invalidParams(
    data?: unknown,
    additionalMessage?: string
  ): RequestError {
    return new RequestError(
      -32602,
      additionalMessage ?? 'Invalid params' + (data ? `: ${JSON.stringify(data)}` : ''),
      data
    );
  }
  
  static internalError(
    data?: unknown,
    additionalMessage?: string
  ): RequestError {
    return new RequestError(
      -32603,
      additionalMessage ?? 'Internal error' + (data ? `: ${JSON.stringify(data)}` : ''),
      data
    );
  }
  
  // ACP-Specific Errors
  static authRequired(
    data?: unknown,
    additionalMessage?: string
  ): RequestError {
    return new RequestError(
      -32000,
      additionalMessage ?? 'Authentication required',
      data
    );
  }
  
  static resourceNotFound(
    uri?: string,
    data?: unknown
  ): RequestError {
    return new RequestError(
      -32002,
      uri ? `Resource not found: ${uri}` : 'Resource not found',
      data
    );
  }
}
```

**Error Code Reference:**

```typescript
type ACPErrorCode =
  | -32700  // Parse error (JSON-RPC standard)
  | -32600  // Invalid request (JSON-RPC standard)
  | -32601  // Method not found (JSON-RPC standard)
  | -32602  // Invalid params (JSON-RPC standard)
  | -32603  // Internal error (JSON-RPC standard)
  | -32000  // Authentication required (ACP-specific)
  | -32002  // Resource not found (ACP-specific)
```

**LangChain to ACP Error Mapping:**

| LangChain Error | ACP Error Code | RequestError Method | Example Usage |
|----------------|---------------|---------------------|---------------|
| Invalid input params | -32602 | `RequestError.invalidParams()` | `RequestError.invalidParams({ field: 'path' })` |
| Resource file not found | -32002 | `RequestError.resourceNotFound()` | `RequestError.resourceNotFound('/path/to/file')` |
| Unauthorized | -32000 | `RequestError.authRequired()` | `RequestError.authRequired()` |
| Internal agent error | -32603 | `RequestError.internalError()` | `RequestError.internalError({ details: '...' })` |
| Unknown method | -32601 | `RequestError.methodNotFound()` | `RequestError.methodNotFound('unknown_method')` |

**Usage Examples:**

```typescript
import { RequestError } from '@agentclientprotocol/sdk';

// Protocol errors
throw RequestError.methodNotFound('unknown_method');
throw RequestError.invalidParams(validationErrors);
throw RequestError.internalError({ details: 'Something went wrong' });

// ACP-specific errors
throw RequestError.authRequired();
throw RequestError.resourceNotFound('/path/to/file');

// With additional data
throw RequestError.invalidParams(
  { field: 'path', issue: 'must be absolute' },
  'Invalid file path'
);
```

---

## 10. Agent Implementation

### 10.1 Required Agent Methods

All ACP agents must implement these methods:

| Method | Purpose | Return |
|--------|---------|--------|
| `initialize` | Connection handshake, capability negotiation | `InitializeResponse` |
| `newSession` | Create new conversation session | `NewSessionResponse` with `sessionId` |
| `prompt` | Process user input | `PromptResponse` with `stopReason` |
| `cancel` | Handle cancellation | `void` |
| `setSessionMode` | Change agent mode | `SetSessionModeResponse` |
| `loadSession` | Resume existing session (optional) | `LoadSessionResponse` |

### 10.2 Complete Agent Example

```typescript
import * as acp from "@agentclientprotocol/sdk";
import { createAgent, createACPSessionMiddleware, ACPCallbackHandler } from "@skroyc/acp-middleware-callbacks";

const agentImplementation: acp.Agent = {
  async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    return {
      agentInfo: {
        name: 'acp-middleware-agent',
        title: 'ACP LangChain Agent',
        version: '0.1.0',
      },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          image: true,
          audio: true,
          embeddedContext: true,
        },
        mcp: {
          http: true,
          sse: true,
        },
      },
      authMethods: [],
    };
  },

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const sessionId = crypto.randomUUID();
    sessionStore.set(sessionId, { sessionId, cwd: params.cwd, mcpServers: params.mcpServers });
    return { sessionId };
  },

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = sessionStore.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: \${params.sessionId}`);
    }

    const agent = await getOrCreateAgent(session);

    await agent.invoke({ messages: params.prompt }, {
      callbacks: [new ACPCallbackHandler({ transport: connection })],
    });

    return { stopReason: 'end_turn' };
  },

  async cancel(params: acp.CancelNotification): Promise<void> {
    // Handle cancellation gracefully
  },
};
```

---

## 11. Type Definitions

### 11.1 Core ACP Types (Re-exported)

```typescript
import * as acp from "@agentclientprotocol/sdk";

// Re-export all protocol types
export type {
  SessionNotification,
  SessionUpdate,
  AgentMessageChunk,
  ToolCall,
  ToolCallUpdate,
  ToolCallStatus,
  ToolKind,
  ContentBlock,
  TextContent,
  ImageContent,
  AudioContent,
  ResourceLink,
  EmbeddedResource,
  RequestPermissionRequest,
  RequestPermissionResponse,
  PermissionOption,
  PermissionOptionKind,
  StopReason,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  SessionId,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";

// Re-export validation schemas for runtime type checking
export {
  zSessionId,
  zContentBlock,
  zTextContent,
  zImageContent,
  zAudioContent,
  zResourceLink,
  zEmbeddedResource,
  zToolCall,
  zToolCallUpdate,
  zRequestPermissionRequest,
} from "@agentclientprotocol/sdk/schema";
```

**Core Protocol Types:**

```typescript
// Session identifier type
export type SessionId = string;

// Protocol version constant
export const PROTOCOL_VERSION = 1;
```

**Validation Schemas:**

The SDK exports Zod validation schemas for runtime type checking:

```typescript
import * as schema from '@agentclientprotocol/sdk/schema';

// Validate session IDs
const sessionIdValidation = schema.zSessionId.safeParse(sessionId);
if (!sessionIdValidation.success) {
  throw new Error(`Invalid session ID: ${sessionIdValidation.error}`);
}

// Validate content blocks
const contentValidation = schema.zContentBlock.safeParse(contentBlock);
if (!contentValidation.success) {
  throw new Error(`Invalid content block: ${contentValidation.error}`);
}

// Validate tool calls
const toolCallValidation = schema.zToolCall.safeParse(toolCall);
if (!toolCallValidation.success) {
  throw new Error(`Invalid tool call: ${toolCallValidation.error}`);
}

// Validate permission requests
const permissionValidation = schema.zRequestPermissionRequest.safeParse(request);
if (!permissionValidation.success) {
  throw new Error(`Invalid permission request: ${permissionValidation.error}`);
}
```

### 11.2 Package-Specific Types

```typescript
export interface ACPMiddlewareConfig {
  sessionIdExtractor?: (config: RunnableConfig) => string | undefined;
  emitStateSnapshots?: "initial" | "final" | "all" | "none";
  stateMapper?: (state: any) => any;
  emitToolResults?: boolean;
  emitToolStart?: boolean;
  toolKindMapper?: (toolName: string) => ToolKind;
  permissionPolicy?: Record<string, PermissionPolicyConfig>;
  mcpServers?: MCPServerConfig;
  mcpToolOptions?: MCPToolOptions;
}

export interface ACPCallbackHandlerConfig {
  transport: ACPTransport;
  emitTextChunks?: boolean;
  contentBlockMapper?: ContentBlockMapper;
}

export interface ACPAgentConfig {
  model: LanguageModel;
  tools?: StructuredTool[];
  middleware?: AgentMiddleware[];
  callbacks?: CallbackHandler[];
  transport: ACPTransport;
}
```

---

## 12. MCP Tool Loader

### 12.1 Integration

The package integrates `@langchain/mcp-adapters` to load MCP tools.

**For the authoritative current API, see:** [langchain-mcp-adapters README](https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain-mcp-adapters)

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

---

## 13. Appendix: LangChain Type Reference

### 13.1 `createMiddleware()` Function

**Location:** `@langchain/langchain/agents`

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

### 13.2 Hook Types

**BeforeAgentHook / BeforeModelHook / AfterModelHook / AfterAgentHook:**

```typescript
type BeforeAgentHandler<TSchema, TContext> = (
  state: TSchema,
  runtime: Runtime<TContext>
) => PromiseOrValue<MiddlewareResult<TSchema>>;

export type BeforeAgentHook<TSchema, TContext> =
  | BeforeAgentHandler<TSchema, TContext>
  | { hook: BeforeAgentHandler<TSchema, TContext>; canJumpTo?: JumpToTarget[] };
```

**WrapToolCallHook:**

```typescript
type ToolCallRequest<TSchema, TContext> = {
  toolCall: ToolCall;
  tool: ClientTool | ServerTool;
  state: TSchema & AgentBuiltInState;
  runtime: Runtime<TContext>;
};

type ToolCallHandler<TSchema, TContext> = (request: ToolCallRequest<TSchema, TContext>) => Promise<ToolMessage>;

export type WrapToolCallHook<TSchema, TContext> = (
  request: ToolCallRequest<TSchema, TContext>,
  handler: ToolCallHandler<TSchema, TContext>
) => PromiseOrValue<ToolMessage | Command>;
```

### 13.3 MiddlewareResult

```typescript
export type MiddlewareResult<TState> =
  | (TState & { jumpTo?: JumpToTarget })
  | void;

export type JumpToTarget = "model" | "tools" | "end";
```

### 13.4 Runtime Type

The `Runtime` object is passed to all middleware hooks and provides access to agent execution context, control mechanisms, and state management capabilities.

```typescript
export type Runtime<TContext = unknown> = Partial<
  Omit<LangGraphRuntime<TContext>, "context" | "configurable">
> &
  WithMaybeContext<TContext> & {
    configurable?: {
      thread_id?: string;
      [key: string]: unknown;
    };
    signal?: AbortSignal | undefined;
    writer?: ((chunk: unknown) => void) | undefined;
    interrupt?: ((interruptInfo: InterruptInfo) => unknown) | undefined;
    store?: BaseStore | undefined;
  };
```

**Runtime Properties:**

| Property | Type | Purpose |
|----------|------|---------|
| `context` | `TContext` | Per-invocation data validated by contextSchema (read-only) |
| `configurable` | `object` | Configuration including thread_id for checkpoint retrieval |
| `signal` | `AbortSignal` | Abort signal for cancellation and timeout handling |
| `writer` | `function` | Emit custom streaming data to the client |
| `interrupt` | `function` | Human-in-the-loop interruption for permission requests |
| `store` | `BaseStore` | Key-value store for agent state across invocations |

**interrupt() Method - Critical for HITL:**

The `interrupt()` method enables human-in-the-loop (HITL) workflows by pausing execution to await user input:

```typescript
interface InterruptInfo {
  type: 'permission' | 'approval' | 'correction';
  request: {
    title: string;
    description?: string;
    data?: unknown;
  };
  allowedResponses: string[];
}

runtime.interrupt?: ((interruptInfo: InterruptInfo) => unknown) | undefined;
```

**Usage Pattern for Permission Handling:**

```typescript
wrapToolCall: async (request, handler) => {
  // Permission required - interrupt execution
  if (requiresPermission(request.toolCall.name)) {
    const result = await runtime.interrupt?.({
      type: 'permission',
      request: {
        title: `Permission required: ${request.toolCall.name}`,
        description: `The agent wants to perform: ${JSON.stringify(request.toolCall.args)}`,
        data: {
          toolName: request.toolCall.name,
          arguments: request.toolCall.args,
        }
      },
      allowedResponses: ['allow', 'deny', 'allow_always']
    });
    
    if (result === 'deny') {
      throw new Error('Permission denied by user');
    }
    
    // Continue with execution if allowed
    if (result === 'allow' || result === 'allow_always') {
      return await handler(request);
    }
  }
  
  return await handler(request);
}
```

**signal AbortSignal Usage:**

The `signal` property enables proper cancellation handling:

```typescript
beforeModel: async (state, runtime) => {
  // Check if execution was cancelled
  if (runtime.signal?.aborted) {
    return { messages: [] }; // Early exit on cancellation
  }
  
  // Create timeout for long-running operations
  const timeout = new AbortController();
  const timeoutId = setTimeout(() => timeout.abort(), 30000);
  
  try {
    const result = await makeApiCall(state, { signal: timeout.signal });
    return { messages: [result] };
  } finally {
    clearTimeout(timeoutId);
  }
}
```

### 13.5 RunnableConfig

```typescript
export interface RunnableConfig<
  ConfigurableFieldType extends Record<string, any> = Record<string, any>,
> extends BaseCallbackConfig {
  configurable?: ConfigurableFieldType;
  recursionLimit?: number;
  maxConcurrency?: number;
  timeout?: number;
  signal?: AbortSignal;
}
```

### 13.6 Command Type

```typescript
new Command(params: CommandParams)

interface CommandParams {
  resume?: unknown;
  update?: StateUpdate;
  goto?: string | string[];
}

type StateUpdate = {
  messages?: BaseMessage[];
  [key: string]: unknown;
};
```

### 13.7 BaseCallbackHandler

**Location:** `@langchain/core/callbacks/base`

```typescript
export interface BaseCallbackHandlerInput {
  ignoreLLM?: boolean;
  ignoreChain?: boolean;
  ignoreAgent?: boolean;
  ignoreRetriever?: boolean;
  ignoreCustomEvent?: boolean;
  raiseError?: boolean;
  awaitHandlers?: boolean;
}

export abstract class BaseCallbackHandler {
  name: string;
  ignoreLLM?: boolean;
  ignoreChain?: boolean;
  ignoreAgent?: boolean;
  ignoreRetriever?: boolean;
  ignoreCustomEvent?: boolean;
  raiseError?: boolean;
  awaitHandlers?: boolean;

  // LLM Callbacks
  handleLLMStart?(llm: Serialized, prompts: string[], runId: string, ...): Promise<any>;
  handleLLMNewToken?(token: string, idx: NewTokenIndices, runId: string, ...): Promise<any>;
  handleLLMEnd?(output: LLMResult, runId: string, ...): Promise<any>;
  handleLLMError?(error: Error, runId: string): Promise<any>;

  // Tool Callbacks
  handleToolStart?(tool: Serialized, input: string, runId: string, ...): Promise<any>;
  handleToolEnd?(output: string, runId: string, ...): Promise<any>;
  handleToolError?(error: Error, runId: string): Promise<any>;
}
```

---

## 14. Appendix: Message Role Mapping

### 14.1 LangChain to ACP Mapping

| LangChain Message | ACP Event | Notes |
|-------------------|-----------|-------|
| `AIMessage` (text) | `agent_message_chunk` | User-facing response |
| `AIMessage` (reasoning) | `agent_thought_chunk` | Internal reasoning content |
| `HumanMessage` | Not echoed | Client displays user input |
| `ToolMessage` | `tool_call_update` | Status: completed/failed |
| `SystemMessage` | Ignored | Merged into context |

### 14.2 Protocol Notes

- ```user_message_chunk```: Used ONLY for `session/load` (replaying history). Normal `session/prompt` flow does NOT echo user input.
- **Reasoning Content:** Use `agent_thought_chunk` with appropriate annotations for internal reasoning content. Use `agent_message_chunk` for user-facing text.
- **Message Ordering:** ACP provides NO ordering guarantee. Clients handle out-of-order messages by merging partial updates.
- **Session Concurrency:** ACP is strictly sequential per session. Concurrent prompts require separate sessions.

---

## 15. Testing Patterns

### 15.1 Unit Testing Middleware Hooks

**Mocking the Runtime Object:**

```typescript
import { createMiddleware } from "langchain";
import * as z from "zod";

// Create mock runtime for testing
function createMockRuntime(overrides?: Partial<Runtime>): Runtime {
  return {
    context: {},
    configurable: {
      thread_id: "test-session-123",
      ...overrides?.configurable,
    },
    signal: new AbortController().signal,
    writer: jest.fn(),
    interrupt: jest.fn(),
    store: new Map(),
    ...overrides,
  };
}

// Test beforeAgent hook
describe("ACPSessionMiddleware", () => {
  it("should extract session ID from config", async () => {
    const middleware = createACPSessionMiddleware({
      sessionIdExtractor: (config) => config.configurable?.sessionId,
    });
    
    const state = { messages: [] };
    const runtime = createMockRuntime({
      configurable: { sessionId: "test-session-123" }
    });
    
    // Access the hook function
    const hook = middleware.beforeAgent as any;
    const result = await hook(state, runtime);
    
    expect(result).toHaveProperty("sessionId", "test-session-123");
  });
});
```

### 15.2 Mocking Transport Layer

**Mock Connection for Testing:**

```typescript
import * as acp from "@agentclientprotocol/sdk";

// Create mock connection for testing middleware
function createMockConnection(): jest.Mocked<acp.AgentSideConnection> {
  return {
    sessionUpdate: jest.fn().mockResolvedValue(undefined),
    requestPermission: jest.fn().mockResolvedValue({
      outcome: { outcome: "selected", optionId: "allowOnce" }
    }),
    readTextFile: jest.fn().mockResolvedValue({ content: "test file content" }),
    writeTextFile: jest.fn().mockResolvedValue({}),
    // Add other methods as needed
  } as any;
}

// Test permission middleware
describe("ACPPermissionMiddleware", () => {
  it("should request permission for restricted tools", async () => {
    const connection = createMockConnection();
    
    const middleware = createACPPermissionMiddleware({
      permissionPolicy: {
        "delete_file": { kind: "write" as const, requirePermission: true },
      },
      transport: connection,
    });
    
    // Simulate tool call
    const request = {
      toolCall: {
        id: "call-123",
        name: "delete_file",
        args: { path: "/test/file.txt" }
      },
      tool: {} as any,
      state: { messages: [] },
      runtime: createMockRuntime()
    };
    
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: "text", text: "File deleted" }]
    });
    
    const wrapToolCall = (middleware as any).wrapToolCall;
    await wrapToolCall(request, handler);
    
    expect(connection.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCall: expect.objectContaining({
          title: "Calling delete_file",
          status: "pending"
        }),
        options: expect.arrayContaining([
          expect.objectContaining({ kind: "allow_once" }),
          expect.objectContaining({ kind: "allow_always" })
        ])
      })
    );
  });
});
```

### 15.3 Integration Testing with LangChain Agents

**Testing Complete Agent Workflow:**

```typescript
import { createAgent } from "langchain";
import { createACPSessionMiddleware, createACPToolMiddleware } from "@skroyc/acp-middleware-callbacks";
import * as acp from "@agentclientprotocol/sdk";

describe("ACP Agent Integration", () => {
  it("should handle complete prompt workflow", async () => {
    const connection = createMockConnection();
    
    // Create middleware stack
    const sessionMiddleware = createACPSessionMiddleware({
      sessionIdExtractor: (config) => config.configurable?.sessionId,
    });
    
    const toolMiddleware = createACPToolMiddleware({
      toolKindMapper: (name) => {
        if (name.includes("read")) return "read";
        if (name.includes("bash")) return "bash";
        return "custom";
      }
    });
    
    // Create agent with middleware
    const agent = createAgent({
      model: mockModel, // Mock language model
      tools: [mockFileTool, mockBashTool],
      middleware: [sessionMiddleware, toolMiddleware],
    });
    
    // Invoke agent
    const result = await agent.invoke({
      messages: [{ role: "user", content: "Read the config file" }]
    }, {
      configurable: { sessionId: "test-session" },
      callbacks: [new ACPCallbackHandler({ transport: connection })]
    });
    
    // Verify session updates were sent
    expect(connection.sessionUpdate).toHaveBeenCalled();
    
    // Verify tool call was emitted
    const toolCallUpdates = (connection.sessionUpdate as jest.Mock).mock.calls
      .filter(call => call[0]?.update?.sessionUpdate === "tool_call");
    
    expect(toolCallUpdates.length).toBeGreaterThan(0);
  });
});
```

### 15.4 Testing Content Block Mapping

**Content Mapper Unit Tests:**

```typescript
import { DefaultContentBlockMapper } from "./contentMapper";

describe("ContentBlockMapper", () => {
  let mapper: DefaultContentBlockMapper;
  
  beforeEach(() => {
    mapper = new DefaultContentBlockMapper();
  });
  
  it("should map text content correctly", () => {
    const input = { type: "text", text: "Hello world" };
    const result = mapper.toACP(input);
    
    expect(result).toEqual({
      type: "text",
      _meta: null,
      annotations: null,
      text: "Hello world"
    });
  });
  
  it("should map reasoning content with audience annotation", () => {
    const input = { 
      type: "reasoning", 
      reasoning: "Let me think about this...",
      priority: 1
    };
    const result = mapper.toACP(input);
    
    expect(result).toEqual({
      type: "text",
      _meta: { _internal: true, reasoning: true },
      annotations: {
        audience: ['assistant'] as const,
        priority: 1,
        lastModified: null,
        _meta: null
      },
      text: "Let me think about this..."
    });
  });
  
  it("should handle unknown content types gracefully", () => {
    const input = { type: "unknown", customField: "value" } as any;
    const result = mapper.toACP(input);
    
    expect(result.type).toBe("text");
    expect(result.text).toContain("Unknown");
  });
});
```

### 15.5 Common Testing Pitfalls

**1. Async/Await Handling:**
```typescript
// ❌ Wrong: Not awaiting async hook
it("should fail without await", async () => {
  const result = hook(state, runtime);
  expect(result).toHaveProperty("sessionId");
});

// ✅ Correct: Properly awaiting async hooks
it("should work with proper await", async () => {
  const result = await hook(state, runtime);
  expect(result).toHaveProperty("sessionId");
});
```

**2. State Mutation:**
```typescript
// ❌ Wrong: Mutating state in place
hook: (state) => {
  state.sessionId = "new-id"; // Wrong!
  return state;
}

// ✅ Correct: Returning partial state
hook: (state) => {
  return { sessionId: "new-id" }; // Correct!
}
```

**3. AbortSignal Testing:**
```typescript
// ❌ Wrong: Not handling aborted signal
it("should handle cancellation", async () => {
  const signal = new AbortController().signal;
  signal.abort(); // Abort immediately
  
  const runtime = createMockRuntime({ signal });
  const result = await hook(state, runtime);
  
  // Should check for abort signal
  expect(result).toBeDefined();
});

// ✅ Correct: Checking abort signal
it("should handle cancellation", async () => {
  const controller = new AbortController();
  const runtime = createMockRuntime({ signal: controller.signal });
  
  // Abort after a tick
  setTimeout(() => controller.abort(), 0);
  
  const result = await hook(state, runtime);
  expect(result).toEqual({ messages: [] }); // Early exit
});
```

---

**END OF SPEC**
