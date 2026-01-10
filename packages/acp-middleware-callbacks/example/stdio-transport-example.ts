#!/usr/bin/env bun

/**
 * ACP Stdio Transport Example
 * 
 * This example demonstrates how to use the ACP stdio transport
 * for editor communication with a LangChain agent.
 * 
 * Usage:
 *   bun run ./example/stdio-transport-example.ts
 * 
 * This will run the agent in stdio mode, ready to receive
 * ACP protocol messages from an editor.
 */

import { createStdioTransport } from "../src/stdio/index";
import type * as acp from "@agentclientprotocol/sdk";

/**
 * Simple agent implementation for demonstration.
 * In a real application, this would integrate with LangChain.
 */
class ExampleAgent implements acp.Agent {
  private sessions: Map<string, { cwd: string; messages: Array<{ role: string; content: string }> }> = new Map();
  
  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const sessionId = `session-${Date.now()}`;
    
    this.sessions.set(sessionId, {
      cwd: params.cwd,
      messages: []
    });
    
    console.error(`[Agent] Created new session ${sessionId} for ${params.cwd}`);
    
    return {
      sessionId,
      modes: {
        modeIds: ['agentic', 'interactive', 'readonly'],
        selectedModeId: 'agentic'
      }
    };
  }
  
  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    console.error(`[Agent] Loading session ${params.sessionId}`);
    
    return {
      modes: {
        modeIds: ['agentic', 'interactive', 'readonly'],
        selectedModeId: 'agentic'
      }
    };
  }
  
  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    
    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`);
    }
    
    // Add user message to history
    session.messages.push({ role: "user", content: params.prompt });
    
    console.error(`[Agent] Processing prompt for session ${params.sessionId}`);
    console.error(`[Agent] Message: ${params.prompt}`);
    
    // Simulate agent response
    const response = `I received your message: "${params.prompt}". This is a demonstration of the ACP stdio transport.`;
    
    // Add assistant message to history
    session.messages.push({ role: "assistant", content: response });
    
    return {
      sessionId: params.sessionId,
      messageId: `msg-${Date.now()}`,
      content: [{
        type: 'text' as const,
        text: response,
        _meta: null,
        annotations: null
      }],
      stopReason: 'complete' as const
    };
  }
  
  async cancel(params: acp.CancelRequest): Promise<acp.CancelResponse> {
    console.error(`[Agent] Canceling session ${params.sessionId}`);
    return {};
  }
  
  async setSessionMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
    console.error(`[Agent] Setting mode for session ${params.sessionId} to ${params.modeId}`);
    return {};
  }
  
  async listSessions(params: acp.ListSessionsRequest): Promise<acp.ListSessionsResponse> {
    return { sessionIds: Array.from(this.sessions.keys()) };
  }
  
  async forkSession(params: acp.ForkSessionRequest): Promise<acp.ForkSessionResponse> {
    const newSessionId = `fork-${Date.now()}`;
    const originalSession = this.sessions.get(params.sessionId);
    
    if (originalSession) {
      this.sessions.set(newSessionId, {
        ...originalSession,
        cwd: originalSession.cwd + '-fork'
      });
    }
    
    return { sessionId: newSessionId };
  }
}

/**
 * Main entry point for the example.
 */
async function main() {
  console.error("[Agent] Starting ACP Stdio Transport Example");
  console.error("[Agent] Waiting for initialize request from editor...");
  
  // Create the transport with our agent implementation
  const { connection, start, close } = createStdioTransport({
    agent: (conn) => {
      console.error("[Agent] Connection established, creating agent...");
      return new ExampleAgent();
    },
    agentInfo: {
      name: 'acp-stdio-example',
      title: 'ACP Stdio Transport Example',
      version: '0.1.0'
    },
    debug: true
  });
  
  // Handle graceful shutdown
  const shutdown = async () => {
    console.error("[Agent] Shutting down...");
    await close();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  try {
    // Start the transport - this will begin processing messages
    await start();
    console.error("[Agent] Transport started successfully");
  } catch (error) {
    console.error("[Agent] Error starting transport:", error);
    await close();
    process.exit(1);
  }
}

// Export for use as a module
export { ExampleAgent, main };

// Run if executed directly
if (import.meta.main) {
  main();
}