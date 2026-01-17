/**
 * ACP Agent Implementation
 *
 * This file implements the complete Agent interface required by the ACP protocol,
 * integrating LangChain's createAgent with our middleware callbacks package.
 */

import { createAgent } from "langchain";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type {
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  PromptRequest,
  PromptResponse,
  SessionId,
  SetSessionModeRequest,
  SetSessionModeResponse,
  AuthenticateRequest,
  AuthenticateResponse,
} from "@agentclientprotocol/sdk";
import {
  createACPSessionMiddleware,
  createACPToolMiddleware,
  createACPModeMiddleware,
  ACPCallbackHandler,
} from "@skroyc/acp-middleware-callbacks";
import type { ContentBlock } from "@skroyc/acp-middleware-callbacks";
import { ModelConfig } from "./model.js";
import { StructuredTool } from "@langchain/core/tools";

/**
 * Agent interface implementation for ACP protocol
 */
export interface ACPAgentInterface {
  initialize(params: InitializeRequest): Promise<InitializeResponse>;
  authenticate(params: AuthenticateRequest): Promise<AuthenticateResponse>;
  newSession(params: NewSessionRequest): Promise<NewSessionResponse>;
  loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse>;
  prompt(params: PromptRequest): Promise<PromptResponse>;
  cancel(params: { sessionId: SessionId }): Promise<void>;
  setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse>;
}

/**
 * Configuration for the ACPAgent
 */
interface ACPAgentConfig {
  modelConfig: ModelConfig;
  tools: StructuredTool[];
}

/**
 * ACPAgent - Complete ACP Agent implementation
 *
 * This class implements the full ACP Agent interface and integrates
 * LangChain's createAgent with our middleware callbacks package.
 */
export class ACPAgent implements ACPAgentInterface {
  private config: ACPAgentConfig;
  private connection: any = null; // AgentSideConnection
  private langchainAgent: any = null;
  private activeSessions: Map<string, any> = new Map();
  private callbackHandler: ACPCallbackHandler | null = null;
  private isInitialized = false;

  constructor(config: ACPAgentConfig) {
    if (!config.modelConfig) {
      throw new Error("ModelConfig is required in ACPAgentConfig");
    }
    if (!config.tools || !Array.isArray(config.tools)) {
      throw new Error("Tools array is required in ACPAgentConfig");
    }
    this.config = config;
  }

