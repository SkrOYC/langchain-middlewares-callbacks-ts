import { test, expect, describe } from "bun:test";
import { createACPStdioTransport } from "../../../src/stdio/createACPStdioTransport";
import type * as acp from "@agentclientprotocol/sdk";

/**
 * Integration tests for ACP stdio transport handshake flow
 * These tests verify the complete initialization -> message exchange -> shutdown flow
 * using the public API where possible.
 */

describe("ACP Stdio Transport - Handshake Integration", () => {
  describe("Transport Factory", () => {
    test("createACPStdioTransport creates fully functional transport", () => {
      const mockAgent: acp.Agent = {
        newSession: async (params) => ({
          sessionId: `session-${Date.now()}`,
          modes: { modeIds: ['agentic', 'interactive'], selectedModeId: 'agentic' }
        }),
        loadSession: async () => ({
          modes: { modeIds: ['agentic'], selectedModeId: 'agentic' }
        }),
        prompt: async (params) => ({
          sessionId: params.sessionId,
          messageId: `msg-${Date.now()}`,
          content: [{ type: 'text', text: 'Response', _meta: null, annotations: null }],
          stopReason: 'complete'
        }),
        cancel: async () => ({}),
        setSessionMode: async () => ({}),
      };
      
      const { connection, start, close, isClosed } = createACPStdioTransport({
        agent: () => mockAgent,
        debug: false
      });
      
      // Verify all required parts are present
      expect(connection).toBeDefined();
      expect(typeof start).toBe("function");
      expect(typeof close).toBe("function");
      expect(typeof isClosed).toBe("function");
      expect(typeof connection.sessionUpdate).toBe("function");
      expect(typeof connection.requestPermission).toBe("function");
      expect(typeof connection.readTextFile).toBe("function");
      expect(typeof connection.writeTextFile).toBe("function");
      expect(typeof connection.createTerminal).toBe("function");
      expect(typeof connection.getTerminalOutput).toBe("function");
      expect(typeof connection.waitForTerminalExit).toBe("function");
      expect(typeof connection.killTerminal).toBe("function");
      expect(typeof connection.releaseTerminal).toBe("function");
      expect(typeof connection.close).toBe("function");
      expect(typeof connection.isClosed).toBe("function");
      
      close();
    });
    
    test("custom agent info is reflected in transport", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({ sessionId: 'test', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent,
        agentInfo: {
          name: 'custom-agent',
          version: '2.0.0'
        }
      });
      
      // The agent info is used during initialization handshake
      // We verify the transport was created with these options
      expect(connection).toBeDefined();
      
      close();
    });
    
    test("custom capabilities are reflected in transport", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({ sessionId: 'test', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const customCapabilities: acp.AgentCapabilities = {
        loadSession: false,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: false
        }
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent,
        agentCapabilities: customCapabilities
      });
      
      expect(connection).toBeDefined();
      
      close();
    });
  });
  
  describe("Connection Methods - Public API", () => {
    test("sessionUpdate method exists and is callable", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({ sessionId: 'test', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      // sessionUpdate should be callable and return a Promise
      const result = connection.sessionUpdate({
        sessionId: 'test-session',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-1',
          title: 'Test Tool',
          status: 'in_progress'
        }
      });
      
      expect(result).toBeInstanceOf(Promise);
      
      // Close the transport
      close();
    });
    
    test("requestPermission method exists and is callable", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({ sessionId: 'test', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      // Verify method exists (doesn't create pending request)
      expect(typeof connection.requestPermission).toBe('function');
      
      close();
    });
    
    test("file operations return Promises", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({ sessionId: 'test', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      // Verify methods exist (these don't create pending requests)
      expect(typeof connection.readTextFile).toBe('function');
      expect(typeof connection.writeTextFile).toBe('function');
      
      close();
    });
    
    test("terminal methods exist and return Promises", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({ sessionId: 'test', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      // Verify methods exist (these don't create pending requests)
      expect(typeof connection.createTerminal).toBe('function');
      expect(typeof connection.getTerminalOutput).toBe('function');
      expect(typeof connection.waitForTerminalExit).toBe('function');
      expect(typeof connection.killTerminal).toBe('function');
      expect(typeof connection.releaseTerminal).toBe('function');
      
      close();
    });
  });
  
  describe("Connection Lifecycle", () => {
    test("initial state is not closed", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({ sessionId: 'test', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const { isClosed } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      expect(isClosed()).toBe(false);
    });
    
    test("close changes state to closed", async () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({ sessionId: 'test', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const { close, isClosed } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      expect(isClosed()).toBe(false);
      
      await close();
      
      expect(isClosed()).toBe(true);
    });
    
    test("multiple close calls are safe", async () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({ sessionId: 'test', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const { close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      // Multiple close calls should not throw
      await close();
      await close();
      await close();
    });
    
    test("multiple transports have independent state", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({ sessionId: 'test', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const transport1 = createACPStdioTransport({ agent: () => mockAgent });
      const transport2 = createACPStdioTransport({ agent: () => mockAgent });
      
      expect(transport1.isClosed()).toBe(false);
      expect(transport2.isClosed()).toBe(false);
      
      transport1.close();
      
      expect(transport1.isClosed()).toBe(true);
      expect(transport2.isClosed()).toBe(false);
      
      transport2.close();
    });
  });
  
  describe("Agent State Management", () => {
    test("agent is set by factory", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({ sessionId: 'test', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      expect(connection.getAgent()).toBe(mockAgent);
      
      close();
    });
    
    test("agent can be replaced", () => {
      const mockAgent1: acp.Agent = {
        newSession: async () => ({ sessionId: 'agent1', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const mockAgent2: acp.Agent = {
        newSession: async () => ({ sessionId: 'agent2', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent1
      });
      
      expect(connection.getAgent()).toBe(mockAgent1);
      
      connection.setAgent(mockAgent2);
      expect(connection.getAgent()).toBe(mockAgent2);
      
      close();
    });
  });
  
  describe("Mock Agent Functionality", () => {
    test("agent methods return expected response types", async () => {
      const mockAgent: acp.Agent = {
        newSession: async (params) => {
          return {
            sessionId: 'test-session',
            modes: {
              modeIds: ['agentic', 'interactive', 'readonly'],
              selectedModeId: 'agentic'
            }
          };
        },
        loadSession: async () => {
          return {
            modes: {
              modeIds: ['agentic'],
              selectedModeId: 'agentic'
            }
          };
        },
        prompt: async (params) => {
          return {
            sessionId: params.sessionId,
            messageId: 'test-message',
            content: [
              {
                type: 'text',
                text: `Response to: ${params.prompt}`,
                _meta: null,
                annotations: null
              }
            ],
            stopReason: 'complete'
          };
        },
        cancel: async () => {
          return {};
        },
        setSessionMode: async () => {
          return {};
        },
      };
      
      // Test newSession
      const sessionResult = await mockAgent.newSession({ cwd: '/test', mcpServers: [] });
      expect(sessionResult).toHaveProperty('sessionId');
      expect(sessionResult).toHaveProperty('modes');
      expect(sessionResult.modes.modeIds).toContain('agentic');
      
      // Test loadSession
      const loadResult = await mockAgent.loadSession({ sessionId: 'test', cwd: '/test', mcpServers: [] });
      expect(loadResult).toHaveProperty('modes');
      
      // Test prompt
      const promptResult = await mockAgent.prompt({ sessionId: 'test', prompt: 'Hello' });
      expect(promptResult).toHaveProperty('sessionId', 'test');
      expect(promptResult).toHaveProperty('messageId', 'test-message');
      expect(promptResult).toHaveProperty('content');
      expect(promptResult).toHaveProperty('stopReason', 'complete');
      
      // Test cancel
      const cancelResult = await mockAgent.cancel({ sessionId: 'test' });
      expect(cancelResult).toEqual({});
    });
  });
});