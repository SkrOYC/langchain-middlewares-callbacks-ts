/**
 * Core Zod Schemas for Open Responses Protocol
 *
 * Implements the spec-minimal MVP schemas defined in TechSpec.md sections 4.1-4.3
 * These schemas validate requests, responses, and streaming events.
 */

import { z } from "zod";

const jsonValuesMatch = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => jsonValuesMatch(value, right[index]));
  }

  if (
    typeof left === "object" &&
    left !== null &&
    typeof right === "object" &&
    right !== null
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();

    if (!jsonValuesMatch(leftKeys, rightKeys)) {
      return false;
    }

    return leftKeys.every((key) =>
      jsonValuesMatch(leftRecord[key], rightRecord[key])
    );
  }

  return false;
};

// =============================================================================
// Metadata Schema
// =============================================================================

export const MetadataSchema = z
  .record(z.string(), z.string())
  .superRefine((value, ctx) => {
    const keys = Object.keys(value);
    if (keys.length > 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "metadata supports at most 16 pairs",
      });
    }
    for (const key of keys) {
      if (key.length > 64) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `metadata key too long: ${key}`,
        });
      }
      if ((value[key] ?? "").length > 512) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `metadata value too long: ${key}`,
        });
      }
    }
  });

// =============================================================================
// Input Content Part Schemas
// =============================================================================

export const InputTextPartSchema = z.object({
  type: z.literal("input_text"),
  text: z.string().min(1),
});

export const InputImagePartSchema = z.object({
  type: z.literal("input_image"),
  image_url: z.string(),
  detail: z.enum(["low", "high", "auto"]).default("auto"),
});

export const InputFilePartSchema = z.object({
  type: z.literal("input_file"),
  filename: z.string().optional(),
  file_data: z.string().optional(),
  file_url: z.string().optional(),
});

export const InputContentPartSchema = z.union([
  InputTextPartSchema,
  InputImagePartSchema,
  InputFilePartSchema,
]);

// =============================================================================
// Output Content Part Schemas
// =============================================================================

export const OutputTextPartSchema = z.object({
  type: z.literal("output_text"),
  text: z.string(),
  annotations: z.array(z.record(z.string(), z.unknown())).default([]),
});

export const RefusalContentSchema = z.object({
  type: z.literal("refusal"),
  refusal: z.string(),
});

// =============================================================================
// Message Item Schemas (Role-specific)
// =============================================================================

// System and Developer: text-only content
export const SystemMessageItemSchema = z.object({
  type: z.literal("message"),
  role: z.literal("system"),
  content: z.union([z.string(), z.array(InputTextPartSchema)]),
});

export const DeveloperMessageItemSchema = z.object({
  type: z.literal("message"),
  role: z.literal("developer"),
  content: z.union([z.string(), z.array(InputTextPartSchema)]),
});

// User: supports text, image, and file content
export const UserMessageItemSchema = z.object({
  type: z.literal("message"),
  role: z.literal("user"),
  content: z.union([
    z.string(),
    z.array(
      z.union([InputTextPartSchema, InputImagePartSchema, InputFilePartSchema])
    ),
  ]),
});

// Assistant: supports output_text and refusal content
export const AssistantMessageItemSchema = z.object({
  type: z.literal("message"),
  role: z.literal("assistant"),
  content: z.union([
    z.string(),
    z.array(z.union([OutputTextPartSchema, RefusalContentSchema])),
  ]),
});

// Union of all message item types
export const MessageItemSchema = z.union([
  SystemMessageItemSchema,
  DeveloperMessageItemSchema,
  UserMessageItemSchema,
  AssistantMessageItemSchema,
]);

// =============================================================================
// Function Call Input Item Schemas
// =============================================================================

export const FunctionCallInputItemSchema = z.object({
  type: z.literal("function_call"),
  call_id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string(),
  status: z.enum(["in_progress", "completed", "incomplete"]).optional(),
});

export const FunctionCallOutputInputItemSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string().min(1),
  output: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
  status: z.enum(["in_progress", "completed", "incomplete"]).optional(),
});

// =============================================================================
// Input Item Schema (Union)
// =============================================================================

export const InputItemSchema = z.union([
  MessageItemSchema,
  FunctionCallInputItemSchema,
  FunctionCallOutputInputItemSchema,
]);

// =============================================================================
// Tool Schemas
// =============================================================================

export const FunctionToolSchema = z.object({
  type: z.literal("function"),
  name: z.string().min(1).max(64),
  description: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
  strict: z.boolean().default(true),
});

export const AllowedToolsChoiceSchema = z.object({
  type: z.literal("allowed_tools"),
  tools: z
    .array(z.object({ type: z.literal("function"), name: z.string().min(1) }))
    .min(1),
  mode: z.enum(["auto", "none", "required"]).optional(),
});

export const ToolChoiceSchema = z.union([
  z.literal("auto"),
  z.literal("none"),
  z.literal("required"),
  z.object({ type: z.literal("function"), name: z.string().min(1) }),
  AllowedToolsChoiceSchema,
]);

