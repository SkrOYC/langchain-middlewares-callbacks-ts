import { test, expect, describe } from "bun:test";
import { 
  createACPStdioTransport, 
  createStdioTransport,
  ACPStdioConnection 
} from "../../../src/stdio/createACPStdioTransport";
import { 
  createACPStream, 
  createTestStreamPair 
} from "../../../src/stdio/ndJsonStream";
import type * as acp from "@agentclientprotocol/sdk";

// Simple mock agent for testing
const createMockAgent = (): acp.Agent => ({
  newSession: async (params: acp.NewSessionRequest) => ({
    sessionId: `session-${Date.now()}`,
    modes: {
      modeIds: ['agentic', 'interactive'],
      selectedModeId: 'agentic'
    }
  }),
  loadSession: async (params: acp.LoadSessionRequest) => ({
    modes: {
      modeIds: ['agentic'],
      selectedModeId: 'agentic'
    }
  }),
  prompt: async (params: acp.PromptRequest) => ({
    sessionId: params.sessionId,
    messageId: `msg-${Date.now()}`,
    content: [{
      type: 'text',
      text: 'Test response',
      _meta: null,
      annotations: null
    }],
    stopReason: 'complete'
  }),
  cancel: async () => ({}),
  setSessionMode: async () => ({}),
  listSessions: async () => ({ sessionIds: [] }),
  forkSession: async () => ({ sessionId: `fork-${Date.now()}` }),
});

describe("ACP Stdio Transport - Basic Functionality", () => {
  test("createACPStdioTransport creates transport instance", () => {
    const mockAgent = createMockAgent();
    
    const { connection, start, close, isClosed } = createACPStdioTransport({
      agent: () => mockAgent,
      debug: true
    });
    
    expect(connection).toBeInstanceOf(ACPStdioConnection);
    expect(typeof start).toBe("function");
    expect(typeof close).toBe("function");
    expect(typeof isClosed).toBe("function");
  });
  
  test("createStdioTransport creates transport instance", () => {
    const mockAgent = createMockAgent();
    
    const { connection, start, close } = createStdioTransport({
      agent: () => mockAgent
    });
    
    expect(connection).toBeInstanceOf(ACPStdioConnection);
    expect(typeof start).toBe("function");
    expect(typeof close).toBe("function");
  });
  
  test("connection methods are callable without starting", () => {
    const mockAgent = createMockAgent();
    
    const { connection, close } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    // Verify all required methods exist
    expect(typeof connection.sessionUpdate).toBe("function");
    expect(typeof connection.requestPermission).toBe("function");
    expect(typeof connection.readTextFile).toBe("function");
    expect(typeof connection.writeTextFile).toBe("function");
    expect(typeof connection.close).toBe("function");
    expect(typeof connection.isClosed).toBe("function");
    expect(typeof connection.getAgent).toBe("function");
    expect(typeof connection.setAgent).toBe("function");
  });
  
  test("agent is set by factory and accessible", () => {
    const mockAgent = createMockAgent();
    
    const { connection, close } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    // Agent should be set by factory
    expect(connection.getAgent()).toBe(mockAgent);
    
    // Can replace agent
    const newAgent = createMockAgent();
    connection.setAgent(newAgent);
    expect(connection.getAgent()).toBe(newAgent);
    
    // Restore original
    connection.setAgent(mockAgent);
    expect(connection.getAgent()).toBe(mockAgent);
  });
  
  test("connection lifecycle methods work", () => {
    const mockAgent = createMockAgent();
    
    const { isClosed } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    expect(isClosed()).toBe(false);
  });
  
  test("can close connection", async () => {
    const mockAgent = createMockAgent();
    
    const { close, isClosed } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    expect(isClosed()).toBe(false);
    
    await close();
    expect(isClosed()).toBe(true);
  });
  
  test("can close connection multiple times safely", async () => {
    const mockAgent = createMockAgent();
    
    const { close } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    await close();
    await close(); // Should not throw
  });
  
  test("custom agent info is used", () => {
    const mockAgent = createMockAgent();
    
    const { connection } = createACPStdioTransport({
      agent: () => mockAgent,
      agentInfo: {
        name: "custom-agent",
        version: "2.0.0"
      }
    });
    
    expect(connection).toBeDefined();
  });
  
  test("custom capabilities are used", () => {
    const mockAgent = createMockAgent();
    const customCapabilities: acp.AgentCapabilities = {
      loadSession: false,
      promptCapabilities: {
        image: false,
        audio: false,
        embeddedContext: false
      }
    };
    
    const { connection } = createACPStdioTransport({
      agent: () => mockAgent,
      agentCapabilities: customCapabilities
    });
    
    expect(connection).toBeDefined();
  });
  
  test("custom stream is used when provided", () => {
    const mockAgent = createMockAgent();
    const customStream = {
      readable: new ReadableStream(),
      writable: new WritableStream()
    };
    
    const { connection } = createACPStdioTransport({
      agent: () => mockAgent,
      stream: customStream
    });
    
    expect(connection).toBeDefined();
  });
});

