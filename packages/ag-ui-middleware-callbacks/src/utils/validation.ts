/**
 * AG-UI Event Validation Utilities
 * 
 * Provides optional runtime validation of AG-UI events using @ag-ui/core Zod schemas.
 * Validation is disabled by default for performance; enable in development for debugging.
 * 
 * @example
 * ```typescript
 * import { validateEvent, isValidEvent } from './utils/validation';
 * 
 * // Safe validation (returns result object)
 * const result = validateEvent(event);
 * if (result.success) {
 *   console.log('Valid event:', result.data);
 * } else {
 *   console.error('Invalid event:', result.error);
 * }
 * 
 * // Boolean check
 * if (isValidEvent(event)) {
 *   // event is valid
 * }
 * ```
 */

import { EventSchemas } from '@ag-ui/core';
import type { AGUIEvent } from '../events';

/**
 * Result of event validation.
 */
export interface ValidationResult<T = AGUIEvent> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    issues: Array<{
      path: (string | number)[];
      message: string;
    }>;
  };
}

/**
 * Validate an AG-UI event against @ag-ui/core schemas.
 * 
 * Note: This validation uses @ag-ui/core's schema which may have slight
 * differences from our internal types (e.g., toolCalls vs tool_calls).
 * Use for debugging and development, not in production hot paths.
 * 
 * @param event - The event to validate
 * @returns ValidationResult with success status and any errors
 */
export function validateEvent(event: unknown): ValidationResult {
  try {
    // Convert our format to @ag-ui/core format for validation
    const coreEvent = convertToValidationFormat(event);
    const result = EventSchemas.safeParse(coreEvent);
    
    if (result.success) {
      return {
        success: true,
        data: event as AGUIEvent, // Return original format
      };
    }
    
    return {
      success: false,
      error: {
        message: 'Event validation failed',
        issues: result.error.issues.map(issue => ({
          path: issue.path,
          message: issue.message,
        })),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: {
        message: err instanceof Error ? err.message : 'Unknown validation error',
        issues: [],
      },
    };
  }
}

/**
 * Check if an event is valid according to @ag-ui/core schemas.
 * 
 * @param event - The event to check
 * @returns true if valid, false otherwise
 */
export function isValidEvent(event: unknown): event is AGUIEvent {
  return validateEvent(event).success;
}

/**
 * Convert our event format to @ag-ui/core validation format.
 * Handles field name differences.
 */
function convertToValidationFormat(event: unknown): unknown {
  if (!event || typeof event !== 'object') {
    return event;
  }
  
  const e = event as Record<string, unknown>;
  
  // Handle MESSAGES_SNAPSHOT: convert tool_calls to toolCalls
  if (e.type === 'MESSAGES_SNAPSHOT' && Array.isArray(e.messages)) {
    return {
      ...e,
      messages: (e.messages as any[]).map(msg => ({
        ...msg,
        toolCalls: msg.tool_calls?.map((tc: any) => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
        })),
        tool_calls: undefined,
        toolCallId: msg.tool_call_id,
        tool_call_id: undefined,
      })),
    };
  }
  
  return event;
}

/**
 * Create a validating transport wrapper.
 * Wraps any AGUITransport to add validation before emission.
 * 
 * @param transport - The transport to wrap
 * @param options - Validation options
 * @returns Wrapped transport with validation
 */
export function createValidatingTransport<T extends { emit: (event: AGUIEvent) => void }>(
  transport: T,
  options: {
    /** Throw on invalid events (default: false - just log warning) */
    throwOnInvalid?: boolean;
    /** Custom logger for validation errors */
    onValidationError?: (event: AGUIEvent, error: ValidationResult['error']) => void;
  } = {}
): T {
  const { throwOnInvalid = false, onValidationError } = options;
  
  return {
    ...transport,
    emit: (event: AGUIEvent) => {
      const result = validateEvent(event);
      
      if (!result.success) {
        if (onValidationError) {
          onValidationError(event, result.error);
        } else {
          console.warn('[AG-UI Validation] Invalid event:', event.type, result.error);
        }
        
        if (throwOnInvalid) {
          throw new Error(`Invalid AG-UI event: ${result.error?.message}`);
        }
      }
      
      // Always emit (validation is advisory)
      transport.emit(event);
    },
  };
}
