/**
 * ACP Stdio Transport Factory
 * 
 * Implements the Agent Client Protocol (ACP) stdio transport for editor communication.
 * This transport enables protocol initialization handshake and bidirectional messaging
 * between the agent and ACP-compliant editors via stdin/stdout.
 * 
 * @packageDocumentation
 */

import type * as acp from "@agentclientprotocol/sdk";
import { 
  type ACPStream, 
  createACPStream, 
  createNodeStream 
} from "./ndJsonStream.js";

/**
 * Simple debug logging function.
 */
function debugLog(enabled: boolean, ...args: unknown[]): void {
  if (enabled && typeof console !== 'undefined') {
    console.error('[ACP]', ...args);
  }
}

/**
 * Protocol version constant.
 */
const PROTOCOL_VERSION = 1;

/**
 * Pending response interface for request-response correlation.
 */
interface PendingResponse {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/**
 * Agent implementation callback type.
 */
export type AgentImplementation = (connection: ACPStdioConnection) => acp.Agent;

/**
 * Configuration options for the stdio transport.
 */
export interface ACPStdioTransportConfig {
  /**
   * The agent implementation callback.
   * Receives the connection and returns an agent instance.
   */
  agent: AgentImplementation;
  
  /**
   * Optional stream to use instead of process streams.
   * If not provided, uses process.stdin/stdout.
   */
  stream?: ACPStream;
  
  /**
   * Agent implementation info returned during initialization.
   * @default { name: 'acp-middleware-callbacks-agent', version: '0.1.0' }
   */
  agentInfo?: {
    name?: string;
    version?: string;
  };
  
  /**
   * Agent capabilities returned during initialization.
   * @default { loadSession: true, promptCapabilities: { image: true, audio: true, embeddedContext: true } }
   */
  agentCapabilities?: acp.AgentCapabilities;
  
  /**
   * Whether to enable debug logging.
   * @default false
   */
  debug?: boolean;
}

/**
 * Internal Connection class that handles low-level protocol concerns.
 * This class is not exported but used internally by ACPStdioConnection.
 */
class Connection {
  #pendingResponses: Map<number, PendingResponse> = new Map();
  #nextRequestId: number = 0;
  #writeQueue: Promise<void> = Promise.resolve();
  #abortController: AbortController;
  #stream: ACPStream;
  #debug: boolean;
  #closed: boolean = false;
  
  constructor(stream: ACPStream, debug: boolean = false) {
    this.#stream = stream;
    this.#debug = debug;
    this.#abortController = new AbortController();
  }
  
  /**
   * Sends a message through the write queue.
   * Uses Promise chaining to serialize writes.
   */
  async #sendMessage(message: unknown): Promise<void> {
    if (this.#closed) {
      return;
    }
    
    this.#writeQueue = this.#writeQueue
      .then(async () => {
        if (this.#closed) {
          return;
        }
        
        const writer = this.#stream.writable.getWriter();
        try {
          await writer.write(message);
          debugLog(this.#debug, 'Sent:', JSON.stringify(message));
        } finally {
          writer.releaseLock();
        }
      })
      .catch((error) => {
        debugLog(this.#debug, 'Write error:', error);
        this.close();
        throw error;
      });
    
    return this.#writeQueue;
  }
  
  /**
   * Sends a JSON-RPC request and waits for the response.
   */
  async sendRequest<Req, Resp>(
    method: string, 
    params?: Req
  ): Promise<Resp> {
    const id = this.#nextRequestId++;
    const responsePromise = new Promise<Resp>((resolve, reject) => {
      this.#pendingResponses.set(id, { resolve, reject } as PendingResponse);
    });
    
    await this.#sendMessage({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });
    
    return responsePromise;
  }
  
  /**
   * Sends a notification (fire-and-forget).
   */
  async sendNotification(method: string, params?: unknown): Promise<void> {
    await this.#sendMessage({
      jsonrpc: '2.0',
      method,
      params,
    });
  }
  
