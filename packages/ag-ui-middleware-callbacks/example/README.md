# AG-UI Middleware Callbacks Example

A minimal working example demonstrating the `ag-ui-middleware-callbacks` package with AG-UI protocol compliance.

## Prerequisites

- **Bun** (latest version) - Install from [bun.sh](https://bun.sh)
- **OpenAI API Key** (or compatible endpoint like Ollama, LM Studio, etc.)

## Quick Start

```bash
# Navigate to the example directory
cd packages/ag-ui-middleware-callbacks/example

# Install dependencies
bun install

# Start the development server
bun run dev
```

Then open http://localhost:3000 in your browser.

## Configuration

1. **Base URL**: OpenAI-compatible endpoint (e.g., `https://api.openai.com/v1`)
2. **API Key**: Your API key (not stored, sent only to the server)
3. **Model**: Model name (e.g., `gpt-4o-mini`, `gpt-4o`, `llama3`)

## Features

- **Real-time Streaming**: Text generation appears character by character
- **Tool Calling**: Uses calculator and echo tools
- **Session Management**: In-memory session storage (resets on server restart)
- **Error Handling**: Toast notifications for errors
- **AG-UI Protocol**: Full protocol compliance with lifecycle events

## Architecture

```
public/index.html     → Browser client (EventSource)
server.ts             → Bun HTTP server + SSE endpoint
src/agent.ts          → createAGUIAgent factory
src/tools.ts          → Calculator and echo tools
```

## Tool Reference

| Tool | Description | Example |
|------|-------------|---------|
| `calculator` | Basic arithmetic | `{"a": 5, "b": 3, "operation": "add"}` |
| `echo` | Returns input text | `{"text": "Hello"}` |

## Event Flow

1. Client sends POST `/chat` with config and messages
2. Server creates session and returns sessionId
3. Client connects EventSource to `/chat?sessionId=xxx`
4. Server runs agent and emits AG-UI events
5. Client displays events in real-time

## AG-UI Events Handled

- `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR`
- `TEXT_MESSAGE_START` / `CONTENT` / `END`
- `TOOL_CALL_START` / `ARGS` / `END` / `RESULT`
- `STATE_SNAPSHOT` (initial state)

## Local Development

```bash
# Watch mode (restarts on file changes)
bun run dev

# Production mode
bun run start
```

## Security Notes

⚠️ **For local development only** - API keys are sent to the server in memory and not persisted. Do not deploy this example to production without adding proper authentication and encryption.