  /**
   * Initialize the agent connection
   */
  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    this.isInitialized = true;
    
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: { http: true, sse: true },
        promptCapabilities: {
          audio: false,
          embeddedContext: false,
          image: false,
        },
        sessionCapabilities: {},
      },
      agentInfo: {
        name: "@skroyc/acp-backend-example",
        version: "0.1.0",
      },
      authMethods: [],
    };
  }

  /**
   * Authenticate the client (no-op for this example)
   */
  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
    // No authentication required
    return {};
  }
  
  /**
   * Connect this agent to an SDK connection
   */
  connect(connection: any): void {
    this.connection = connection;

    // Initialize the LangChain agent
    this.initializeLangChainAgent();
  }

  /**
   * Initialize the LangChain agent with all middleware
   */
  private async initializeLangChainAgent(): Promise<void> {
    const model = await this.config.modelConfig.getModel();

    // Create middleware stack
    const middleware = [
      createACPSessionMiddleware({
        emitStateSnapshots: "none",
      }),
      createACPToolMiddleware({
        emitToolResults: false,
      }),
      createACPModeMiddleware({
        defaultMode: "agentic",
        modes: {
          "agentic": {
            description: "Standard agentic mode with tool access",
            allowedTools: ["*"],
            systemPrompt: "You are a helpful assistant that can read and write files, execute bash commands, and search for text.",
          },
        },
        transport: this.connection,
      }),
    ];

    // Create callback handler
    this.callbackHandler = new ACPCallbackHandler({
      connection: this.connection,
    });

    // Create the LangChain agent with middleware only
    // Callbacks are passed at runtime via streamEvents()
    this.langchainAgent = createAgent({
      model,
      tools: this.config.tools,
      middleware: middleware as any,
    });
  }

  /**
   * Create a new session
   */
  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = `session-${Date.now()}`;
    
    // Update callback handler with new session ID
    if (this.callbackHandler) {
      this.callbackHandler.setSessionId(sessionId);
    }
    
    // Store session
    this.activeSessions.set(sessionId, {
      createdAt: new Date(),
      messages: [],
      state: {},
      cwd: params.cwd,
      currentModelId: "default",
    });
    
    // Send available commands update
    await this.sendAvailableCommands(sessionId);
    
    // Return session creation confirmation with proper structure
    return {
      sessionId,
      models: {
        availableModels: [
          {
            modelId: "default",
            name: "Default Model",
            description: "Default model for this agent",
          },
        ],
        currentModelId: "default",
      },
      modes: {
        availableModes: [
          { id: "agentic", name: "Agentic", description: "Full autonomy mode" },
          { id: "interactive", name: "Interactive", description: "Interactive mode" },
          { id: "readonly", name: "Read-only", description: "Read-only mode" },
        ],
        currentModeId: "agentic",
      },
    };
  }

  /**
   * Load an existing session
   */
  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const { sessionId } = params;

    // Check if session exists
    let session = this.activeSessions.get(sessionId);
    if (!session) {
      // Create session with the requested sessionId (not a new generated one)
      this.activeSessions.set(sessionId, {
        createdAt: new Date(),
        messages: [],
        state: {},
        cwd: params.cwd,
        currentModelId: "default",
        mode: "agentic",
      });
      session = this.activeSessions.get(sessionId)!;

      // Update callback handler with new session ID
      if (this.callbackHandler) {
        this.callbackHandler.setSessionId(sessionId);
      }

      // Send available commands update
      await this.sendAvailableCommands(sessionId);
    }

    return {
      models: {
        availableModels: [
          {
            modelId: "default",
            name: "Default Model",
            description: "Default model for this agent",
          },
        ],
        currentModelId: session.currentModelId || "default",
      },
      modes: {
        availableModes: [
          { id: "agentic", name: "Agentic", description: "Full autonomy mode" },
          { id: "interactive", name: "Interactive", description: "Interactive mode" },
          { id: "readonly", name: "Read-only", description: "Read-only mode" },
        ],
        currentModeId: session.mode || "agentic",
      },
    };
  }

  /**
   * Send available commands update to the client
   */
  private async sendAvailableCommands(sessionId: string): Promise<void> {
    // Map available tools to slash commands
    const availableCommands = this.config.tools.map((tool) => ({
      name: tool.name.replace(/_/g, "-"),
      description: tool.description || `Use ${tool.name} tool`,
      input: null,
    }));
    
    // Send session update with available commands
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands,
      },
    });
  }

  /**
   * Set the session mode
   */
  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    const { sessionId, modeId } = params;

    // Update session with new mode
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.mode = modeId;
    }

    // Send mode update notification
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: modeId,
      },
    });
    
    return {};
  }

  /**
   * Process a prompt in the specified session
   */
  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const { sessionId } = params;
    const messages = params.prompt;
    
    // Ensure session exists
    if (!this.activeSessions.has(sessionId)) {
      // Create a session for this conversation
      const newSessionId = `session-${Date.now()}`;
      this.activeSessions.set(newSessionId, {
        createdAt: new Date(),
        messages: [],
        state: {},
        cwd: undefined,
        currentModelId: "default",
        mode: "agentic",
      });
      if (this.callbackHandler) {
        this.callbackHandler.setSessionId(newSessionId);
      }
      await this.sendAvailableCommands(newSessionId);
    }
    
    const session = this.activeSessions.get(sessionId)!;
    
    // Add messages to session
    session.messages.push(...messages);
    
    try {
      // Update callback handler with current session ID
      if (this.callbackHandler) {
        this.callbackHandler.setSessionId(sessionId);
      }
      
      // Convert messages to LangChain format
      const langchainMessages = this.convertMessagesToLangChain(messages);
      
      // Check if agent is initialized
      if (!this.langchainAgent) {
        throw new Error("LangChain agent not initialized");
      }
      
      // Invoke agent via streamEvents with callbacks passed at runtime
      // This is the critical step: callbacks handle streaming events (tokens, tools)
      const eventStream = await (this.langchainAgent as any).streamEvents(
        { messages: langchainMessages },
        {
          version: "v2",
          callbacks: this.callbackHandler ? [this.callbackHandler] : undefined,
          configurable: { thread_id: sessionId },
          recursionLimit: 100,  // Increase from default 25 to handle complex agent workflows
        }
      );
      
      // Consume the event stream to trigger full execution
      for await (const event of eventStream) {
        // Events are emitted via callbacks → connection → Zed
        // We just need to consume the stream to let callbacks fire
      }

      return { stopReason: "end_turn" };

    } catch (error) {
      // Emit error as agent_message_chunk via sessionUpdate
      const contentChunk = {
        _meta: null,
        content: {
          type: "text",
          text: `Error processing request: ${error instanceof Error ? error.message : "Unknown error"}`,
          _meta: null,
          annotations: null,
        },
      };

      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          ...contentChunk,
        },
      });

      return { stopReason: "end_turn" };
    }
  }

  /**
   * Cancel the current operation in a session
   */
  async cancel(params: { sessionId: SessionId }): Promise<void> {
    const { sessionId } = params;
    
    // Clear the current operation state
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.state = { cancelled: true };
    }
    
    // Note: cancel is a notification, no response is sent
    // The client handles the cancellation UI
  }

  /**
   * Convert ACP content blocks to LangChain message format
   */
  private convertMessagesToLangChain(messages: ContentBlock[]): any[] {
    // This is a simplified conversion - in production you'd want more robust handling
    return messages.map((block) => {
      if (block.type === "text") {
        return {
          type: "human",
          content: (block as any).text,
        };
      }
      return {
        type: "human",
        content: JSON.stringify(block),
      };
    });
  }

  /**
   * Send agent response back to the client
   */
  private async sendAgentResponse(result: any, sessionId: string): Promise<void> {
    const content = this.extractContentFromResult(result);

    // Emit response as agent_message_chunk via sessionUpdate
    const contentChunk = {
      _meta: null,
      content: {
        type: "text",
        text: content,
        _meta: null,
        annotations: null,
      },
    };

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        ...contentChunk,
      },
    });
  }

  /**
   * Extract content from LangChain agent result
   */
  private extractContentFromResult(result: any): string {
    if (typeof result === "string") {
      return result;
    }

    if (result.content) {
      return typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content);
    }

    return JSON.stringify(result);
  }

  /**
   * Close the agent and cleanup resources
   */
  async close(): Promise<void> {
    // Clear all sessions
    this.activeSessions.clear();

    // Connection lifecycle is managed by the SDK
    // No action needed here
  }
}
