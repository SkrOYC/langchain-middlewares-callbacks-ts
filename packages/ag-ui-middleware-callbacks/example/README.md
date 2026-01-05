# AG-UI Middleware Callbacks Example

A minimal working example demonstrating the `ag-ui-middleware-callbacks` package with AG-UI protocol compliance. This example uses a single-file architecture powered by Bun's native support for JSX/TSX and server-side rendering.

## Prerequisites

- **Bun** (latest version) - Install from [bun.sh](https://bun.sh)
- **OpenAI API Key** (or compatible endpoint like Ollama, LM Studio, etc.)

## Quick Start

```bash
# Navigate to the example directory
cd packages/ag-ui-middleware-callbacks/example

# Install dependencies
bun install

# Start the demo (Single-file server + client)
bun run start
```

Then open http://localhost:3000 in your browser.

## Architecture

This demo uses `demo.tsx` as a universal entry point:
- **Server**: Uses `Bun.serve` to handle HTTP requests and SSE streams.
- **Client**: React application defined in the same file, bundled on-the-fly via `Bun.build`.
- **SSR**: Initial page load is server-side rendered using `react-dom/server`.

## Features

- **Real-time Streaming**: Text generation appears character by character.
- **Tool Calling**: Integrated calculator tool demonstrating protocol events.
- **Deterministic IDs**: Demonstrates synchronization between middleware and callbacks.
- **Zero Configuration**: Client settings are persisted in `localStorage`.

## AG-UI Events Handled

- `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR`
- `TEXT_MESSAGE_START` / `CONTENT` / `END`
- `TOOL_CALL_START` / `ARGS` / `END` / `RESULT`
- `MESSAGES_SNAPSHOT` (for session resume)

## Local Development

```bash
# Watch mode (restarts on file changes)
bun run dev
```

## Security Notes

⚠️ **For local development only** - API keys are provided in the UI and used by the server in memory. Do not deploy this example to production without adding proper authentication.