// =============================================================================
// Request Schema
// =============================================================================

export const OpenResponsesRequestSchema = z.object({
  model: z.string().min(1),
  input: z.union([z.string().min(1), z.array(InputItemSchema)]),
  previous_response_id: z.string().min(1).optional(),
  tools: z.array(FunctionToolSchema).default([]),
  tool_choice: ToolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().default(true),
  stream: z.boolean().default(false),
  metadata: MetadataSchema.default({}),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_output_tokens: z.number().int().positive().optional(),
  text: z.record(z.string(), z.unknown()).optional(),
  reasoning: z.record(z.string(), z.unknown()).optional(),
});

// =============================================================================
// Output Item Schemas
// =============================================================================

export const FunctionCallItemSchema = z.object({
  id: z.string().min(1),
  type: z.literal("function_call"),
  status: z.enum(["in_progress", "incomplete", "completed"]),
  name: z.string().min(1),
  call_id: z.string().min(1),
  arguments: z.string(),
});

export const MessageOutputItemSchema = z.object({
  id: z.string().min(1),
  type: z.literal("message"),
  role: z.literal("assistant"),
  status: z.enum(["in_progress", "incomplete", "completed"]),
  content: z.array(OutputTextPartSchema),
});

export const OutputItemSchema = z.union([
  MessageOutputItemSchema,
  FunctionCallItemSchema,
]);

// =============================================================================
// Error Schema
// =============================================================================

export const ErrorObjectSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  param: z.string().nullable().optional(),
  type: z.enum([
    "server_error",
    "invalid_request_error",
    "not_found",
    "model_error",
    "too_many_requests",
  ]),
});

/**
 * Error schema aligned with official Open Responses specification.
 * Note: The spec uses "invalid_request_error" (with _error suffix), while the reference
 * documentation shows a simpler error shape. We follow the spec for compliance.
 */

// =============================================================================
// Response Schema
// =============================================================================

export const OpenResponsesResponseSchema = z.object({
  id: z.string().min(1),
  object: z.literal("response"),
  created_at: z.number().int().nonnegative(),
  completed_at: z.number().int().nonnegative().nullable(),
  status: z.enum([
    "queued",
    "in_progress",
    "completed",
    "failed",
    "incomplete",
  ]),
  model: z.string().min(1),
  previous_response_id: z.string().nullable(),
  output: z.array(OutputItemSchema),
  error: ErrorObjectSchema.nullable(),
  metadata: MetadataSchema.default({}),
});

export const StoredResponseRequestSchema = z.object({
  model: z.string().min(1),
  input: z.array(InputItemSchema),
  metadata: MetadataSchema.default({}),
  tools: z.array(FunctionToolSchema),
  tool_choice: ToolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean(),
});

export const StoredResponseRecordSchema = z
  .object({
    response_id: z.string().min(1),
    created_at: z.number().int().nonnegative(),
    completed_at: z.number().int().nonnegative().nullable(),
    model: z.string().min(1),
    request: StoredResponseRequestSchema,
    response: OpenResponsesResponseSchema,
    status: z.enum(["completed", "failed", "incomplete"]),
    error: ErrorObjectSchema.nullable(),
  })
  .superRefine((record, ctx) => {
    const addIssue = (path: Array<string | number>, message: string) => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message,
        path,
      });
    };

    if (
      !["completed", "failed", "incomplete"].includes(record.response.status)
    ) {
      addIssue(
        ["response", "status"],
        "stored response must reference a terminal response resource"
      );
    }

    if (record.response_id !== record.response.id) {
      addIssue(["response_id"], "response_id must match response.id");
    }

    if (record.created_at !== record.response.created_at) {
      addIssue(["created_at"], "created_at must match response.created_at");
    }

    if (record.completed_at !== record.response.completed_at) {
      addIssue(
        ["completed_at"],
        "completed_at must match response.completed_at"
      );
    }

    if (record.model !== record.response.model) {
      addIssue(["model"], "model must match response.model");
    }

    if (record.request.model !== record.model) {
      addIssue(["request", "model"], "request.model must match model");
    }

    if (record.status !== record.response.status) {
      addIssue(["status"], "status must match response.status");
    }

    if (!jsonValuesMatch(record.error, record.response.error)) {
      addIssue(["error"], "error must match response.error");
    }
  });

// =============================================================================
// Streaming Event Schemas
// =============================================================================

export const ResponseInProgressEventSchema = z.object({
  type: z.literal("response.in_progress"),
  sequence_number: z.number().int().positive(),
  response: z.object({
    id: z.string(),
    object: z.literal("response"),
    status: z.literal("in_progress"),
  }),
});

export const OutputItemAddedEventSchema = z.object({
  type: z.literal("response.output_item.added"),
  sequence_number: z.number().int().positive(),
  output_index: z.number().int().nonnegative(),
  item: OutputItemSchema,
});

