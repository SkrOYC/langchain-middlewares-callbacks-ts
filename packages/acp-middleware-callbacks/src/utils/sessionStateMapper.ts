/**
 * Session State Mapper
 * 
 * Utilities for extracting and validating ACP session state from LangChain agents.
 * This module handles the conversion between LangChain's internal state representation
 * and the ACP session state format.
 * 
 * @packageDocumentation
 */

import { z } from "zod";
import type { SessionId } from "@agentclientprotocol/sdk";

/**
 * Session state interface representing the complete state of an ACP session.
 * 
 * This interface captures all relevant state information needed for session
 * management in the ACP protocol, including checkpoint data, messages, and
 * middleware-specific state.
 */
export interface SessionState {
  /**
   * Unique identifier for this session.
   */
  sessionId: SessionId;
  
  /**
   * The checkpoint data from the LangGraph checkpointer.
   * Contains the persisted state snapshot.
   */
  checkpoint: Record<string, unknown>;
  
  /**
   * List of messages in the conversation history.
   */
  messages: Array<Record<string, unknown>>;
  
  /**
   * Custom state data specific to the agent implementation.
   */
  customState: Record<string, unknown>;
  
  /**
   * State data from middleware components.
   */
  middlewareState: Record<string, Record<string, unknown>>;
  
  /**
   * Timestamp when this state was created.
   */
  timestamp: string;
  
  /**
   * Sequence number for state ordering.
   */
  version: number;
}

/**
 * Zod schema for validating SessionState.
 */
export const zSessionState = z.object({
  sessionId: z.string().min(1),
  checkpoint: z.record(z.string(), z.unknown()),
  messages: z.array(z.record(z.string(), z.unknown())),
  customState: z.record(z.string(), z.unknown()),
  middlewareState: z.record(z.string(), z.record(z.string(), z.unknown())),
  timestamp: z.string().datetime(),
  version: z.number().int().positive(),
});

/**
 * Extracts session state from LangChain agent state.
 * 
 * This function pulls together the various state components from the LangChain
 * agent and consolidates them into a single SessionState object suitable for
 * ACP protocol communication.
 * 
 * @param agentState - The LangChain agent state
 * @param sessionId - The session ID to use
 * @param checkpoint - Optional checkpoint data from the checkpointer
 * @returns A SessionState object containing all relevant state information
 */
export function extractSessionState(
  agentState: Record<string, unknown>,
  sessionId: SessionId,
  checkpoint?: Record<string, unknown>
): SessionState {
  // Extract messages from the state
  const messages = extractMessages(agentState);
  
  // Extract custom state
  const customState = extractCustomState(agentState);
  
  // Extract middleware state
  const middlewareState = extractMiddlewareState(agentState);
  
  // Build the session state object
  const sessionState: SessionState = {
    sessionId,
    checkpoint: checkpoint || {},
    messages,
    customState,
    middlewareState,
    timestamp: new Date().toISOString(),
    version: getStateVersion(agentState),
  };
  
  return sessionState;
}

/**
 * Validates a SessionState object.
 * 
 * @param state - The SessionState to validate
 * @returns True if the state is valid, false otherwise
 */
export function validateSessionState(state: SessionState): boolean {
  const result = zSessionState.safeParse(state);
  return result.success;
}

/**
 * Validates a SessionState object and returns detailed validation errors.
 * 
 * @param state - The SessionState to validate
 * @returns Validation result with success status and any errors
 */
export function validateSessionStateDetailed(
  state: SessionState
): { success: boolean; errors?: string[] } {
  const result = zSessionState.safeParse(state);
  
  if (result.success) {
    return { success: true };
  }
  
  const errors = result.error.issues.map((err) => {
    const path = err.path.join('.');
    return `${path}: ${err.message}`;
  });
  
  return { success: false, errors };
}

/**
 * Creates a SessionState from a checkpoint.
 * 
 * @param checkpoint - The checkpoint data from the LangGraph checkpointer
 * @param sessionId - The session ID
 * @returns A SessionState object
 */
export function createSessionStateFromCheckpoint(
  checkpoint: Record<string, unknown>,
  sessionId: SessionId
): SessionState {
  // Extract values from checkpoint
  const checkpointValue = checkpoint.value as Record<string, unknown> | undefined;
  const messages = checkpointValue?.messages as Array<Record<string, unknown>> | undefined;
  const customState = checkpointValue?.custom_state as Record<string, unknown> | undefined;
  
  return {
    sessionId,
    checkpoint,
    messages: messages || [],
    customState: customState || {},
    middlewareState: {},
    timestamp: new Date().toISOString(),
    version: (checkpoint.version as number) || 1,
  };
}

