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

  /**
   * handleLLMStart - Captures messageId from metadata.
   * 
   * The middleware stores messageId in runtime.config.metadata.agui_messageId,
   * which is propagated to callbacks via the metadata parameter.
   */
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
      const processedContent = this.processToolResult(output);

      // Emit TOOL_CALL_RESULT with the tool output
      this.transport.emit({
        type: "TOOL_CALL_RESULT",
        messageId: generateId(),
        toolCallId: toolCallId || runId,
        parentMessageId: messageId,
        content: processedContent,
        role: "tool",
      });
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
   * Process tool result according to smart emission policy.
   * Applies truncation or chunking for large payloads.
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