  /**
   * Handles an incoming response message.
   */
  #handleResponse(response: { id: number; result?: unknown; error?: unknown }): void {
    const pendingResponse = this.#pendingResponses.get(response.id);
    
    if (pendingResponse) {
      if ('result' in response) {
        pendingResponse.resolve(response.result);
      } else if ('error' in response) {
        pendingResponse.reject(response.error);
      }
      this.#pendingResponses.delete(response.id);
    } else {
      debugLog(this.#debug, 'Got response to unknown request:', response.id);
    }
  }
  
  /**
   * Handles an incoming request message.
   */
  async #handleRequest(
    request: { id: number; method: string; params?: unknown },
    handler: (method: string, params?: unknown) => Promise<unknown>
  ): Promise<void> {
    try {
      const result = await handler(request.method, request.params);
      await this.#sendMessage({
        jsonrpc: '2.0',
        id: request.id,
        result,
      });
    } catch (error) {
      await this.#sendMessage({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  
  /**
   * Starts the receive loop to process incoming messages.
   */
  async start(
    requestHandler: (method: string, params?: unknown) => Promise<unknown>
  ): Promise<void> {
    const reader = this.#stream.readable.getReader();
    
    try {
      while (!this.#abortController.signal.aborted) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }
        
        debugLog(this.#debug, 'Received:', JSON.stringify(value));
        
        const message = value as { id?: number; method?: string; params?: unknown };
        
        // Handle response (has id, no method)
        if (message.id !== undefined && message.method === undefined) {
          this.#handleResponse(message as { id: number; result?: unknown; error?: unknown });
        }
        // Handle request (has method, may have id)
        else if (message.method !== undefined) {
          if (message.id !== undefined) {
            await this.#handleRequest(
              message as { id: number; method: string; params?: unknown },
              requestHandler
            );
          } else {
            // Notification (no id)
            await requestHandler(message.method, message.params);
          }
        }
      }
    } catch (error) {
      debugLog(this.#debug, 'Receive error:', error);
    } finally {
      reader.releaseLock();
    }
  }
  
  /**
   * Closes the connection gracefully.
   */
  async close(): Promise<void> {
    this.#closed = true;
    this.#abortController.abort();
    
    // Reject pending responses
    for (const [id, response] of this.#pendingResponses) {
      response.reject(new Error('Connection closed'));
      this.#pendingResponses.delete(id);
    }
    
    // Wait for any pending writes
    await this.#writeQueue;
  }
  
  /**
   * Gets whether the connection is closed.
   */
  isClosed(): boolean {
    return this.#closed;
  }
}

/**
 * ACP Stdio Connection
 * 
 * Implements the connection interface for ACP stdio communication.
 * This class manages the initialization handshake, message routing,
 * and provides methods for sending requests and notifications.
 */
export class ACPStdioConnection {
  #connection: Connection;
  #agent: acp.Agent | null = null;
  #agentInfo: acp.Implementation;
  #agentCapabilities: acp.AgentCapabilities;
  #debug: boolean;
  
  constructor(
    connection: Connection,
    agentInfo: acp.Implementation,
    agentCapabilities: acp.AgentCapabilities,
    debug: boolean = false
  ) {
    this.#connection = connection;
    this.#agentInfo = agentInfo;
    this.#agentCapabilities = agentCapabilities;
    this.#debug = debug;
  }
  
  /**
   * Gets the agent implementation.
   */
  getAgent(): acp.Agent | null {
    return this.#agent;
  }
  
  /**
   * Sets the agent implementation.
   */
  setAgent(agent: acp.Agent): void {
    this.#agent = agent;
  }
  
  /**
   * Handles an incoming initialize request.
   */
  async #handleInitialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    if (this.#debug) {
      console.error('[ACP] Initialize request:', JSON.stringify(params));
    }
    
    // Validate protocol version
    if (params.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`Unsupported protocol version: ${params.protocolVersion}. Expected ${PROTOCOL_VERSION}`);
    }
    
    // Log client capabilities for debugging
    if (params.clientCapabilities) {
      debugLog(this.#debug, 'Client capabilities:', JSON.stringify(params.clientCapabilities));
    }
    
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: this.#agentInfo,
      agentCapabilities: this.#agentCapabilities,
      authMethods: [], // No authentication required by default
    };
  }
  
  /**
   * Handles incoming requests.
   */
  async #handleRequest(method: string, params?: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.#handleInitialize(params as acp.InitializeRequest);
        
      case 'authenticate':
        return {}; // No-op for now, authentication not implemented
      
      case 'session/new':
        if (!this.#agent) {
          throw new Error('Agent not initialized');
        }
        return this.#agent.newSession(params as acp.NewSessionRequest);
      
      case 'session/load':
        if (!this.#agent) {
          throw new Error('Agent not initialized');
        }
        if (!this.#agent.loadSession) {
          throw new Error('Agent does not support loadSession');
        }
        return this.#agent.loadSession(params as acp.LoadSessionRequest);
      
      case 'session/prompt':
        if (!this.#agent) {
          throw new Error('Agent not initialized');
        }
        return this.#agent.prompt(params as acp.PromptRequest);
      
      case 'session/cancel':
        if (!this.#agent) {
          throw new Error('Agent not initialized');
        }
        return this.#agent.cancel?.(params as acp.CancelNotification) ?? {};
      
      case 'session/set_mode':
        if (!this.#agent) {
          throw new Error('Agent not initialized');
        }
        return this.#agent.setSessionMode?.(params as acp.SetSessionModeRequest) ?? {};
      
      case 'session/list':
        if (!this.#agent) {
          throw new Error('Agent not initialized');
        }
        // listSessions might not exist on all agents
        return 'listSessions' in this.#agent && typeof this.#agent.listSessions === 'function'
          ? this.#agent.listSessions(params as acp.ListSessionsRequest)
          : { sessionIds: [] };
      
      case 'session/fork':
        if (!this.#agent) {
          throw new Error('Agent not initialized');
        }
        // forkSession might not exist on all agents
        return 'forkSession' in this.#agent && typeof this.#agent.forkSession === 'function'
          ? this.#agent.forkSession(params as acp.ForkSessionRequest)
          : { sessionId: '' };
      
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
  
  /**
   * Sends a session update notification.
   */
  async sessionUpdate(params: { sessionId: string; update: acp.SessionUpdate }): Promise<void> {
    await this.#connection.sendNotification('session/update', params);
  }
  
  /**
   * Requests permission from the client.
   */
  async requestPermission(
    params: acp.RequestPermissionRequest
  ): Promise<acp.RequestPermissionResponse> {
    return this.#connection.sendRequest('session/request_permission', params);
  }
  
  /**
   * Reads a text file from the client.
   */
  async readTextFile(
    params: acp.ReadTextFileRequest
  ): Promise<acp.ReadTextFileResponse> {
    return this.#connection.sendRequest('fs/read_text_file', params);
  }
  
  /**
   * Writes a text file to the client.
   */
  async writeTextFile(
    params: acp.WriteTextFileRequest
  ): Promise<acp.WriteTextFileResponse> {
    return this.#connection.sendRequest('fs/write_text_file', params);
  }
  
  /**
   * Creates a terminal session.
   */
  async createTerminal(
    params: acp.CreateTerminalRequest
  ): Promise<acp.CreateTerminalResponse> {
    return this.#connection.sendRequest('terminal/create', params);
  }
  
  /**
   * Gets terminal output.
   */
  async getTerminalOutput(
    params: acp.TerminalOutputRequest
  ): Promise<acp.TerminalOutputResponse> {
    return this.#connection.sendRequest('terminal/output', params);
  }
  
  /**
   * Waits for terminal exit.
   */
  async waitForTerminalExit(
    params: acp.WaitForTerminalExitRequest
  ): Promise<acp.WaitForTerminalExitResponse> {
    return this.#connection.sendRequest('terminal/wait_for_exit', params);
  }
  
  /**
   * Kills a terminal session.
   */
  async killTerminal(
    params: acp.KillTerminalCommandRequest
  ): Promise<acp.KillTerminalCommandResponse> {
    return this.#connection.sendRequest('terminal/kill', params);
  }
  
  /**
   * Releases a terminal session.
   */
  async releaseTerminal(
    params: acp.ReleaseTerminalRequest
  ): Promise<acp.ReleaseTerminalResponse> {
    return this.#connection.sendRequest('terminal/release', params);
  }
  
  /**
   * Starts the connection and handles incoming messages.
   */
  async start(): Promise<void> {
    await this.#connection.start(async (method, params) => {
      return this.#handleRequest(method, params);
    });
  }
  
  /**
   * Closes the connection.
   */
  async close(): Promise<void> {
    await this.#connection.close();
  }
  
  /**
   * Gets whether the connection is closed.
   */
  isClosed(): boolean {
    return this.#connection.isClosed();
  }
}

