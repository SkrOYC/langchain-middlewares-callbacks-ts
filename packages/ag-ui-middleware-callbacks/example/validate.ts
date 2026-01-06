#!/usr/bin/env bun

/**
 * AG-UI Middleware Validation CLI
 * 
 * Usage: bun run ./examples/validate.ts "Your prompt here"
 * 
 * Executes an agent with AG-UI middleware and streams raw events to stdout.
 * Similar to using curl against an HTTP endpoint - but direct execution.
 */

import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
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
// Main Execution
// ============================================================================

async function main() {
  const input = process.argv[2];

  if (!input || input === "--help") {
    console.log(`
AG-UI Middleware Validation CLI

Usage:
  bun run ./examples/validate.ts "Your prompt here"

Example:
  bun run ./examples/validate.ts "Calculate 2+2"
`);
    process.exit(input === "--help" ? 0 : 1);
  }

  // Create the model (same setup as demo.tsx)
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

    for await (const _ of eventStream) {
      // Stream consumed, events emitted via transport
    }
  } catch (error) {
    console.error("Error during execution:", error);
    process.exit(1);
  }
}

main();
