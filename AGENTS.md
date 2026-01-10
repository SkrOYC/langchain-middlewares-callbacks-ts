AGENTS.md

This file provides guidance to AI Agents when working with code in this repository.
These instructions guide you to focus on project-specific architecture and commands rather than generic development advice, and to base the content on actual analysis of the codebase rather than assumptions.

# Project Context: LangChain Middlewares & Callbacks (TypeScript)

## Project Overview

This project is a **TypeScript Monorepo** hosting reusable middlewares and callbacks for LangChain `createAgent`. Two main packages:

- **`@skroyc/ag-ui-middleware-callbacks`** - AG-UI protocol integration for real-time agent-to-UI communication
- **`@skroyc/acp-middleware-callbacks`** - ACP (Agent Client Protocol) integration for code editors

The architecture treats `createAgent` as the **Kernel** and middlewares as **Drivers**, handling observability, security, and state management.

## Directory Structure

- **`packages/`** - Standalone middleware libraries (published independently to npm)
- **`packages/*/src/`** - Source with `callbacks/`, `middleware/`, `transports/`, `utils/` subdirectories
- **`packages/*/tests/`** - Test structure mirrors src: `unit/`, `integration/`, `fixtures/`, `helpers/`, `setup/`

## Key Commands

### Workspace-level
```bash
bun install              # Install all dependencies
bun run build            # Build all packages
bun test                 # Run all tests
bun run lint             # Lint all packages
```

### Individual package operations
```bash
# Build a specific package
bun run build --filter @skroyc/ag-ui-middleware-callbacks
bun run build --filter @skroyc/acp-middleware-callbacks

# Test a specific package
bun test packages/ag-ui-middleware-callbacks
bun test packages/acp-middleware-callbacks

# Run a single test file
bun test packages/ag-ui-middleware-callbacks/tests/unit/events.test.ts

# Run tests matching a pattern
bun test --test-name-pattern "SSE" packages/ag-ui-middleware-callbacks
```

## Conventions

- **ESM Only:** All code is ESM. No CommonJS output.
- **Universal Compatibility:** Library code (`packages/`) uses standard web APIs, not Bun/Node-specific APIs
- **Functional Middleware:** Composable functions intercepting `beforeAgent`, `afterAgent`, `wrapModelCall`, `wrapToolCall`
- **Build:** Uses `tsup` with externals for peer dependencies (`langchain`, `@ag-ui/core`, `@ag-ui/proto`, etc.)

## AG-UI Protocol Mandate

**CRITICAL:** This project uses the AG-UI protocol. For tasks involving messaging, events, RxJS observables, or wire formats (SSE/Protobuf):

1. **Load the `ag-ui-typescript` skill** immediately using the `skill` tool
2. **Verify against References:** Do NOT write AG-UI code from intuition—query the skill's references
3. **Strict Compliance:** Match the 26 stable event types, payload structures, and RxJS patterns exactly
4. **Audit Before Shipping:** Cross-reference against the skill's examples for protocol compliance
