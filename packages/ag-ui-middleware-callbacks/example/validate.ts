#!/usr/bin/env bun

/**
 * AG-UI Middleware Validation CLI
 * 
 * Compares raw createAgent() vs AG-UI middleware implementation
 * 
 * Usage:
 *   bun run ./validate.ts middleware "Your prompt here"    # Use AG-UI middleware
 *   bun run ./validate.ts raw "Your prompt here"           # Use raw createAgent
 *   bun run ./validate.ts compare "Your prompt here"       # Compare both (middleware first, then raw)
 *   bun run ./validate.ts --help                           # Show help
 * 
 * Purpose: Study LangChain/LangGraph event handling and ID alignment
 */

import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { createAGUIAgent, AGUICallbackHandler, type AGUITransport } from "../src/index";

// ============================================================================
// Calculator Tool (from demo.tsx)
// ============================================================================

const calculatorTool = tool(
  async ({ a, b, operation }: { a: number; b: number; operation: string }) => {
    let result: number;
    switch (operation) {
      case "add":
        result = a + b;
        break;
      case "subtract":
        result = a - b;
        break;
      case "multiply":
        result = a * b;
        break;
      case "divide":
        result = a / b;
        break;
      default:
        return `Unknown operation: ${operation}`;
    }
    return `Result: ${result}`;
  },
  {
    name: "calculator",
    description: "Perform arithmetic",
    schema: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
        operation: {
          type: "string",
          enum: ["add", "subtract", "multiply", "divide"],
        },
      },
      required: ["a", "b", "operation"],
    },
  }
);

// ============================================================================
// Transport: Write events to stdout (SSE-like format)
// ============================================================================

const transport: AGUITransport = {
  emit: async (event) => {
    // Write in SSE format: "data: {JSON}\n\n"
    process.stdout.write(`data: ${JSON.stringify(event)}\n\n`);
  },
};

// ============================================================================
// Raw createAgent() - for comparison
// ============================================================================

async function runRawAgent(input: string) {
  console.error("=== RUNNING RAW createAgent() ===");
  console.error("=== No AG-UI middleware, just native callbacks ===\n");

  const model = new ChatOpenAI({
    model: "grok-code",
    streaming: true,
    configuration: {
      baseURL: "https://opencode.ai/zen/v1",
      apiKey: "",
    },
  });

  // Create raw agent without middleware
  const agent = createAgent({
    model,
    tools: [calculatorTool],
  });

  // Use built-in streaming with event capture
  try {
    const eventStream = await (agent as any).streamEvents(
      { messages: [{ role: "user", content: input }] },
      { version: "v2" }
    );

    let eventCount = 0;
    for await (const event of eventStream) {
      eventCount++;
      // Output native LangChain/LangGraph events
      process.stdout.write(`data: ${JSON.stringify({
        _source: "native",
        _event: event.event,
        ...event.data
      })}\n\n`);
    }
    console.error(`\n=== RAW AGENT: ${eventCount} events captured ===\n`);
  } catch (error) {
    console.error("Error during raw execution:", error);
    process.exit(1);
  }
}

// ============================================================================
// AG-UI Middleware Agent
// ============================================================================

async function runMiddlewareAgent(input: string) {
  console.error("=== RUNNING AG-UI MIDDLEWARE AGENT ===\n");

  const model = new ChatOpenAI({
    model: "grok-code",
    streaming: true,
    configuration: {
      baseURL: "https://opencode.ai/zen/v1",
      apiKey: "",
    },
  });

  // Create agent with middleware
  const agent = createAGUIAgent({
    model,
    tools: [calculatorTool],
    transport,
  });

  // Create callback handler for streaming events
  const callbacks = new AGUICallbackHandler(transport);

  try {
    const eventStream = await (agent as any).streamEvents(
      { messages: [{ role: "user", content: input }] },
      { version: "v2", callbacks: [callbacks] }
    );

    let eventCount = 0;
    for await (const _ of eventStream) {
      eventCount++;
      // Events emitted via transport
    }
    console.error(`\n=== MIDDLEWARE AGENT: ${eventCount} stream iterations ===\n`);
  } catch (error) {
    console.error("Error during middleware execution:", error);
    process.exit(1);
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  const mode = process.argv[2];
  const input = process.argv[3];

  if (!input || mode === "--help" || mode === "-h") {
    console.log(`
AG-UI Middleware Validation CLI

Usage:
  bun run ./validate.ts middleware "Your prompt here"    # Use AG-UI middleware
  bun run ./validate.ts raw "Your prompt here"           # Use raw createAgent
  bun run ./validate.ts compare "Your prompt here"       # Compare both approaches

Examples:
  bun run ./validate.ts middleware "Calculate 2+2"
  bun run ./validate.ts raw "Calculate 2+2"
  bun run ./validate.ts compare "What is 5 * 3 and divide 10 by 2"

Purpose:
  Compare raw LangChain/LangGraph events vs AG-UI middleware output
  to study ID alignment and event handling patterns.

Comparison Notes:
  - Raw mode shows native LangChain callback events
  - Middleware mode shows AG-UI protocol events
  - Compare event structures, IDs, and timing
`);
    process.exit(mode === "--help" || mode === "-h" ? 0 : 1);
  }

  switch (mode) {
    case "middleware":
      await runMiddlewareAgent(input);
      break;
    case "raw":
      await runRawAgent(input);
      break;
    case "compare":
      console.error("\n" + "=".repeat(60));
      console.error("COMPARISON MODE: Running middleware first, then raw");
      console.error("=".repeat(60) + "\n");
      
      await runMiddlewareAgent(input);
      
      console.error("\n" + "=".repeat(60));
      console.error("SWITCHING TO RAW AGENT");
      console.error("=".repeat(60) + "\n");
      
      await runRawAgent(input);
      break;
    default:
      console.error(`Unknown mode: ${mode}`);
      console.error("Use --help for usage information");
      process.exit(1);
  }
}

main();
