/**
 * AG-UI Callback Handler
 * 
 * Handles streaming events for LLM tokens and tool calls.
 * 
 * Architecture (SPEC.md Section 2.6):
 * - Extends BaseCallbackHandler from @langchain/core/callbacks/base
 * - Internal state: Map<runId, messageId> and Map<runId, toolCallId>
 * - Fail-safe: super({ raiseError: false })
 * - Metadata propagation: Reads messageId from metadata in handleLLMStart
 * - Parent run correlation: Uses parentRunId to link tool callbacks to LLM
 * - Smart emission: Respects maxUIPayloadSize for tool results
 */

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { generateId } from "../utils/idGenerator";
import type { AGUITransport } from "../transports/types";

/**
 * Configuration options for the callback handler.
 */
export interface AGUICallbackHandlerOptions {
  /** Maximum payload size in bytes for UI events (default: 50KB) */
  maxUIPayloadSize?: number;
  /** Whether to chunk large payloads instead of truncating */
  chunkLargeResults?: boolean;
}

/**
 * Callback handler for AG-UI protocol streaming events.
 * Handles LLM token streaming and tool call lifecycle events.
 */
export class AGUICallbackHandler extends BaseCallbackHandler {
  name = "ag-ui-callback";

  // Internal state for message/tool correlation (SPEC.md Section 2.5.1)
  private messageIds = new Map<string, string>();
  private toolCallIds = new Map<string, string>();
  private transport: AGUITransport;
  
  // Smart emission configuration
  private maxUIPayloadSize: number;
  private chunkLargeResults: boolean;

  /**
   * Create a new AG-UI callback handler.
   * 
   * @param transport - Transport for emitting AG-UI events
   * @param options - Optional configuration for smart emission
   */
  constructor(transport: AGUITransport, options?: AGUICallbackHandlerOptions) {
    // Fail-safe: Never raise errors from AG-UI callbacks
    super({ raiseError: false });
    this.transport = transport;
    this.maxUIPayloadSize = options?.maxUIPayloadSize ?? 50 * 1024; // 50KB default
    this.chunkLargeResults = options?.chunkLargeResults ?? false;
  }

  /**
   * Dispose - Cleanup internal state to prevent memory leaks.
   * Called when the handler is no longer needed.
   */
  dispose(): void {
    this.messageIds.clear();
    this.toolCallIds.clear();
  }

  // ==================== LLM Callbacks ====================

  async handleLLMStart(
    llm: any,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    // Capture messageId from metadata (set by middleware)
    const messageId = metadata?.agui_messageId as string | undefined;
    if (messageId) {
      this.messageIds.set(runId, messageId);
    }
  }

  /**
   * handleLLMNewToken - Emits TEXT_MESSAGE_CONTENT and TOOL_CALL_ARGS events.
   * 
   * This is the primary mechanism for streaming tokens to the UI.
   * Also handles streaming tool call arguments from tool_call_chunks.
   */
  async handleLLMNewToken(
    token: string,
    idx: any,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    fields?: any
  ): Promise<void> {
    const messageId = this.messageIds.get(runId);
    if (!messageId) return;

    try {
      // Emit TEXT_MESSAGE_CONTENT for streaming tokens
      this.transport.emit({
        type: "TEXT_MESSAGE_CONTENT",
        messageId,
        delta: token,
      });

      // Emit TOOL_CALL_ARGS for streaming tool arguments
      // The tool call ID is directly available in the chunks
      const toolCallChunks = fields?.chunk?.message?.tool_call_chunks;
      if (toolCallChunks) {
        for (const chunk of toolCallChunks) {
          if (chunk.id) {
            this.transport.emit({
              type: "TOOL_CALL_ARGS",
              toolCallId: chunk.id,
              delta: chunk.args,
            });
          }
        }
      }
    } catch {
      // Fail-safe: Transport errors never crash agent execution
    }
  }

  /**
   * handleLLMEnd - Cleanup messageId from internal state.
   */
  async handleLLMEnd(
    output: any,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> {
    // Cleanup messageId to prevent memory leaks
    this.messageIds.delete(runId);
  }

  /**
   * handleLLMError - Cleanup messageId on error.
   */
  async handleLLMError(error: Error, runId: string): Promise<void> {
    // Cleanup on error to prevent memory leaks
    this.messageIds.delete(runId);
  }

  // ==================== Tool Callbacks ====================

  /**
   * handleToolStart - Emits TOOL_CALL_START event.
   * 
   * Extracts toolCallId from the stringified ToolCall input.
   * Links to parent message via parentRunId.
   */
  async handleToolStart(
    tool: any,
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    // Extract toolCallId from stringified ToolCall input
    // Input format: {"id":"...","name":"...","args":{...}}
    let toolCallId: string | undefined;
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && "id" in parsed) {
        toolCallId = parsed.id;
      }
    } catch {
      toolCallId = undefined;
    }

    // Store for handleToolEnd
    if (toolCallId) {
      this.toolCallIds.set(runId, toolCallId);
    }

    // Retrieve parent messageId using parentRunId
    const messageId = this.messageIds.get(parentRunId || "") || undefined;

