/**
 * AG-UI Type Aliases and Re-exports
 * 
 * This module provides type imports from @ag-ui/core for validation purposes.
 * The main event types are defined in ../events/index.ts for backward compatibility.
 * 
 * Usage for validation:
 *   import { EventSchemas, validateEvent } from './types/ag-ui';
 */

// ============================================================================
// Re-exports from @ag-ui/core for validation
// ============================================================================

export {
  // Event type enum
  EventType,
  
  // Zod schemas for validation (use for runtime validation only)
  EventSchemas,
  MessageSchema,
  ToolCallSchema,
  ToolSchema,
  ContextSchema,
  RunAgentInputSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  SystemMessageSchema,
  ToolMessageSchema,
  DeveloperMessageSchema,
  ActivityMessageSchema,
  RunStartedEventSchema,
  RunFinishedEventSchema,
  RunErrorEventSchema,
  StepStartedEventSchema,
  StepFinishedEventSchema,
  TextMessageStartEventSchema,
  TextMessageContentEventSchema,
  TextMessageEndEventSchema,
  TextMessageChunkEventSchema,
  ToolCallStartEventSchema,
  ToolCallArgsEventSchema,
  ToolCallEndEventSchema,
  ToolCallResultEventSchema,
  ToolCallChunkEventSchema,
  StateSnapshotEventSchema,
  StateDeltaEventSchema,
  MessagesSnapshotEventSchema,
  ThinkingStartEventSchema,
  ThinkingEndEventSchema,
  ThinkingTextMessageStartEventSchema,
  ThinkingTextMessageContentEventSchema,
  ThinkingTextMessageEndEventSchema,
  ActivitySnapshotEventSchema,
  ActivityDeltaEventSchema,
  RawEventSchema,
  CustomEventSchema,
  BaseEventSchema,
} from '@ag-ui/core';

// ============================================================================
// Re-export protobuf utilities from @ag-ui/proto
// ============================================================================

export {
  encode as encodeProtobuf,
  decode as decodeProtobuf,
  AGUI_MEDIA_TYPE,
} from '@ag-ui/proto';
