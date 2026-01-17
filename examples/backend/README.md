# Zed Backend Example

Complete example demonstrating `@skroyc/acp-middleware-callbacks` integrated with Zed editor via the Agent Client Protocol (ACP).

## Overview

This example provides a production-like backend implementation that:

- Implements the full ACP `Agent` interface
- Includes mock tools for file system, terminal, and search operations
- Demonstrates all middleware components working together
- Provides a bridge between our package's interfaces and the SDK

## Architecture

```
/examples/backend/
├── src/
│   ├── index.ts           # Entry point (stdio transport)
│   ├── agent.ts           # Agent interface implementation
│   ├── model.ts           # LLM configuration
│   └── tools/
│       ├── index.ts       # Tool exports
│       ├── readFile.ts    # File reading
│       ├── editFile.ts    # File editing
│       ├── bash.ts        # Terminal commands
│       ├── search.ts      # Search operations
│       ├── think.ts       # Reasoning output
│       └── deleteFile.ts  # File deletion
├── package.json
├── tsconfig.json
└── README.md
```

## Setup

### Prerequisites

- Node.js 18+
- Bun 1.0+ (recommended) or npm
- Zed editor (optional, for testing the integration)

### Installation

```bash
# Navigate to the backend example directory
cd examples/backend

# Install dependencies
bun install
# or
npm install
```

### Environment Variables

Optional environment variables for model configuration:

```bash
export MODEL_PROVIDER=openai        # openai, openai-responses, or local
export MODEL_NAME=gpt-4o
export OPENAI_API_KEY=your-api-key
export TEMPERATURE=0.7
export MAX_TOKENS=4096
```

## Running the Example

### Basic Usage

```bash
# Run the example
bun run src/index.ts
# or
npm start
```

### Building

```bash
# TypeScript compilation
npm run build
```

## Tool Descriptions

### File Operations

#### read_file
Reads content from a file in the simulated file system.

**Parameters:**
- `path` (string): The path to the file to read

**Example:**
```
Tool: read_file
Input: {"path": "src/index.ts"}
```

#### edit_file
Edits content in an existing file.

**Parameters:**
- `path` (string): The path to the file to edit
- `oldText` (string): The text to replace
- `newText` (string): The text to replace it with

**Example:**
```
Tool: edit_file
Input: {"path": "src/index.ts", "oldText": "Hello", "newText": "Hi"}
```

#### create_file
Creates a new file in the simulated file system.

**Parameters:**
- `path` (string): The path for the new file
- `content` (string): The content to write

**Example:**
```
Tool: create_file
Input: {"path": "new-file.ts", "content": "// New file content"}
```

#### delete_file
Deletes a file from the simulated file system.

**Parameters:**
- `path` (string): The path to the file to delete
- `recursive` (boolean): Whether to recursively delete a directory

**Example:**
```
Tool: delete_file
Input: {"path": "old-file.ts"}
```

### Terminal Operations

#### bash
Executes a bash command in the mock terminal environment.

**Parameters:**
- `command` (string): The bash command to execute

**Example:**
```
Tool: bash
Input: {"command": "ls -la"}
```

### Search Operations

#### search
Searches for text in files within the simulated file system.

**Parameters:**
- `query` (string): The search query or pattern
- `caseSensitive` (boolean): Whether the search is case sensitive (default: false)
- `useRegex` (boolean): Whether the query is a regular expression (default: false)
- `filePattern` (string): File pattern to search in (default: "*")

**Example:**
```
Tool: search
Input: {"query": "function", "caseSensitive": false}
```

#### list_files
Lists files in the simulated file system.

**Parameters:**
- `path` (string): The directory path to list (default: ".")
- `pattern` (string): File name pattern to match (default: "*")

**Example:**
```
Tool: list_files
Input: {"path": "src", "pattern": "*.ts"}
```

### Reasoning Operations

#### think
Records thoughts, reasoning, planning, or analysis for debugging.

**Parameters:**
- `thought` (string): The thought or reasoning to record
- `type` (string): The type of thought - "reasoning", "planning", "analysis", or "reflection" (default: "reasoning")
- `tags` (string[]): Optional tags for the thought

**Example:**
```
Tool: think
Input: {"thought": "I should check the file structure first", "type": "planning"}
```

#### view_thoughts
Views the thought history and reasoning log.

**Example:**
```
Tool: view_thoughts
Input: {}
```