export const ContentPartAddedEventSchema = z.object({
  type: z.literal("response.content_part.added"),
  sequence_number: z.number().int().positive(),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  part: OutputTextPartSchema,
});

export const OutputTextDeltaEventSchema = z.object({
  type: z.literal("response.output_text.delta"),
  sequence_number: z.number().int().positive(),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  delta: z.string(),
});

export const OutputTextDoneEventSchema = z.object({
  type: z.literal("response.output_text.done"),
  sequence_number: z.number().int().positive(),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  text: z.string(),
});

export const ContentPartDoneEventSchema = z.object({
  type: z.literal("response.content_part.done"),
  sequence_number: z.number().int().positive(),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  part: OutputTextPartSchema,
});

export const OutputItemDoneEventSchema = z.object({
  type: z.literal("response.output_item.done"),
  sequence_number: z.number().int().positive(),
  output_index: z.number().int().nonnegative(),
  item: OutputItemSchema,
});

export const FunctionCallArgumentsDeltaEventSchema = z.object({
  type: z.literal("response.function_call_arguments.delta"),
  sequence_number: z.number().int().positive(),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  delta: z.string(),
});

export const FunctionCallArgumentsDoneEventSchema = z.object({
  type: z.literal("response.function_call_arguments.done"),
  sequence_number: z.number().int().positive(),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  arguments: z.string(),
});

export const ResponseCompletedEventSchema = z.object({
  type: z.literal("response.completed"),
  sequence_number: z.number().int().positive(),
  response: z.object({
    id: z.string(),
    object: z.literal("response"),
    status: z.literal("completed"),
  }),
});

export const ResponseFailedEventSchema = z.object({
  type: z.literal("response.failed"),
  sequence_number: z.number().int().positive(),
  response: z.object({
    id: z.string(),
    object: z.literal("response"),
    status: z.literal("failed"),
  }),
  error: ErrorObjectSchema,
});

// =============================================================================
// Union of All Events
// =============================================================================

export const OpenResponsesEventSchema = z.union([
  ResponseInProgressEventSchema,
  OutputItemAddedEventSchema,
  ContentPartAddedEventSchema,
  OutputTextDeltaEventSchema,
  OutputTextDoneEventSchema,
  ContentPartDoneEventSchema,
  OutputItemDoneEventSchema,
  FunctionCallArgumentsDeltaEventSchema,
  FunctionCallArgumentsDoneEventSchema,
  ResponseCompletedEventSchema,
  ResponseFailedEventSchema,
]);

// =============================================================================
// TypeScript Type Exports
// =============================================================================

// Request/Response types
export type OpenResponsesRequest = z.infer<typeof OpenResponsesRequestSchema>;
export type OpenResponsesResponse = z.infer<typeof OpenResponsesResponseSchema>;
export type StoredResponseRequest = z.infer<typeof StoredResponseRequestSchema>;
export type StoredResponseRecordShape = z.infer<
  typeof StoredResponseRecordSchema
>;

// Input types
export type InputTextPart = z.infer<typeof InputTextPartSchema>;
export type InputImagePart = z.infer<typeof InputImagePartSchema>;
export type InputFilePart = z.infer<typeof InputFilePartSchema>;
export type InputContentPart = z.infer<typeof InputContentPartSchema>;

// Output types
export type OutputTextPart = z.infer<typeof OutputTextPartSchema>;
export type RefusalContent = z.infer<typeof RefusalContentSchema>;

// Message types
export type SystemMessageItem = z.infer<typeof SystemMessageItemSchema>;
export type DeveloperMessageItem = z.infer<typeof DeveloperMessageItemSchema>;
export type UserMessageItem = z.infer<typeof UserMessageItemSchema>;
export type AssistantMessageItem = z.infer<typeof AssistantMessageItemSchema>;
export type MessageItem = z.infer<typeof MessageItemSchema>;

// Function call types
export type FunctionCallInputItem = z.infer<typeof FunctionCallInputItemSchema>;
export type FunctionCallOutputInputItem = z.infer<
  typeof FunctionCallOutputInputItemSchema
>;
export type InputItem = z.infer<typeof InputItemSchema>;

// Output item types
export type FunctionCallItem = z.infer<typeof FunctionCallItemSchema>;
export type MessageOutputItem = z.infer<typeof MessageOutputItemSchema>;
export type OutputItem = z.infer<typeof OutputItemSchema>;

// Tool types
export type FunctionTool = z.infer<typeof FunctionToolSchema>;
export type AllowedToolsChoice = z.infer<typeof AllowedToolsChoiceSchema>;
export type ToolChoice = z.infer<typeof ToolChoiceSchema>;

// Error types
export type ErrorObject = z.infer<typeof ErrorObjectSchema>;

// Streaming event types
export type OpenResponsesEvent = z.infer<typeof OpenResponsesEventSchema>;
export type OpenResponsesStreamChunk = OpenResponsesEvent | "[DONE]";

// Metadata
export type Metadata = z.infer<typeof MetadataSchema>;