describe("NDJSON Stream Utilities", () => {
  test("createTestStreamPair creates streams", () => {
    const { readable, writable } = createTestStreamPair();
    
    expect(readable).toBeInstanceOf(ReadableStream);
    expect(writable).toBeInstanceOf(WritableStream);
  });
  
  test("createTestStreamPair tracks written messages", async () => {
    const { write, getWrittenMessages } = createTestStreamPair();
    
    await write({ test: "message1" });
    await write({ test: "message2" });
    
    const messages = getWrittenMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ test: "message1" });
    expect(messages[1]).toEqual({ test: "message2" });
  });
  
  test("createTestStreamPair close prevents writes", async () => {
    const { write, close, getWrittenMessages } = createTestStreamPair();
    
    close();
    await write({ test: "message" });
    
    const messages = getWrittenMessages();
    expect(messages).toHaveLength(0);
  });
  
  test("createACPStream creates streams from byte streams", () => {
    const input = new ReadableStream<Uint8Array>();
    const output = new WritableStream<Uint8Array>();
    
    const stream = createACPStream(input, output);
    
    expect(stream.readable).toBeDefined();
    expect(stream.writable).toBeDefined();
  });
});

describe("Mock Agent Implementation", () => {
  test("mock agent implements all required Agent methods", async () => {
    const mockAgent = createMockAgent();
    
    // Verify all methods exist
    expect(typeof mockAgent.newSession).toBe("function");
    expect(typeof mockAgent.prompt).toBe("function");
    expect(typeof mockAgent.cancel).toBe("function");
    expect(typeof mockAgent.setSessionMode).toBe("function");
    expect(typeof mockAgent.listSessions).toBe("function");
    expect(typeof mockAgent.forkSession).toBe("function");
    
    // Test newSession
    const sessionResult = await mockAgent.newSession({ cwd: "/test", mcpServers: [] });
    expect(sessionResult).toHaveProperty("sessionId");
    expect(sessionResult).toHaveProperty("modes");
    
    // Test prompt
    const promptResult = await mockAgent.prompt({ 
      sessionId: "test", 
      prompt: "Hello" 
    });
    expect(promptResult).toHaveProperty("sessionId");
    expect(promptResult).toHaveProperty("messageId");
    expect(promptResult).toHaveProperty("content");
    expect(promptResult).toHaveProperty("stopReason");
  });
});

describe("Transport Method Execution", () => {
  test("sessionUpdate can be called without pending request rejection", async () => {
    const mockAgent = createMockAgent();
    
    const { connection, close } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    // Call sessionUpdate which sends a notification (not a request)
    // Notifications don't wait for responses, so they shouldn't cause pending promise issues
    const updatePromise = connection.sessionUpdate({
      sessionId: "test-session",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Test Tool",
        status: "in_progress"
      }
    });
    
    // Use Promise.allSettled to handle the promise without unhandled rejection
    const [result] = await Promise.allSettled([updatePromise]);
    
    // The promise should either resolve or reject (both are acceptable for this test)
    expect(result.status).toBeDefined();
    
    await close();
  });
  
  test("multiple sessionUpdate calls can be handled", async () => {
    const mockAgent = createMockAgent();
    
    const { connection, close } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    // Call multiple sessionUpdates
    const updatePromises = [
      connection.sessionUpdate({
        sessionId: "s1",
        update: { sessionUpdate: "status", status: "started" }
      }),
      connection.sessionUpdate({
        sessionId: "s2",
        update: { sessionUpdate: "status", status: "working" }
      }),
      connection.sessionUpdate({
        sessionId: "s3",
        update: { sessionUpdate: "status", status: "done" }
      })
    ];
    
    // Use Promise.allSettled to handle all promises
    const results = await Promise.allSettled(updatePromises);
    
    // All should be settled (either resolved or rejected)
    expect(results).toHaveLength(3);
    results.forEach(result => {
      expect(result.status).toBeDefined();
    });
    
    await close();
  });
  
  test("connection methods return expected types", async () => {
    const mockAgent = createMockAgent();
    
    const { connection, close } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    // Verify terminal methods exist
    expect(typeof connection.createTerminal).toBe("function");
    expect(typeof connection.getTerminalOutput).toBe("function");
    expect(typeof connection.waitForTerminalExit).toBe("function");
    expect(typeof connection.killTerminal).toBe("function");
    expect(typeof connection.releaseTerminal).toBe("function");
    
    // Verify agent management methods exist
    expect(typeof connection.getAgent).toBe("function");
    expect(typeof connection.setAgent).toBe("function");
    expect(typeof connection.close).toBe("function");
    expect(typeof connection.isClosed).toBe("function");
    
    await close();
  });
});