## Expected Output Formats

### Agent Messages

The agent sends messages in the following format:

```json
{
  "messageId": "msg-1234567890",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "content": "Response text here"
    }
  ],
  "contentFormat": "text",
  "stopReason": {
    "type": "completion",
    "reason": "Response generated"
  }
}
```

### Session Updates

Session updates are sent for tool calls and state changes:

```json
{
  "sessionId": "session-123",
  "update": {
    "type": "tool_call",
    "tool": "read_file",
    "parameters": {"path": "src/index.ts"}
  }
}
```

## Zed Integration

### Testing with Zed

1. **Start the backend:**
   ```bash
   cd examples/backend
   bun run src/index.ts
   ```

2. **Configure Zed:**
   Add to your Zed settings (`~/.config/zed/settings.json`):
   ```json
   {
     "agent": {
       "command": "bun",
       "args": ["run", "examples/backend/src/index.ts"],
       "env": {}
     }
   }
   ```

3. **Open Zed** and start an agent session.

### Zed-Specific Configuration

The example uses stdio transport via `ndJsonStream` for communication with Zed:

```typescript
const stream = ndJsonStream({
  stdin: process.stdin,
  stdout: process.stdout,
});

const connection = new AgentSideConnection(
  (sdkConnection) => new ACPAgent(sdkConnection),
  stream
);
```

## Middleware Demonstration

This example demonstrates all middleware components:

### Session Middleware
- Tracks session creation and loading
- Emits state snapshots
- Manages turn count

### Tool Middleware  
- Tracks tool calls and results
- Logs tool execution for debugging

### Mode Middleware
- Sets default agent mode to "agentic"
- Enforces mode restrictions

### Permission Middleware
- Requires permission for destructive operations (delete, write)
- Allows read operations without permission
- Requires permission for shell commands

## Customization

### Adding Custom Tools

1. Create a new tool file in `src/tools/`
2. Use the `tool()` decorator from LangChain
3. Export the tool and add it to `createTools()` in `index.ts`

Example:
```typescript
import { tool } from "langchain/tools";
import { z } from "zod";

export const customTool = tool(
  async ({ input }: { input: string }) => {
    // Tool implementation
    return "Result";
  },
  {
    name: "custom_tool",
    description: "Description of what the tool does",
    schema: z.object({
      input: z.string().describe("Input parameter description"),
    }),
  }
);
```

### Modifying Model Configuration

Update `src/model.ts` to support additional model providers:

```typescript
case "custom":
  return new CustomModel({
    model: this.config.modelName,
    // Custom configuration
  });
```

### Extending Mock File System

Add files to the mock file system in `src/tools/readFile.ts`:

```typescript
mockFileSystem.set("path/to/file.txt", "File content");
```

## Troubleshooting

### Common Issues

**Connection refused:**
- Ensure the backend is running before starting Zed
- Check that stdio transport is properly configured

**API key errors:**
- Set the appropriate environment variable (`OPENAI_API_KEY`)
- Verify the API key is valid

**Tool execution failures:**
- Check that the mock file system contains the expected files
- Verify tool parameters match the expected schema

**TypeScript errors:**
- Run `npm run build` to see detailed compilation errors
- Ensure all dependencies are installed

### Debug Mode

Enable debug output by setting the environment variable:

```bash
DEBUG=1 bun run src/index.ts
```

## Architecture Details

### Connection Flow

1. **Initialization**: `index.ts` creates stdio transport using `ndJsonStream`
2. **Connection**: `AgentSideConnection` accepts connections from Zed
3. **Bridging**: `AgentConnectionAdapter` maps our interfaces to SDK types
4. **Agent**: `ACPAgent` handles session lifecycle and prompt processing
5. **Middleware**: LangChain middleware processes requests and responses
6. **Tools**: Mock tools simulate file system and terminal operations

### Message Flow

```
Zed → stdio → AgentSideConnection → AgentConnectionAdapter → ACPAgent
                                                                 ↓
                                                          LangChain Agent
                                                                 ↓
                                                          Middleware Stack
                                                                 ↓
                                                          Tool Execution
                                                                 ↓
                                                          Response → Zed
```

## Contributing

This is a development/demo example. To contribute:

1. Fork the repository
2. Create a feature branch
3. Add your improvements
4. Submit a pull request

## License

MIT License - see the main repository for details.