    try {
      // Emit TOOL_CALL_START
      this.transport.emit({
        type: "TOOL_CALL_START",
        toolCallId: toolCallId || runId,
        toolCallName: tool.name,
        parentMessageId: messageId,
      });
    } catch {
      // Fail-safe
    }
  }

  /**
   * handleToolEnd - Emits TOOL_CALL_END and TOOL_CALL_RESULT events.
   * 
   * Retrieves toolCallId from internal state and links to parent message.
   * Applies smart emission policy for large payloads (SPEC.md Section 9.3).
   */
  async handleToolEnd(
    output: string,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> {
    const toolCallId = this.toolCallIds.get(runId);
    this.toolCallIds.delete(runId);

    // Retrieve parent messageId via parentRunId
    const messageId = this.messageIds.get(parentRunId || "") || undefined;

    try {
      // Emit TOOL_CALL_END
      this.transport.emit({
        type: "TOOL_CALL_END",
        toolCallId: toolCallId || runId,
        parentMessageId: messageId,
      });

       // Apply smart emission policy for tool result (SPEC.md Section 9.3)
       // Emit TOOL_CALL_RESULT or TOOL_CALL_CHUNK events based on policy
       this.emitToolResultWithPolicy(output, toolCallId || runId, messageId);
    } catch {
      // Fail-safe
    }
  }

  /**
   * handleToolError - Cleanup toolCallId on error.
   */
  async handleToolError(error: Error, runId: string): Promise<void> {
    // Cleanup on error to prevent memory leaks
    this.toolCallIds.delete(runId);
  }

  // ==================== Smart Emission ====================

  /**
   * Split a string into chunks of specified maximum byte size.
   * Attempts to split at word boundaries when possible.
   */
  private chunkString(content: string, maxChunkSize: number): string[] {
    const chunks: string[] = [];
    let remaining = content;
    
    while (remaining.length > 0) {
      // If the remaining content fits in one chunk, add it and break
      if (new Blob([remaining]).size <= maxChunkSize) {
        chunks.push(remaining);
        break;
      }
      
      // Try to find a good split point (prefer word boundaries)
      let splitPoint = maxChunkSize;
      
      // Try to split at a word boundary near the max size
      const spaceIndex = remaining.lastIndexOf(' ', maxChunkSize);
      const newlineIndex = remaining.lastIndexOf('\n', maxChunkSize);
      const boundaryIndex = Math.max(spaceIndex, newlineIndex);
      
      if (boundaryIndex > maxChunkSize * 0.5) {
        // Found a reasonable word boundary, split there
        splitPoint = boundaryIndex;
      } else {
        // No good word boundary, split at max size (may split in middle of word)
        // But ensure we don't split a multi-byte character
        while (splitPoint > 0 && remaining.charCodeAt(splitPoint - 1) > 127) {
          splitPoint--;
        }
        if (splitPoint === 0) {
          // Force split at max size if no valid character boundary found
          splitPoint = maxChunkSize;
        }
      }
      
      chunks.push(remaining.substring(0, splitPoint));
      remaining = remaining.substring(splitPoint).trim();
    }
    
    return chunks;
  }

  /**
   * Emit tool result with smart emission policy (chunking or truncation).
   * Returns true if chunks were emitted, false if single result was emitted.
   */
  private emitToolResultWithPolicy(
    output: string,
    toolCallId: string,
    messageId: string | undefined
  ): boolean {
    // Get content as string
    let content = typeof output === "string" ? output : JSON.stringify(output);
    
    // Generate messageId if not provided (for standalone tool calls)
    const resultMessageId = messageId || generateId();
    
    // Check if content exceeds max payload size
    const contentSize = new Blob([content]).size;
    
    if (contentSize <= this.maxUIPayloadSize) {
      // Content is within limits - emit single result
      this.transport.emit({
        type: "TOOL_CALL_RESULT",
        messageId: resultMessageId,
        toolCallId,
        parentMessageId: messageId,
        content,
        role: "tool",
      });
      return false;
    }
    
    // Content exceeds limits - apply policy
    if (this.chunkLargeResults) {
      // Emit TOOL_CALL_CHUNK events for each chunk
      const chunks = this.chunkString(content, this.maxUIPayloadSize);
      for (let i = 0; i < chunks.length; i++) {
        this.transport.emit({
          type: "TOOL_CALL_CHUNK",
          toolCallId,
          chunk: chunks[i],
          index: i,
          parentMessageId: messageId,
        });
      }
      return true;
    }
    
    // Truncate content to fit within max payload
    const truncationMessage = `[Truncated: ${contentSize - this.maxUIPayloadSize + 50} bytes]`;
    const availableSpace = this.maxUIPayloadSize - truncationMessage.length;
    const truncatedContent = content.substring(0, availableSpace) + truncationMessage;
    
    this.transport.emit({
      type: "TOOL_CALL_RESULT",
      messageId: resultMessageId,
      toolCallId,
      parentMessageId: messageId,
      content: truncatedContent,
      role: "tool",
    });
    
    return false;
  }

  /**
   * Process tool result according to smart emission policy.
   * @deprecated Use emitToolResultWithPolicy instead for proper chunking support
   */
  private processToolResult(output: string): string {
    // Get content as string
    let content = typeof output === "string" ? output : JSON.stringify(output);
    
    // Check if content exceeds max payload size
    const contentSize = new Blob([content]).size;
    
    if (contentSize <= this.maxUIPayloadSize) {
      // Content is within limits - return as-is
      return content;
    }
    
    // Content exceeds limits - apply policy
    if (this.chunkLargeResults) {
      // TODO: Implement chunking if needed in future
      // For now, fall back to truncation
    }
    
    // Truncate content to fit within max payload
    // Leave room for truncation message: "[Truncated: X bytes]"
    const truncationMessage = `[Truncated: ${contentSize - this.maxUIPayloadSize + 50} bytes]`;
    const availableSpace = this.maxUIPayloadSize - truncationMessage.length;
    
    return content.substring(0, availableSpace) + truncationMessage;
  }
}