/**
 * Merges two SessionState objects.
 * 
 * @param current - The current session state
 * @param update - The updates to apply
 * @returns A new SessionState with the updates applied
 */
export function mergeSessionState(
  current: SessionState,
  update: Partial<SessionState>
): SessionState {
  return {
    sessionId: update.sessionId ?? current.sessionId,
    checkpoint: { ...current.checkpoint, ...update.checkpoint },
    messages: update.messages ?? current.messages,
    customState: { ...current.customState, ...update.customState },
    middlewareState: mergeMiddlewareState(current.middlewareState, update.middlewareState),
    timestamp: update.timestamp ?? new Date().toISOString(),
    version: (update.version ?? current.version) + 1,
  };
}

/**
 * Creates a deep clone of a SessionState object.
 * 
 * @param state - The session state to clone
 * @returns A deep clone of the session state
 */
export function cloneSessionState(state: SessionState): SessionState {
  // Use structuredClone for proper deep cloning of Dates, Sets, Maps, etc.
  // Fall back to JSON method for environments that don't support it
  // @ts-ignore: structuredClone is available in Node 17+ and modern browsers
  if (typeof structuredClone === 'function') {
    // @ts-ignore
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state));
}

/**
 * Serializes a SessionState to a JSON string.
 * 
 * @param state - The session state to serialize
 * @returns A JSON string representation of the state
 */
export function serializeSessionState(state: SessionState): string {
  return JSON.stringify(state);
}

/**
 * Deserializes a SessionState from a JSON string.
 * 
 * @param json - The JSON string to deserialize
 * @returns The deserialized SessionState, or null if invalid
 */
export function deserializeSessionState(json: string): SessionState | null {
  try {
    const parsed = JSON.parse(json);
    const result = zSessionState.safeParse(parsed);
    
    if (result.success) {
      return result.data;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts messages from agent state.
 */
function extractMessages(agentState: Record<string, unknown>): Array<Record<string, unknown>> {
  // Try common locations for messages in LangChain state
  if (Array.isArray(agentState.messages)) {
    return agentState.messages as Array<Record<string, unknown>>;
  }
  
  if (Array.isArray(agentState.chat_history)) {
    return agentState.chat_history as Array<Record<string, unknown>>;
  }
  
  if (Array.isArray(agentState.history)) {
    return agentState.history as Array<Record<string, unknown>>;
  }
  
  return [];
}

/**
 * Extracts custom state from agent state.
 */
function extractCustomState(agentState: Record<string, unknown>): Record<string, unknown> {
  // Check for custom state in common locations
  if (agentState.custom_state && typeof agentState.custom_state === 'object') {
    return agentState.custom_state as Record<string, unknown>;
  }
  
  if (agentState.custom && typeof agentState.custom === 'object') {
    return agentState.custom as Record<string, unknown>;
  }
  
  // Return filtered state excluding reserved keys
  const reservedKeys = ['messages', 'chat_history', 'history', 'custom_state', 'custom', 'middleware_state', 'checkpoint'];
  const customState: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(agentState)) {
    if (!reservedKeys.includes(key) && typeof value !== 'function') {
      customState[key] = value;
    }
  }
  
  return customState;
}

/**
 * Extracts middleware state from agent state.
 */
function extractMiddlewareState(agentState: Record<string, unknown>): Record<string, Record<string, unknown>> {
  if (agentState.middleware_state && typeof agentState.middleware_state === 'object') {
    return agentState.middleware_state as Record<string, Record<string, unknown>>;
  }
  
  return {};
}

/**
 * Merges middleware state objects.
 */
function mergeMiddlewareState(
  current: Record<string, Record<string, unknown>>,
  update?: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  if (!update) {
    return current;
  }
  
  const merged: Record<string, Record<string, unknown>> = { ...current };
  
  for (const [key, value] of Object.entries(update)) {
    if (key in merged) {
      merged[key] = { ...merged[key], ...value };
    } else {
      merged[key] = value;
    }
  }
  
  return merged;
}

/**
 * Gets the version number from agent state.
 */
function getStateVersion(agentState: Record<string, unknown>): number {
  if (typeof agentState.version === 'number') {
    return agentState.version;
  }
  
  if (typeof agentState.state_version === 'number') {
    return agentState.state_version;
  }
  
  return 1;
}