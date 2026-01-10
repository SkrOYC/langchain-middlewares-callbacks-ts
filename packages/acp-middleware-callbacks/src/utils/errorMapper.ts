/**
 * Error & stopReason Mapper
 * 
 * Maps LangChain agent state to ACP protocol stop reasons and error codes.
 * This module provides utilities for converting LangChain execution state
 * into the appropriate ACP protocol responses.
 * 
 * @packageDocumentation
 */

// Re-export RequestError from @agentclientprotocol/sdk for convenience
export {
  RequestError,
  type RequestError as ACPRequestError,
} from "@agentclientprotocol/sdk";

// Re-export stop reason utilities from stopReasonMapper
export {
  mapToStopReason,
  isStopReason,
} from "./stopReasonMapper.js";

/**
 * ACP Error Codes as specified in the official protocol documentation.
 * 
 * These codes follow the JSON-RPC 2.0 specification with ACP-specific extensions.
 * 
 * JSON-RPC Standard Codes:
 * -32700: Parse error - Invalid JSON received
 * -32600: Invalid request - JSON is not a valid request object
 * -32601: Method not found - Requested method does not exist
 * -32602: Invalid params - Method parameters are invalid
 * -32603: Internal error - Internal JSON-RPC error
 * 
 * ACP-Specific Codes:
 * -32000: Authentication required - Authentication needed for operation
 * -32002: Resource not found - Referenced resource does not exist
 */
export const ACP_ERROR_CODES = {
  // JSON-RPC 2.0 Standard Errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  
  // ACP-Specific Errors
  AUTH_REQUIRED: -32000,
  RESOURCE_NOT_FOUND: -32002,
  
  // Custom application-specific errors (reserved range -32000 to -32099)
  SESSION_EXPIRED: -32010,
  RATE_LIMITED: -32011,
  QUOTA_EXCEEDED: -32012,
  PERMISSION_DENIED: -32013,
  TOOL_NOT_FOUND: -32014,
  TOOL_EXECUTION_ERROR: -32015,
  VALIDATION_ERROR: -32016,
} as const;

/**
 * Type for the error code values.
 */
export type ACPErrorCode = (typeof ACP_ERROR_CODES)[keyof typeof ACP_ERROR_CODES];

/**
 * Maps a LangChain error to an ACP error code.
 * 
 * @param error - The error to map
 * @returns The corresponding ACP error code
 */
export function mapLangChainError(error: Error | unknown): ACPErrorCode {
  // Handle string errors
  if (typeof error === 'string') {
    const lowerError = error.toLowerCase();
    if (lowerError.includes('auth') || lowerError.includes('permission')) {
      return ACP_ERROR_CODES.AUTH_REQUIRED;
    }
    if (lowerError.includes('not found') || lowerError.includes('missing')) {
      return ACP_ERROR_CODES.RESOURCE_NOT_FOUND;
    }
    return ACP_ERROR_CODES.INTERNAL_ERROR;
  }
  
  // Handle Error instances
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();
    
    // Authentication errors
    if (message.includes('auth') || 
        message.includes('permission') ||
        name.includes('authentication') ||
        name.includes('authorization')) {
      return ACP_ERROR_CODES.AUTH_REQUIRED;
    }
    
    // Resource not found errors
    if (message.includes('not found') || 
        message.includes('missing') ||
        message.includes('does not exist') ||
        name.includes('notfound') ||
        name.includes('not-found')) {
      return ACP_ERROR_CODES.RESOURCE_NOT_FOUND;
    }
    
    // Validation errors
    if (message.includes('validation') || 
        message.includes('invalid') ||
        message.includes('schema') ||
        name.includes('validation') ||
        name.includes('zod')) {
      return ACP_ERROR_CODES.INVALID_PARAMS;
    }
    
    // Tool execution errors
    if (message.includes('tool') || 
        name.includes('tool') ||
        name.includes('toolcall')) {
      if (message.includes('not found')) {
        return ACP_ERROR_CODES.TOOL_NOT_FOUND;
      }
      return ACP_ERROR_CODES.TOOL_EXECUTION_ERROR;
    }
    
    // Default to internal error for unknown errors
    return ACP_ERROR_CODES.INTERNAL_ERROR;
  }
  
  // Default to internal error for unknown types
  return ACP_ERROR_CODES.INTERNAL_ERROR;
}

/**
 * Creates a formatted error message for ACP responses.
 * 
 * @param code - The ACP error code
 * @param message - The error message
 * @param data - Optional additional data
 * @returns An object suitable for ACP error response
 */
export function createACPErrorResponse(
  code: ACPErrorCode,
  message: string,
  data?: unknown
): { code: number; message: string; data?: unknown } {
  return {
    code,
    message,
    data,
  };
}

/**
 * Type guard to check if a value is a valid ACP error code.
 * 
 * @param value - The value to check
 * @returns True if the value is a valid ACP error code
 */
export function isACPErrorCode(value: unknown): value is ACPErrorCode {
  return (
    typeof value === 'number' &&
    Object.values(ACP_ERROR_CODES).includes(value as ACPErrorCode)
  );
}