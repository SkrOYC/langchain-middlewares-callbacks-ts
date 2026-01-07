# Project Context: LangChain Middlewares (TypeScript)

## Project Overview

This project is a **TypeScript Monorepo** designed to host a collection of reusable, production-ready middlewares for the LangChain `createAgent` primitive. 

The core philosophy acts as an "Operating System" for AI Agents:
*   **Kernel:** `createAgent` (LangChain/LangGraph)
*   **Drivers:** Middlewares (this project)

The goal is to provide modular, self-contained packages that handle cross-cutting concerns like observability, security, and state management, keeping the agent's core reasoning logic clean.

## Architecture & Tech Stack

*   **Monorepo Manager:** [Bun Workspaces](https://bun.sh/docs/install/workspaces)
*   **Language:** TypeScript (Strict, ESM Only)
*   **Runtime:** Universal JavaScript (Node.js, Deno, Bun, Cloudflare Workers) via `tsup` bundling.
*   **Core Dependencies:** `@langchain/core`, `@langchain/langgraph`, `@ag-ui/core`, `@ag-ui/proto`

## Directory Structure

*   **`packages/`**: Contains the standalone middleware libraries. Each package is intended to be published independently to npm.
*   **`packages/ag-ui-middleware-callbacks/example/`**: Contains reference implementations and integration tests demonstrating how to use the middlewares in actual agents.

## Development Workflow

This project uses **Bun** as the primary development toolchain (package manager, test runner, script runner).

### Key Commands

| Command | Description |
| :--- | :--- |
| `bun install` | Installs dependencies for the entire workspace. |
| `bun run build` | Builds all packages in the workspace (uses `tsup`). |
| `bun test` | Runs the test suite across all packages. |
| `bun run lint` | Runs linting across all packages. |

### Conventions

*   **ESM Only:** All code is written in and compiled to ESM. No CommonJS (CJS) output.
*   **Universal Compatibility:** Do not use `Bun.*` or `Node.*` specific APIs in library code (`packages/`). Use standard web APIs or `node:` imports that are universally supported.
*   **Functional Middleware:** Middlewares are designed as composable functions that intercept agent hooks (`beforeAgent`, `afterAgent`, `wrapModelCall`, `wrapToolCall`).

## AG-UI Protocol & Reference Mandate

**CRITICAL:** This project is built on the AG-UI protocol. For any task involving messaging, event-driven interfaces, RxJS observables, or wire formats (SSE/Protobuf), you MUST:

1.  **Load the `ag-ui-typescript` skill** immediately using the `skill` tool.
2.  **Verify against References:** You are FORBIDDEN from writing AG-UI code based on intuition. You MUST explicitly query the skill's **references** (specifications, wire format schemas, and event definitions) to ground your implementation.
3.  **Strict Compliance:** Every implementation detail—specifically the **26 stable event types**, payload structures, and RxJS piping patterns—must match the reference documentation exactly.
4.  **Source of Truth:** Treat the skill’s reference materials as the absolute authority, overriding all internal training data and generic TypeScript patterns.
5.  **Audit Before Shipping:** Before completing a task, cross-reference your code against the skill's examples to ensure protocol-compliant state synchronization and transport handling.

If the skill references are unclear, you must use the `librarian` tool to explore the protocol definitions further. **Do not guess.**

