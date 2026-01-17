/**
 * Stop Reason Mapper
 * 
 * Maps LangChain agent state and errors to ACP protocol stop reasons.
 * Provides utilities for converting execution outcomes into the appropriate
 * ACP protocol responses.
 * 
 * @packageDocumentation
 */

import type { StopReason } from "@agentclientprotocol/sdk";

/**
 * Maps LangChain agent state to ACP stop reason.
 * 
 * This function analyzes the agent state and determines the appropriate
 * stop reason based on the execution context. The mapping follows the
 * official ACP protocol specification for stop reasons.
 * 
 * Official StopReason values from @agentclientprotocol/sdk:
 * - 'end_turn': The agent successfully completed the task
 * - 'max_tokens': The maximum token limit was reached
 * - 'max_turn_requests': The maximum number of turn requests was exceeded
 * - 'refusal': The agent refused to continue
 * - 'cancelled': The user explicitly cancelled the operation
 * 
 * @param state - The LangChain agent state to analyze
 * @returns The corresponding ACP stop reason
 * 
 * @example
 * ```typescript
 * const state = { cancelled: true };
 * const reason = mapToStopReason(state); // returns 'cancelled'
 * 
 * const state2 = { refusal: true };
 * const reason2 = mapToStopReason(state2); // returns 'refusal'
 * ```
 */
export function mapToStopReason(state: Record<string, unknown>): StopReason {
  // Check for user cancellation first (highest priority)
  if (state.cancelled === true || 
      state.permissionDenied === true ||
      state.userRequested === true ||
      state.interrupted === true) {
    return 'cancelled';
  }
  
  // Check for refusal
  if (state.refusal === true || 
      state.modelRefused === true) {
    return 'refusal';
  }
  
  // Check for token limit exceeded
  if (state.llmOutput && typeof state.llmOutput === 'object') {
    const llmOutput = state.llmOutput as Record<string, unknown>;
    if (llmOutput.finish_reason === 'length' || 
        llmOutput.finish_reason === 'context_length' ||
        llmOutput.finish_reason === 'token_limit') {
      return 'max_tokens';
    }
  }
  
  if (state.tokenLimitReached === true ||
      state.contextLengthExceeded === true ||
      state.maxTokensReached === true) {
    return 'max_tokens';
  }
  
  // Check for max turn requests exceeded
  if (typeof state.turnRequests === 'number' && 
      typeof state.maxTurnRequests === 'number' &&
      state.turnRequests >= state.maxTurnRequests) {
    return 'max_turn_requests';
  }
  
  if (state.maxStepsReached === true ||
      state.maxTurnsReached === true) {
    return 'max_turn_requests';
  }
  
  // Check for explicit errors - these are treated as normal completion
  // The error should be communicated via sessionUpdate instead
  if (state.error !== undefined && state.error !== null) {
    return 'end_turn';
  }
  
  // Default to completed if no other condition matches
  return 'end_turn';
}

/**
 * Creates a stop reason from an error.
 * 
 * This function analyzes an error and determines the appropriate
 * stop reason based on the error type and message.
 * 
 * @param error - The error to analyze
 * @returns The corresponding ACP stop reason
 * 
 * @example
 * ```typescript
 * try {
 *   // ... code that might throw
 * } catch (error) {
 *   const reason = createStopReasonFromError(error);
 * }
 * ```
 */
export function createStopReasonFromError(error: Error | unknown): StopReason {
  // Handle non-Error types
  if (!(error instanceof Error)) {
    return 'end_turn';
  }
  
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  
  // Check for cancellation-related errors
  if (message.includes('cancelled') || 
      message.includes('canceled') ||
      message.includes('aborted') ||
      message.includes('interrupted')) {
    return 'cancelled';
  }
  
  // Check for permission denied errors
  if (message.includes('permission') ||
      message.includes('denied') ||
      message.includes('unauthorized') ||
      message.includes('forbidden')) {
    return 'cancelled';
  }
  
  // Check for refusal-related errors
  if (message.includes('refuse') ||
      message.includes('declined') ||
      name.includes('refusal')) {
    return 'refusal';
  }
  
  // Check for token limit errors
  if (message.includes('token') || 
      message.includes('length') ||
      message.includes('context') ||
      message.includes('limit')) {
    return 'max_tokens';
  }
  
  // Check for turn limit errors
  if (message.includes('turn') ||
      message.includes('step') ||
      message.includes('max')) {
    return 'max_turn_requests';
  }
  
  // Default to end_turn for other errors
  return 'end_turn';
}

/**
 * Type guard to check if a value is a valid StopReason.
 * 
 * @param value - The value to check
 * @returns True if the value is a valid StopReason
 * 
 * @example
 * ```typescript
 * if (isStopReason(value)) {
 *   // value is now typed as StopReason
 * }
 * ```
 */
export function isStopReason(value: unknown): value is StopReason {
  return (
    value === 'cancelled' ||
    value === 'refusal' ||
    value === 'max_tokens' ||
    value === 'max_turn_requests' ||
    value === 'end_turn'
  );
}

/**
 * Safely converts an unknown value to a StopReason.
 * 
 * @param value - The value to convert
 * @param defaultReason - The default stop reason if conversion fails
 * @returns The stop reason
 * 
 * @example
 * ```typescript
 * const reason = asStopReason(input, 'end_turn');
 * ```
 */
export function asStopReason(
  value: unknown,
  defaultReason: StopReason = 'end_turn'
): StopReason {
  if (isStopReason(value)) {
    return value;
  }
  return defaultReason;
}
