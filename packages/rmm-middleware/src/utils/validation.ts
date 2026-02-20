import type { StoredMessage } from "@langchain/core/messages";
import { z } from "zod";
import { getLogger } from "@/utils/logger";

const logger = getLogger("validation");

/**
 * Message buffer interface for persisted storage.
 * Uses StoredMessage[] to support both string and ContentBlock[] content (LangChain v1).
 */
export interface MessageBuffer {
  messages: StoredMessage[];
  humanMessageCount: number;
  lastMessageTimestamp: number;
  createdAt: number;
  retryCount?: number;
}

// ============================================================================
// ContentBlock Zod Schemas (Strict - matches LangChain's ContentBlock types)
// Based on: langchain-core/src/messages/content/index.ts
// ============================================================================

const ContentBlockCitationSchema = z.object({
  type: z.literal("citation"),
  source: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  startIndex: z.number().optional(),
  endIndex: z.number().optional(),
  citedText: z.string().optional(),
});

const ContentBlockTextSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  index: z.number().optional(),
  annotations: z.array(z.record(z.string(), z.unknown())).optional(),
});

const ContentBlockReasoningSchema = z.object({
  type: z.literal("reasoning"),
  reasoning: z.string(),
  index: z.number().optional(),
});

const ContentBlockToolSchema = z.object({
  type: z.literal("tool"),
  id: z.string(),
  input: z.record(z.string(), z.unknown()).optional(),
  index: z.number().optional(),
});

const ContentBlockToolCallChunkSchema = z.object({
  type: z.literal("tool_call_chunk"),
  index: z.number().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  args: z.string().optional(),
});

const ContentBlockToolCallSchema = z.object({
  type: z.literal("tool_call"),
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  index: z.number().optional(),
});

const ContentBlockImageSchema = z.object({
  type: z.literal("image"),
  source: z
    .object({
      type: z.literal("base64"),
      media_type: z.string(),
      data: z.string(),
    })
    .or(
      z.object({
        type: z.literal("url"),
        url: z.string(),
      })
    ),
  index: z.number().optional(),
});

const ContentBlockImageURLSchema = z.object({
  type: z.literal("image_url"),
  image_url: z.object({
    url: z.string().or(z.object({ url: z.string() })),
  }),
  index: z.number().optional(),
});

const ContentBlockDataSchema = z.object({
  type: z.literal("data"),
  data: z.record(z.string(), z.unknown()),
  index: z.number().optional(),
});

/**
 * Discriminated union of all ContentBlock types.
 * Strict validation matching LangChain's ContentBlock union.
 */
const ContentBlockSchema = z.discriminatedUnion("type", [
  ContentBlockTextSchema,
  ContentBlockReasoningSchema,
  ContentBlockCitationSchema,
  ContentBlockToolSchema,
  ContentBlockToolCallChunkSchema,
  ContentBlockToolCallSchema,
  ContentBlockImageSchema,
  ContentBlockImageURLSchema,
  ContentBlockDataSchema,
]);

// ============================================================================
// StoredMessage Zod Schemas
// ============================================================================

/**
 * Schema for StoredMessageData - matches LangChain's StoredMessageData interface exactly.
 * Supports both string content and ContentBlock[] (LangChain v1 format).
 */
const StoredMessageDataSchema = z.object({
  content: z.union([z.string(), z.array(ContentBlockSchema)]),
  role: z.string().optional(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  additional_kwargs: z.record(z.string(), z.unknown()).optional(),
  response_metadata: z.record(z.string(), z.unknown()).optional(),
  id: z.string().optional(),
});

/**
 * Schema for StoredMessage - matches LangChain's StoredMessage interface exactly.
 */
const StoredMessageSchema = z.object({
  type: z.string(),
  data: StoredMessageDataSchema.optional(),
});

/**
 * Transform Zod output to match LangChain's StoredMessage type exactly.
 * Ensures optional fields that are undefined stay undefined (not absent).
 */
function transformToStoredMessage(
  data: z.infer<typeof StoredMessageSchema>
): StoredMessage {
  return {
    type: data.type,
    data: data.data
      ? {
          content: data.data.content,
          role: data.data.role,
          name: data.data.name,
          tool_call_id: data.data.tool_call_id,
          additional_kwargs: data.data.additional_kwargs,
          response_metadata: data.data.response_metadata,
          id: data.data.id,
        }
      : undefined,
  };
}

/**
 * Schema for MessageBuffer persisted in BaseStore
 */
export const MessageBufferSchema = z.object({
  messages: z.array(StoredMessageSchema),
  humanMessageCount: z.number().int().nonnegative(),
  lastMessageTimestamp: z.number().int().positive(),
  createdAt: z.number().int().positive(),
  retryCount: z.number().int().nonnegative().optional(),
});

/**
 * Validates a value as a StoredMessage using Zod.
 * Throws descriptive error on validation failure.
 *
 * @param value - Value to validate
 * @returns Valid StoredMessage (transformed to match LangChain type exactly)
 * @throws Error if validation fails
 */
export function parseStoredMessage(value: unknown): StoredMessage {
  const result = StoredMessageSchema.safeParse(value);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid StoredMessage: ${errors}`);
  }
  return transformToStoredMessage(result.data);
}

/**
 * Validates an array as StoredMessage[] using Zod.
 * Throws descriptive error on validation failure.
 *
 * @param value - Value to validate (should be array)
 * @returns Valid StoredMessage[]
 * @throws Error if validation fails
 */
export function parseStoredMessages(value: unknown): StoredMessage[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected array of messages, got ${typeof value}`);
  }
  return value.map((item, idx) => {
    try {
      return parseStoredMessage(item);
    } catch (e) {
      throw new Error(
        `Invalid message at index ${idx}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  });
}

/**
 * Validates a value as MessageBuffer using Zod.
 * Throws descriptive error on validation failure.
 *
 * @param value - Value to validate
 * @returns Valid MessageBuffer with transformed StoredMessage[]
 * @throws Error if validation fails
 */
export function parseMessageBuffer(value: unknown): MessageBuffer {
  const result = MessageBufferSchema.safeParse(value);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    logger.warn(`Buffer validation failed: ${errors}`);
    throw new Error(`Invalid MessageBuffer: ${errors}`);
  }
  // Transform messages to match LangChain's StoredMessage type
  return {
    messages: result.data.messages.map(transformToStoredMessage),
    humanMessageCount: result.data.humanMessageCount,
    lastMessageTimestamp: result.data.lastMessageTimestamp,
    createdAt: result.data.createdAt,
    retryCount: result.data.retryCount,
  };
}
