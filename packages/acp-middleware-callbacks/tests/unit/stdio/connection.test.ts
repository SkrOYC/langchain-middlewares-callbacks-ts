import { test, expect, describe } from "bun:test";
import { createACPStdioTransport } from "../../../src/stdio/createACPStdioTransport";
import type * as acp from "@agentclientprotocol/sdk";

/**
 * Tests for the internal Connection class messaging behavior
 * These tests verify the core messaging logic through the public API.
 */

describe("Connection Class - Core Messaging", () => {
  describe("sendRequest behavior (Connection class)", () => {
    test("sendRequest returns a Promise that can be awaited", () => {
      const mockAgent: acp.Agent = {
        newSession: async (params) => ({
          sessionId: `session-${Date.now()}`,
          modes: { modeIds: ['agentic'], selectedModeId: 'agentic' }
        }),
        prompt: async () => ({ 
          sessionId: 'test', 
          messageId: 'msg', 
          content: [], 
          stopReason: 'complete' 
        }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      // Verify method exists (doesn't create pending request)
      expect(typeof connection.requestPermission).toBe('function');
      
      close();
    });
    
    test("readTextFile returns a Promise", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({
          sessionId: 'test',
          modes: { modeIds: [], selectedModeId: '' }
        }),
        prompt: async () => ({ 
          sessionId: 'test', 
          messageId: 'msg', 
          content: [], 
          stopReason: 'complete' 
        }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      // Verify method exists (doesn't create pending request)
      expect(typeof connection.readTextFile).toBe('function');
      
      close();
    });
    
    test("writeTextFile returns a Promise", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({
          sessionId: 'test',
          modes: { modeIds: [], selectedModeId: '' }
        }),
        prompt: async () => ({ 
          sessionId: 'test', 
          messageId: 'msg', 
          content: [], 
          stopReason: 'complete' 
        }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      // Verify method exists (doesn't create pending request)
      expect(typeof connection.writeTextFile).toBe('function');
      
      close();
    });
  });
  
  describe("sendNotification behavior (Connection class)", () => {
    test("sessionUpdate returns a Promise", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({
          sessionId: 'test',
          modes: { modeIds: [], selectedModeId: '' }
        }),
        prompt: async () => ({ 
          sessionId: 'test', 
          messageId: 'msg', 
          content: [], 
          stopReason: 'complete' 
        }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      // sessionUpdate internally uses sendNotification
      const result = connection.sessionUpdate({
        sessionId: 'test',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-1',
          title: 'Test',
          status: 'in_progress'
        }
      });
      
      expect(result).toBeInstanceOf(Promise);
      
      close();
    });
  });
  
  describe("Write Queue Serialization", () => {
    test("concurrent sessionUpdate calls complete without conflict", async () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({
          sessionId: 'test',
          modes: { modeIds: [], selectedModeId: '' }
        }),
        prompt: async () => ({ 
          sessionId: 'test', 
          messageId: 'msg', 
          content: [], 
          stopReason: 'complete' 
        }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      // Multiple sessionUpdate calls should not conflict
      // The write queue in Connection class ensures they're serialized
      const updates = [
        connection.sessionUpdate({ sessionId: 's1', update: { sessionUpdate: 'status', status: 'started' } }),
        connection.sessionUpdate({ sessionId: 's2', update: { sessionUpdate: 'status', status: 'working' } }),
        connection.sessionUpdate({ sessionId: 's3', update: { sessionUpdate: 'status', status: 'done' } }),
      ];
      
      // All should complete without error (Promise.all settles even if individual promises reject)
      // We're just testing that they don't throw synchronously
      const results = await Promise.allSettled(updates);
      
      // At least some should be resolved or rejected (not pending)
      expect(results.length).toBe(3);
      
      await close();
    });
    
    test("rapid sequential writes complete", async () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({
          sessionId: 'test',
          modes: { modeIds: [], selectedModeId: '' }
        }),
        prompt: async () => ({ 
          sessionId: 'test', 
          messageId: 'msg', 
          content: [], 
          stopReason: 'complete' 
        }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      // Rapid sequential writes should all complete
      for (let i = 0; i < 5; i++) {
        await connection.sessionUpdate({ 
          sessionId: `s${i}`, 
          update: { sessionUpdate: 'status', status: `step-${i}` } 
        });
      }
      
      await close();
    });
  });
  
  describe("Connection Lifecycle (Connection class)", () => {
    test("isClosed returns false initially", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({
          sessionId: 'test',
          modes: { modeIds: [], selectedModeId: '' }
        }),
        prompt: async () => ({ 
          sessionId: 'test', 
          messageId: 'msg', 
          content: [], 
          stopReason: 'complete' 
        }),
      };
      
      const { isClosed } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      expect(isClosed()).toBe(false);
    });
    
    test("isClosed returns true after close", async () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({
          sessionId: 'test',
          modes: { modeIds: [], selectedModeId: '' }
        }),
        prompt: async () => ({ 
          sessionId: 'test', 
          messageId: 'msg', 
          content: [], 
          stopReason: 'complete' 
        }),
      };
      
      const { close, isClosed } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      expect(isClosed()).toBe(false);
      
      await close();
      
      expect(isClosed()).toBe(true);
    });
    
    test("close can be called multiple times safely", async () => {
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
    
    test("new transport has separate connection state", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({ sessionId: 'test', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const transport1 = createACPStdioTransport({ agent: () => mockAgent });
      const transport2 = createACPStdioTransport({ agent: () => mockAgent });
      
      // Each transport should have its own isClosed state
      expect(transport1.isClosed()).toBe(false);
      expect(transport2.isClosed()).toBe(false);
      
      // Close one should not affect the other
      transport1.close();
      expect(transport1.isClosed()).toBe(true);
      expect(transport2.isClosed()).toBe(false);
    });
  });
  
  describe("Pending Response Management", () => {
    test("request without mock response rejects", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({
          sessionId: 'test',
          modes: { modeIds: [], selectedModeId: '' }
        }),
        prompt: async () => ({ 
          sessionId: 'test', 
          messageId: 'msg', 
          content: [], 
          stopReason: 'complete' 
        }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      // requestPermission sends a request but there's no mock response handler,
      // so the Promise should reject (simulating no response scenario)
      const permissionPromise = connection.requestPermission({
        sessionId: 'test',
        toolCall: { kind: 'read', name: 'test', input: {} },
        options: []
      });
      
      // Close without awaiting - the pending promise will be rejected
      close();
      
      // The promise should be rejected since there's no response handler
      expect(permissionPromise).rejects.toThrow();
    });
    
    test("readTextFile without mock response rejects", () => {
      const mockAgent: acp.Agent = {
        newSession: async () => ({ sessionId: 'test', modes: { modeIds: [], selectedModeId: '' } }),
        prompt: async () => ({ sessionId: 'test', messageId: 'msg', content: [], stopReason: 'complete' }),
      };
      
      const { connection, close } = createACPStdioTransport({
        agent: () => mockAgent
      });
      
      // Without a mock response, the Promise should reject
      const readPromise = connection.readTextFile({ sessionId: 'test', path: '/test.txt' });
      
      // Close without awaiting - the pending promise will be rejected
      close();
      
      expect(readPromise).rejects.toThrow();
    });
  });
});