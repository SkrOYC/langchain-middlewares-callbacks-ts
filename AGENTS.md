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
*   **Core Dependencies:** `langchain`, `@langchain/langgraph`

## Directory Structure

*   **`packages/`**: Contains the standalone middleware libraries. Each package is intended to be published independently to npm.
*   **`examples/`**: Contains reference implementations and integration tests demonstrating how to use the middlewares in actual agents.

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
