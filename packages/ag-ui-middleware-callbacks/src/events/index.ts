/**
 * AG-UI Protocol Event Types
 *
 * This module re-exports types from @ag-ui/core for AG-UI protocol events.
 * 
 * Package scope: Emit AG-UI events as JavaScript objects.
 * Use @ag-ui/core for event type definitions directly.
 * 
 * @see https://docs.ag-ui.com/introduction
 * @packageDocumentation
 */

// ============================================================================
// Re-export @ag-ui/core types and schemas
// ============================================================================

export {
  EventType,
  EventSchemas,
  MessageSchema,
  ToolCallSchema,
} from '@ag-ui/core';

// Re-export event and message types for convenience
export type { 
  BaseEvent,
  Message,
  ToolCall,
  Role,
} from '@ag-ui/core';