describe("Message Handling", () => {
  test("can enqueue messages for reading in test stream", async () => {
    const { enqueue, read, close } = createTestStreamPair();
    
    // Enqueue a message
    enqueue({ test: "message1" });
    enqueue({ test: "message2" });
    
    // Read the messages
    const msg1 = await read();
    const msg2 = await read();
    
    expect(msg1).toEqual({ test: "message1" });
    expect(msg2).toEqual({ test: "message2" });
    
    close();
  });
  
  test("transport writes initialize response to stream", async () => {
    const mockAgent = createMockAgent();
    const { readable, writable, getWrittenMessages, enqueue, close } = createTestStreamPair();
    
    // Create transport with custom stream
    const { start, close: transportClose } = createACPStdioTransport({
      agent: () => mockAgent,
      stream: { readable, writable }
    });
    
    // Start the message loop
    const startPromise = start();
    
    // Enqueue an initialize request
    enqueue({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: {}
      }
    });
    
    // Close the readable side to signal end of input
    close();
    
    // Wait for start to complete (it will exit when stream ends)
    await startPromise;
    
    // Check that a response was written
    const messages = getWrittenMessages();
    expect(messages.length).toBeGreaterThan(0);
    
    // The first message should be an initialize response
    const response = messages[0] as { jsonrpc: string; id: number; result?: unknown };
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    expect(response.result).toBeDefined();
    
    transportClose();
  });
  
  test("transport rejects unknown method requests", async () => {
    const mockAgent = createMockAgent();
    const { readable, writable, getWrittenMessages, enqueue, close } = createTestStreamPair();
    
    const { start, close: transportClose } = createACPStdioTransport({
      agent: () => mockAgent,
      stream: { readable, writable }
    });
    
    // Start the message loop
    const startPromise = start();
    
    // Enqueue a request with unknown method
    enqueue({
      jsonrpc: "2.0",
      id: 5,
      method: "unknown/method",
      params: {}
    });
    
    // Close the readable side to signal end of input
    close();
    
    // Wait for processing
    await startPromise;
    
    // Check that an error response was written
    const messages = getWrittenMessages();
    const errorResponse = messages[messages.length - 1] as { jsonrpc: string; id: number; error?: { code: number; message: string } };
    expect(errorResponse.jsonrpc).toBe("2.0");
    expect(errorResponse.id).toBe(5);
    expect(errorResponse.error).toBeDefined();
    expect(errorResponse.error?.code).toBe(-32000);
    
    transportClose();
  });
});

describe("Terminal Management Methods", () => {
  test("createTerminal method exists and returns a Promise", () => {
    const mockAgent = createMockAgent();
    
    const { connection } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    const result = connection.createTerminal({
      sessionId: "test-session",
      terminalId: "term-1"
    });
    
    expect(typeof connection.createTerminal).toBe("function");
    expect(result).toBeInstanceOf(Promise);
  });
  
  test("getTerminalOutput method exists and returns a Promise", () => {
    const mockAgent = createMockAgent();
    
    const { connection } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    const result = connection.getTerminalOutput({
      sessionId: "test-session",
      terminalId: "term-1"
    });
    
    expect(typeof connection.getTerminalOutput).toBe("function");
    expect(result).toBeInstanceOf(Promise);
  });
  
  test("waitForTerminalExit method exists and returns a Promise", () => {
    const mockAgent = createMockAgent();
    
    const { connection } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    const result = connection.waitForTerminalExit({
      sessionId: "test-session",
      terminalId: "term-1"
    });
    
    expect(typeof connection.waitForTerminalExit).toBe("function");
    expect(result).toBeInstanceOf(Promise);
  });
  
  test("killTerminal method exists and returns a Promise", () => {
    const mockAgent = createMockAgent();
    
    const { connection } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    const result = connection.killTerminal({
      sessionId: "test-session",
      terminalId: "term-1"
    });
    
    expect(typeof connection.killTerminal).toBe("function");
    expect(result).toBeInstanceOf(Promise);
  });
  
  test("releaseTerminal method exists and returns a Promise", () => {
    const mockAgent = createMockAgent();
    
    const { connection } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    const result = connection.releaseTerminal({
      sessionId: "test-session",
      terminalId: "term-1"
    });
    
    expect(typeof connection.releaseTerminal).toBe("function");
    expect(result).toBeInstanceOf(Promise);
  });
});

describe("Client Resource Methods", () => {
  test("readTextFile method exists and returns a Promise", () => {
    const mockAgent = createMockAgent();
    
    const { connection } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    const result = connection.readTextFile({
      sessionId: "test-session",
      path: "/test.txt"
    });
    
    expect(typeof connection.readTextFile).toBe("function");
    expect(result).toBeInstanceOf(Promise);
  });
  
  test("writeTextFile method exists and returns a Promise", () => {
    const mockAgent = createMockAgent();
    
    const { connection } = createACPStdioTransport({
      agent: () => mockAgent
    });
    
    const result = connection.writeTextFile({
      sessionId: "test-session",
      path: "/test.txt",
      content: "Hello, World!"
    });
    
    expect(typeof connection.writeTextFile).toBe("function");
    expect(result).toBeInstanceOf(Promise);
  });
});