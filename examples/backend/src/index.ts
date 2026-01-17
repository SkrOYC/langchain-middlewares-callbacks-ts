/**
 * Zed Backend Example - Main Entry Point
 *
 * This file sets up the ACP connection using stdio transport and initializes
 * the Zed agent with all required middleware and tools.
 */

import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "stream";
import { ACPAgent } from "./agent.js";
import { ModelConfig } from "./model.js";
import { createTools } from "./tools/index.js";

/**
 * Creates and configures the Zed agent backend
 */
async function createZedAgent(): Promise<ACPAgent> {
  // Create model configuration
  const modelConfig = new ModelConfig();

  // Create mock tools for the agent
  const tools = createTools();

  // Create and configure the agent
  const agent = new ACPAgent({
    modelConfig,
    tools,
  });

  return agent;
}

/**
 * Main entry point for the Zed backend example
 */
async function main(): Promise<void> {
  try {
    // Create the Zed agent
    const agent = await createZedAgent();

    // Set up stdio transport using ndJsonStream
    // For an agent: read from stdin (input), write to stdout (output)
    const stdinStream = process.stdin.isTTY ? null : Readable.toWeb(process.stdin);
    const stdoutStream = Writable.toWeb(process.stdout);

    if (!stdinStream) {
      // Don't start the connection until we have stdin
      return;
    }

    const stream = ndJsonStream(stdoutStream, stdinStream);

    // Create the AgentSideConnection that bridges our agent to the ACP protocol
    // The callback receives the SDK connection and returns our Agent implementation
    const connection = new AgentSideConnection(
      (sdkConnection) => {
        // Pass the SDK connection to our agent
        agent.connect(sdkConnection);

        return agent;
      },
      stream
    );

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      await agent.close();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await agent.close();
      process.exit(0);
    });

  } catch (error) {
    // Write error to stderr only
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`Error: ${errorMessage}\n`);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`Unhandled error: ${errorMessage}\n`);
  process.exit(1);
});