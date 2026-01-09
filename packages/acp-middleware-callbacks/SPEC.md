# SPEC: @skroyc/acp-middleware-callbacks

## 1. Overview

### 1.1 Purpose

This package provides TypeScript middleware and callbacks that bridge LangChain \`createAgent()\` implementations to the **Agent Client Protocol (ACP)** for code editors and AI development environments. The package enables any LangChain agent to become ACP-compliant with minimal configuration.

**Core Features:**
- **Middleware:** Lifecycle hooks for session management, tool execution, and permission handling
- **Callbacks:** Streaming event emission for real-time agent updates
- **Utilities:** Content block mappers, tool converters, and transport utilities

### 1.2 Protocol Overview

ACP is a protocol standardizing editor-to-agent communication with:
- **Structured session management:** \`newSession\`, \`prompt\`, \`loadSession\`
- **Permission-based tool execution:** \`requestPermission\` workflow
- **Rich content blocks:** text, image, audio, resources
- **Standardized updates:** \`sessionUpdate\` notifications
- **Bidirectional communication:** JSON-RPC 2.0 over stdio

### 1.3 Key Differences from AG-UI

This package shares architectural patterns with \`@skroyc/ag-ui-middleware-callbacks\` but is fundamentally different:

| Aspect | AG-UI | ACP |
|--------|-------|-----|
| Communication | Backend → Frontend event streaming | Editor ↔ Agent bidirectional |
| Transport | SSE/WebSocket | Stdio with JSON-RPC 2.0 |
| Session State | No built-in session management | Full session lifecycle |
| Permission Flow | No built-in support | \`requestPermission\` workflow |
| Content Model | Events-based | Content blocks with annotations |

### 1.4 LangChain Integration

This package works with **LangChain v1.0.0+** which uses LangGraph under the hood:

- \`\`\`createAgent()\`\`\`: High-level API that compiles a StateGraph with middleware support
- \`\`\`thread_id\`\`\`: Session identifier via \`configurable.thread_id\` for checkpoint retrieval
- **Checkpoint:** Persisted state snapshot containing messages, custom state, and middleware state
- **Checkpointer:** Storage backend (e.g., \`MemorySaver\`, database) for checkpoints

### 1.5 Version Compatibility

| Component | Version | Notes |
|-----------|---------|-------|
| **LangChain** | ^1.0.0 | Middleware API introduced in v1.0.0 |
| **@langchain/core** | ^1.1.0 | Content block system required |
| **@agentclientprotocol/sdk** | ^1.0.0 | ACP protocol types |
| **Node.js** | >=18.0.0 | Universal runtime minimum |
| **TypeScript** | >=5.0.0 | Strict mode required |
| **ACP Protocol** | v1 | Current stable version |

**Minimum Runtime:** Node.js 18 (for \`structuredClone\`, \`ReadableStream\`, \`TextEncoder\`)

---

## 2. Requirements

### 2.1 Core Requirements

| Priority | Requirement | Description |
|----------|-------------|-------------|
| **MUST** | ACP Session Integration | Support \`session/new\`, \`session/prompt\`, \`session/update\` flow |
| **MUST** | Tool Call Lifecycle | Emit \`tool_call\`, \`tool_call_update\` events with ACP format |
| **MUST** | Permission Handling | Implement HITL-style interruption for ACP \`requestPermission\` |
| **MUST** | Content Block Mapping | Convert LangChain messages to ACP content blocks |
| **MUST** | MCP Server Support | Integrate \`@langchain/mcp-adapters\` for MCP tool loading |
| **MUST** | Stdio Transport | ACP-compliant stdio communication pattern |
| **MUST** | Error Mapping | Map LangChain errors to ACP \`stopReason\` values |
| **SHOULD** | Reasoning Content | Map LangChain \`reasoning\` blocks to \`agent_message_chunk\` with audience annotation |
| **SHOULD** | Mode Middleware | Optional middleware for \`current_mode_update\` handling |
| **SHOULD** | Plan Updates | Optional middleware for \`plan\` session updates (custom extension) |
| **COULD** | Multi-Modal Support | Pass through image/audio content blocks |
| **WON'T** | Client Implementation | Only backend ACP layer, no frontend code |

### 2.2 Functional Requirements

**REQ-1:** A LangChain agent wrapped with this package must respond to ACP \`session/prompt\` requests by:
- Emitting streaming \`sessionUpdate\` notifications
- Handling permission requests via interruption
- Returning a valid \`stopReason\`

**REQ-2:** The package must automatically convert LangChain \`AIMessage\` content to ACP \`agent_message_chunk\` events. For reasoning content, emit as \`agent_message_chunk\` with \`audience: ["assistant"]\` annotation.

**REQ-3:** The package must convert LangChain \`ToolMessage\` to ACP \`tool_call_update\` events with proper status lifecycle.

**REQ-4:** The package must accept MCP server configurations and dynamically load tools using \`@langchain/mcp-adapters\`.

---

## 3. Architecture

### 3.1 High-Level Architecture

\`\`\`
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
\`\`\`

### 3.2 Package Structure

\`\`\`
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
\`\`\`

---

## 4. Middleware Implementation

### 4.1 Session Middleware (\`createACPSessionMiddleware\`)

Manages ACP session lifecycle within LangChain execution.

**Key Concepts:**
- Session ID **MUST** equal LangGraph checkpoint thread_id
- Middleware configures checkpointer to use sessionId as thread_id
- Enables full state recovery across all turns
- ACP session is multi-turn (maintains conversation history)

**Interface:**

\`\`\`typescript
interface ACPSessionMiddlewareConfig {
  sessionIdExtractor?: (config: RunnableConfig) => string | undefined;
  emitStateSnapshots?: "initial" | "final" | "all" | "none";
  stateMapper?: (state: any) => any;
}

export function createACPSessionMiddleware(
  config: ACPSessionMiddlewareConfig
): AgentMiddleware;
\`\`\`

**Usage:**

\`\`\`typescript
const sessionMiddleware = createACPSessionMiddleware({
  sessionIdExtractor: (config) => config.configurable?.sessionId,
  emitStateSnapshots: "none",
});

const agent = createAgent({
  model: "claude-sonnet-4-20250529",
  middleware: [sessionMiddleware],
});
\`\`\`

**Session Lifecycle Events:**
- \`newSession\`: Creates a new session (called once at conversation start)
- \`session/prompt\`: Sends user message within existing session (called multiple times)
- \`session/load\`: Restores existing session and streams conversation history
- \`session/cancel\`: Handles cancellation gracefully

**Session Load Flow:**
1. Agent restores internal session state (checkpoints, MCP connections)
2. Agent streams entire conversation history via \`user_message_chunk\` and \`agent_message_chunk\`
3. Client receives notifications and reconstructs full conversation UI
4. Agent proceeds with next prompt using restored context

### 4.2 Tool Middleware (\`createACPToolMiddleware\`)

Intercepts LangChain tool calls and emits ACP \`tool_call\` / \`tool_call_update\` events.

**Interface:**

\`\`\`typescript
interface ACPToolMiddlewareConfig {
  emitToolResults?: boolean;
  emitToolStart?: boolean;
  toolKindMapper?: (toolName: string) => ToolKind;
  contentMapper?: (result: any) => ToolCallContent[];
}

export function createACPToolMiddleware(
  config: ACPToolMiddlewareConfig
): AgentMiddleware;
\`\`\`

**Tool Call Lifecycle:**

\`\`\`typescript
wrapToolCall: async (request, handler) => {
  const { toolCallId, name, args } = request;
  const sessionId = runtime.config.configurable?.sessionId;

  // 1. Emit pending tool call
  await connection.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: "tool_call",
      toolCallId,
      title: \`Calling \${name}\`,
      kind: mapToolKind(name),
      status: "pending",
      _meta: null,
      locations: extractLocations(args),
      rawInput: args,
      content: null,
      rawOutput: null,
    },
  });

  // 2. Emit in_progress
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

    // 4. Emit completed
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
    // 4. Emit failed
    await connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "failed",
        _meta: null,
        content: [{ type: "content", content: { type: "text", text: error.message } }],
      },
    });
    throw error;
  }
}
\`\`\`

**Tool Call Status Flow:**
\`\`\`
pending → in_progress → completed
                    → failed
\`\`\`

**Tool Kinds:**

\`\`\`typescript
type ToolKind =
  | 'read'         // File reading operations
  | 'edit'         // File modification operations
  | 'delete'       // File deletion operations
  | 'move'         // File relocation operations
  | 'search'       // Search operations
  | 'execute'      // Command execution
  | 'think'        // Reasoning/thought operations
  | 'fetch'        // Data fetching operations
  | 'switch_mode'  // Mode switching
  | 'other';       // Uncategorized tools
\`\`\`

### 4.3 Permission Middleware (\`createACPPermissionMiddleware\`)

Implements HITL-style interruption for ACP permission requests.

**Interface:**

\`\`\`typescript
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
\`\`\`

**Permission Flow:**

\`\`\`typescript
wrapToolCall: async (request, handler) => {
  const toolCall = request.toolCall;
  const sessionId = runtime.config.configurable?.sessionId;

  // 1. Emit permission request
  const response = await connection.requestPermission({
    sessionId,
    toolCall: {
      toolCallId: toolCall.id,
      title: \`Calling \${toolCall.name}\`,
      kind: mapToolKind(toolCall.name),
      status: "pending",
      _meta: null,
      locations: extractLocations(toolCall.args),
      rawInput: toolCall.args,
      content: null,
      rawOutput: null,
    },
    options: [
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "always", name: "Always Allow", kind: "allow_always" },
      { optionId: "reject", name: "Deny", kind: "reject_once" },
      { optionId: "never", name: "Never Allow", kind: "reject_always" },
    ],
  });

  // 2. Handle response
  if (response.outcome.outcome === "cancelled") {
    await connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: toolCall.id,
        status: "failed",
        _meta: null,
        content: [{ type: "content", content: { type: "text", text: "Permission cancelled" } }],
      },
    });
    throw new Error("Permission cancelled by user");
  }

  if (response.outcome.outcome === "selected" &&
      (response.outcome.optionId === "reject" || response.outcome.optionId === "never")) {
    await connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: toolCall.id,
        status: "failed",
        _meta: null,
        content: [{ type: "content", content: { type: "text", text: "Permission denied" } }],
      },
    });
    throw new Error("Permission denied");
  }

  // User approved - continue execution
  return await handler(request);
}
\`\`\`

### 4.4 Mode Middleware (\`createACPModeMiddleware\`) - Optional

Handles ACP mode changes via optional middleware.

**Interface:**

\`\`\`typescript
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
\`\`\`

**Supported Modes:**

| Mode | Behavior |
|------|----------|
| \`agentic\` | Full autonomy, can use all tools without restrictions |
| \`interactive\` | Requires confirmation for sensitive operations |
| \`readonly\` | No tool execution, only read operations |
| \`planning\` | Emits \`plan\` updates; tool execution deferred |

**Mode Switching:**

\`\`\`typescript
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
\`\`\`

---

## 5. Callback Handler Implementation

### 5.1 ACPCallbackHandler

Handles streaming events (token generation, message chunks).

**Interface:**

\`\`\`typescript
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
\`\`\`

**Token Streaming Implementation:**

\`\`\`typescript
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
\`\`\`

---

## 6. Content Block Mapping

### 6.1 ACP Content Block Types

ACP defines five content block types as a discriminated union:

\`\`\`typescript
export type ContentBlock =
  | (TextContent & { type: 'text'; })
  | (ImageContent & { type: 'image'; })
  | (AudioContent & { type: 'audio'; })
  | (ResourceLink & { type: 'resource_link'; })
  | (EmbeddedResource & { type: 'resource'; });
\`\`\`

### 6.2 Content Block Definitions

**TextContent:**

\`\`\`typescript
export type TextContent = {
  _meta?: Record<string, unknown> | null;
  annotations?: Annotations | null;
  text: string;
};

export type Annotations = {
  _meta?: Record<string, unknown> | null;
  audience?: Array<'user' | 'assistant' | 'system' | 'developer'> | null;
  lastModified?: string | null;
  priority?: number | null;
};
\`\`\`

**ImageContent:**

\`\`\`typescript
export type ImageContent = {
  _meta?: Record<string, unknown> | null;
  annotations?: Annotations | null;
  data: string;        // Base64-encoded
  mimeType: string;
  uri?: string | null;
};
\`\`\`

**AudioContent:**

\`\`\`typescript
export type AudioContent = {
  _meta?: Record<string, unknown> | null;
  annotations?: Annotations | null;
  data: string;        // Base64-encoded
  mimeType: string;
};
\`\`\`

**ResourceLink:**

\`\`\`typescript
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
\`\`\`

**EmbeddedResource:**

\`\`\`typescript
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
\`\`\`

### 6.3 LangChain to ACP Mapping

| LangChain Content | ACP Content Block | Notes |
|-------------------|-------------------|-------|
| \`text\` | \`agent_message_chunk\` | User-facing response |
| \`image\` | \`agent_message_chunk\` | Base64-encoded image |
| \`audio\` | \`agent_message_chunk\` | Base64-encoded audio |
| \`file\` (reference) | \`resource_link\` | Reference without content |
| \`file\` (with content) | \`resource\` | Embedded resource |
| \`reasoning\` | \`agent_message_chunk\` | With audience annotation |

**Note on Reasoning:** ACP does not have \`agent_thought_chunk\`. Emit reasoning as \`agent_message_chunk\` with \`audience: ["assistant"]\` annotation to indicate internal content.

### 6.4 Content Block Mapper Implementation

\`\`\`typescript
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
            audience: ["assistant"],
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
\`\`\`

---

## 7. Session Update Types

### 7.1 Standard SessionUpdate Types

\`\`\`typescript
type SessionUpdate =
  | { sessionUpdate: "user_message_chunk"; content: ContentBlock }
  | { sessionUpdate: "agent_message_chunk"; content: ContentBlock }
  | { sessionUpdate: "tool_call"; toolCallId: string; /* ToolCall fields */ }
  | { sessionUpdate: "tool_call_update"; /* ToolCallUpdate fields */ }
  | { sessionUpdate: "available_commands_update"; commands: string[] }
  | { sessionUpdate: "current_mode_update"; mode: { modeIds: string[]; selectedModeId: string } }
  | { sessionUpdate: "config_option_update"; configOptions: SessionConfigOption[] }
  | { sessionUpdate: "session_info_update"; title?: string; updatedAt?: string };
\`\`\`

### 7.2 Custom Extensions

**Plan Updates (Custom Extension - Not Standard):**

\`\`\`typescript
| { sessionUpdate: "plan"; plan: Plan }
\`\`\`

The \`plan\` type is a custom extension. Clients must explicitly support this extension.

---

## 8. Stdio Transport Implementation

### 8.1 Initialization Handshake

The agent must perform an initialization handshake:

\`\`\`typescript
async function initializeTransport(
  connection: acp.AgentSideConnection
): Promise<void> {
  // 1. Read initialization request
  const initRequest = await connection.readMessage<acp.InitializeRequest>();
  
  // 2. Validate protocol version
  if (initRequest.protocolVersion !== 1) {
    throw new Error(\`Unsupported protocol version: \${initRequest.protocolVersion}\`);
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
\`\`\`

### 8.2 Using ACP SDK Transport

\`\`\`typescript
import * as acp from "@agentclientprotocol/sdk";

// Create NDJSON stdio stream
const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdin),
  Readable.toWeb(process.stdout)
);

// Create agent connection
const connection = new acp.AgentSideConnection(
  (conn) => agentImplementation,
  stream
);

// Middleware receives connection for protocol operations
const permissionMiddleware = createACPPermissionMiddleware({
  permissionPolicy: {...},
  transport: connection,
});
\`\`\`

### 8.3 Available Transport Methods

\`\`\`typescript
// Session updates (notifications)
await connection.sessionUpdate({
  sessionId: string,
  update: SessionUpdate,
});

// Permission requests (wait for response)
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
\`\`\`

---

## 9. Error & stopReason Mapping

### 9.1 stopReason Values

\`\`\`typescript
type ACPStopReason =
  | "end_turn"              // Normal completion
  | "max_tokens"            // Context window exceeded
  | "max_turn_requests"     // Step limit reached
  | "refusal"               // Agent refused to respond
  | "cancelled"             // User cancelled the operation
\`\`\`

### 9.2 stopReason Mapper

\`\`\`typescript
export function mapToStopReason(state: any): ACPStopReason {
  // Check for user cancellation
  if (state.cancelled || state.permissionDenied) {
    return "cancelled";
  }

  // Check for refusal from model
  if (state.llmOutput?.finish_reason === "refusal") {
    return "refusal";
  }

  // Check for context length signal
  if (state.llmOutput?.finish_reason === "length") {
    return "max_tokens";
  }

  // Check for explicit error
  if (state.error) {
    return "end_turn";  // Emit error via sessionUpdate instead
  }

  // Default to normal completion
  return "end_turn";
}
\`\`\`

### 9.3 Error Communication

ACP has no 'error' stopReason. Errors are communicated through:

| Error Scenario | Mechanism |
|---------------|-----------|
| Method execution failure | JSON-RPC error response |
| Agent refuses to respond | \`stopReason: "refusal"\` in PromptResponse |
| Client cancels operation | \`stopReason: "cancelled"\` |
| Tool execution failure | \`tool_call_update\` with \`status: "failed"\` |

---

## 10. Agent Implementation

### 10.1 Required Agent Methods

All ACP agents must implement these methods:

| Method | Purpose | Return |
|--------|---------|--------|
| \`initialize\` | Connection handshake, capability negotiation | \`InitializeResponse\` |
| \`newSession\` | Create new conversation session | \`NewSessionResponse\` with \`sessionId\` |
| \`prompt\` | Process user input | \`PromptResponse\` with \`stopReason\` |
| \`cancel\` | Handle cancellation | \`void\` |
| \`setSessionMode\` | Change agent mode | \`SetSessionModeResponse\` |
| \`loadSession\` | Resume existing session (optional) | \`LoadSessionResponse\` |

### 10.2 Complete Agent Example

\`\`\`typescript
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
      throw new Error(\`Session not found: \${params.sessionId}\`);
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
\`\`\`

---

## 11. Type Definitions

### 11.1 Core ACP Types (Re-exported)

\`\`\`typescript
import * as acp from "@agentclientprotocol/sdk";

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
} from "@agentclientprotocol/sdk";
\`\`\`

### 11.2 Package-Specific Types

\`\`\`typescript
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
\`\`\`

---

## 12. MCP Tool Loader

### 12.1 Integration

The package integrates \`@langchain/mcp-adapters\` to load MCP tools.

**For the authoritative current API, see:** [langchain-mcp-adapters README](https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain-mcp-adapters)

**Basic Usage:**

\`\`\`typescript
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
\`\`\`

---

## 13. Appendix: LangChain Type Reference

### 13.1 \`createMiddleware()\` Function

**Location:** \`@langchain/langchain/agents\`

\`\`\`typescript
export function createMiddleware<
  TSchema extends InteropZodObject | undefined = undefined,
  TContextSchema extends InteropZodObject | undefined = undefined,
  TTools extends readonly (ClientTool | ServerTool)[] = readonly (
    | ClientTool
    | ServerTool
  )[],
>(config: MiddlewareConfig<TSchema, TContextSchema, TTools>): AgentMiddleware;
\`\`\`

### 13.2 Hook Types

**BeforeAgentHook / BeforeModelHook / AfterModelHook / AfterAgentHook:**

\`\`\`typescript
type BeforeAgentHandler<TSchema, TContext> = (
  state: TSchema,
  runtime: Runtime<TContext>
) => PromiseOrValue<MiddlewareResult<TSchema>>;

export type BeforeAgentHook<TSchema, TContext> =
  | BeforeAgentHandler<TSchema, TContext>
  | { hook: BeforeAgentHandler<TSchema, TContext>; canJumpTo?: JumpToTarget[] };
\`\`\`

**WrapToolCallHook:**

\`\`\`typescript
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
\`\`\`

### 13.3 MiddlewareResult

\`\`\`typescript
export type MiddlewareResult<TState> =
  | (TState & { jumpTo?: JumpToTarget })
  | void;

export type JumpToTarget = "model" | "tools" | "end";
\`\`\`

### 13.4 Runtime Type

\`\`\`typescript
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
\`\`\`

### 13.5 RunnableConfig

\`\`\`typescript
export interface RunnableConfig<
  ConfigurableFieldType extends Record<string, any> = Record<string, any>,
> extends BaseCallbackConfig {
  configurable?: ConfigurableFieldType;
  recursionLimit?: number;
  maxConcurrency?: number;
  timeout?: number;
  signal?: AbortSignal;
}
\`\`\`

### 13.6 Command Type

\`\`\`typescript
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
\`\`\`

### 13.7 BaseCallbackHandler

**Location:** \`@langchain/core/callbacks/base\`

\`\`\`typescript
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
\`\`\`

---

## 14. Appendix: Message Role Mapping

### 14.1 LangChain to ACP Mapping

| LangChain Message | ACP Event | Notes |
|-------------------|-----------|-------|
| \`AIMessage\` (text) | \`agent_message_chunk\` | User-facing response |
| \`AIMessage\` (reasoning) | \`agent_message_chunk\` | With audience annotation |
| \`HumanMessage\` | Not echoed | Client displays user input |
| \`ToolMessage\` | \`tool_call_update\` | Status: completed/failed |
| \`SystemMessage\` | Ignored | Merged into context |

### 14.2 Protocol Notes

- \`\`\`user_message_chunk\`\`\`: Used ONLY for \`session/load\` (replaying history). Normal \`session/prompt\` flow does NOT echo user input.
- **No \`agent_thought_chunk\`:** ACP does not have this type. Emit reasoning as \`agent_message_chunk\` with appropriate annotations.
- **Message Ordering:** ACP provides NO ordering guarantee. Clients handle out-of-order messages by merging partial updates.
- **Session Concurrency:** ACP is strictly sequential per session. Concurrent prompts require separate sessions.

---

**END OF SPEC**