/**
 * Creates an ACP stdio transport for editor communication.
 * 
 * This factory function sets up the complete transport infrastructure including:
 * - NDJSON stream handling via stdin/stdout
 * - Initialization handshake with version negotiation
 * - Message routing for requests and notifications
 * - Connection lifecycle management
 * 
 * @param config - Transport configuration options
 * @returns Object with connection and control methods
 * 
 * @example
 * ```typescript
 * import { createACPStdioTransport } from './createACPStdioTransport';
 * 
 * const { connection, start, close } = createACPStdioTransport({
 *   agent: (conn) => new MyAgent(conn),
 *   agentInfo: {
 *     name: 'my-agent',
 *     version: '1.0.0'
 *   }
 * });
 * 
 * await start();
 * ```
 */
export function createACPStdioTransport(
  config: ACPStdioTransportConfig
): {
  /**
   * The ACP connection instance for sending messages.
   */
  connection: ACPStdioConnection;
  
  /**
   * Starts the transport and begins processing messages.
   */
  start: () => Promise<void>;
  
  /**
   * Closes the transport gracefully.
   */
  close: () => Promise<void>;
  
  /**
   * Gets whether the transport is closed.
   */
  isClosed: () => boolean;
} {
  const debug = config.debug ?? false;
  
  // Create or use the provided stream
  const stream = config.stream ?? createNodeStream();
  
  // Create the connection
  const connection = new Connection(stream, debug);
  
  // Set up agent info with defaults
  const agentInfo: acp.Implementation = {
    _meta: null,
    name: config.agentInfo?.name ?? 'acp-middleware-callbacks-agent',
    version: config.agentInfo?.version ?? '0.1.0',
  };
  
  // Set up agent capabilities with defaults
  const agentCapabilities: acp.AgentCapabilities = config.agentCapabilities ?? {
    loadSession: true,
    promptCapabilities: {
      image: true,
      audio: true,
      embeddedContext: true,
    },
  };
  
  // Create the stdio connection
  const stdioConnection = new ACPStdioConnection(
    connection,
    agentInfo,
    agentCapabilities,
    debug
  );
  
  // Create the agent instance
  const agent = config.agent(stdioConnection);
  stdioConnection.setAgent(agent);
  
  return {
    connection: stdioConnection,
    start: () => stdioConnection.start(),
    close: () => connection.close(),
    isClosed: () => connection.isClosed(),
  };
}

/**
 * Creates an ACP stdio transport using process streams (stdin/stdout).
 * This is a convenience function that uses the current process's stdio.
 * 
 * @param config - Transport configuration options
 * @returns Object with connection and control methods
 * 
 * @example
 * ```typescript
 * import { createStdioTransport } from './createACPStdioTransport';
 * 
 * const { connection, start, close } = createStdioTransport({
 *   agent: (conn) => new MyAgent(conn)
 * });
 * 
 * await start();
 * ```
 */
export function createStdioTransport(
  config: Omit<ACPStdioTransportConfig, 'stream'>
): {
  connection: ACPStdioConnection;
  start: () => Promise<void>;
  close: () => Promise<void>;
  isClosed: () => boolean;
} {
  return createACPStdioTransport({
    ...config,
    stream: createNodeStream(),
  });
}