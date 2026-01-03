# LangChain Middlewares & Callbacks (TypeScript)

> **The "Operating System" for your AI Agents.**

This monorepo hosts a collection of reusable, production-ready middlewares and callbacks designed for the LangChain `createAgent` primitive.

## 🎯 Purpose

Moving beyond simple "scripts", modern AI Agents require robust infrastructure for **observability**, **security**, and **state management**.

Instead of cluttering your agent's reasoning loop with this logic, we treat:
*   **`createAgent`** as the **Kernel**.
*   **Middlewares** and **Callbacks** as the **Drivers**.

This project provides those drivers as modular, self-contained packages.

## 📦 Architecture

*   **Monorepo:** Managed with **Bun Workspaces**.
*   **Runtime:** **ESM Only** (modern JavaScript).
*   **Design Pattern:** Composable middlewares and callbacks that intercept `beforeAgent`, `afterAgent`, streaming events, and tool lifecycle.

## 🛠️ Tech Stack

*   **Development:** [Bun](https://bun.sh) (Test runner, package manager).
*   **Build:** `tsup` (TypeScript -> ESM).
*   **Core:** `langchain` & `langgraph`.

## 🚀 Usage Concept

```typescript
import { createAgent } from "@langchain/langgraph";
import { LoggerMiddleware } from "@my-org/middleware-logger";
import { RateLimitMiddleware } from "@my-org/middleware-rate-limit";

const agent = createAgent({
  llm: model,
  tools: [searchTool],
  middleware: [
    LoggerMiddleware({ level: "verbose" }),
    RateLimitMiddleware({ requestsPerMinute: 10 })
  ]
});
```

## 📂 Structure

*   `packages/` - Standalone middleware and callback libraries (published to npm).
*   `examples/` - Reference implementations and integration tests.
