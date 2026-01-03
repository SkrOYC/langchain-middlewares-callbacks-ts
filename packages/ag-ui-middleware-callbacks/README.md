# ag-ui-middleware-callbacks

LangChain.js integration providing both middleware and callbacks for AG-UI protocol compatibility.

## Installation

To install dependencies:

```bash
bun install
```

## Usage

To run:

```bash
bun run index.ts
```

## Overview

This package provides a comprehensive solution for making LangChain.js agents fully compatible with any AG-UI protocol frontend. It offers:

- **Middleware**: Lifecycle and state management (beforeAgent, afterAgent, state snapshots)
- **Callbacks**: Streaming events (TEXT_MESSAGE_CONTENT, TOOL_CALL_ARGS, tool lifecycle)

For complete specifications and implementation details, see [SPEC.md](./SPEC.md).

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
