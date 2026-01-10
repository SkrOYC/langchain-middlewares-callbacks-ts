/**
 * ACP Stdio Transport Module
 * 
 * Exports for the stdio transport implementation for ACP editor communication.
 * 
 * @packageDocumentation
 */

// Main transport factory
export { 
  createACPStdioTransport, 
  createStdioTransport,
  type ACPStdioTransportConfig,
  type AgentImplementation,
} from './createACPStdioTransport.js';

// Connection class
export { 
  ACPStdioConnection,
} from './createACPStdioTransport.js';

// Stream utilities
export { 
  createACPStream,
  createNodeStream,
  createTestStreamPair,
  type ACPStream,
  type NodeStreamsOptions,
} from './ndJsonStream.js';