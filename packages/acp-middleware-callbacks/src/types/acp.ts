/**
 * ACP Protocol Types
 * 
 * Re-exports all protocol types from @agentclientprotocol/sdk for convenient usage.
 * These types provide the foundational data structures for Agent Client Protocol communication.
 * 
 * @packageDocumentation
 */

// Re-export all protocol types from @agentclientprotocol/sdk
export type {
  // Session notification and update types
  SessionNotification,
  SessionUpdate,
  
  // Tool call types
  ToolCall,
  ToolCallUpdate,
  ToolCallContent,
  ToolCallStatus,
  ToolKind,
  
  // Content block types
  ContentBlock,
  TextContent,
  ImageContent,
  AudioContent,
  ResourceLink,
  EmbeddedResource,
  
  // Permission types
  RequestPermissionRequest,
  RequestPermissionResponse,
  PermissionOption,
  PermissionOptionKind,
  
  // Stop reason type
  StopReason,
  
  // Initialization types
  InitializeRequest,
  InitializeResponse,
  
  // Authentication types
  AuthenticateRequest,
  AuthenticateResponse,
  AuthMethod,
  
  // Session management types
  NewSessionRequest,
  NewSessionResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  
  // Prompt types
  PromptRequest,
  PromptResponse,
  
  // Session mode and configuration types
  SetSessionModeRequest,
  SetSessionModeResponse,
  SessionModeState,
  SessionConfigOption,
  
  // File system types
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
  
  // Terminal types
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalCommandRequest,
  KillTerminalCommandResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  EnvVariable,
  
  // MCP types
  McpServer,
  McpCapabilities,
  
  // Capability types
  ClientCapabilities,
  AgentCapabilities,
  SessionCapabilities,
  PromptCapabilities,
  
  // Core identifiers
  SessionId,
  RequestId,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";

// Re-export type-only imports for convenience
export type {
  // Implementation info
  Implementation,
  
  // Role type for annotations
  Role,
  
  // Annotations for content blocks
  Annotations,
} from "@agentclientprotocol/sdk";