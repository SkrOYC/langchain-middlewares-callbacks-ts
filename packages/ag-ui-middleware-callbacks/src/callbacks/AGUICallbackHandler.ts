/**
 * AG-UI Callback Handler
 * 
 * Handles streaming events for LLM tokens and tool calls.
 */

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseMessage } from "@langchain/core/messages";
import { generateId, generateDeterministicId } from "../utils/idGenerator";
import { extractToolOutput } from "../utils/cleaner";
import { expandEvent } from "../utils/eventNormalizer";
import { type BaseEvent, EventType } from "@ag-ui/core";
import {
  extractReasoningBlocks,
  groupReasoningBlocksByIndex,
} from "../utils/reasoningBlocks";

/**
 * Configuration options for the callback handler.
 */
export interface AGUICallbackHandlerOptions {
  /** Callback function for emitting AG-UI events */
  onEvent: (event: BaseEvent) => void;
  /** Master toggle - when false, no events are emitted (default: true) */
  enabled?: boolean;
  /** Emit TEXT_MESSAGE events: START, CONTENT, END (default: true) */
  emitTextMessages?: boolean;
  /** Emit TOOL_CALL events: START, ARGS, END, RESULT (default: true) */
  emitToolCalls?: boolean;
  /** Emit THINKING events: START, TEXT_MESSAGE_*, END (default: true) */
  emitThinking?: boolean;
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

  private messageIds = new Map<string, string>();
  private latestMessageIds = new Map<string, string>();
  private agentRunIds = new Map<string, string>(); // Maps current runId to authoritative agentRunId
  private parentToAuthoritativeId = new Map<string, string>(); // Maps internal parentRunId to authoritative agentRunId
  private toolCallInfo = new Map<string, { id: string; name: string }>();
  private toolCallNames = new Map<string, string>(); // Maps toolCallId to tool name from LLM tool_calls
  private agentTurnTracker = new Map<string, number>();
  private pendingToolCalls = new Map<string, string[]>();
  private accumulatedToolArgs = new Map<string, string>(); // Accumulates partial args for streaming tool calls
  private emitCallback: (event: BaseEvent) => void;

  private _enabled: boolean;
  private _emitTextMessages: boolean;
  private _emitToolCalls: boolean;
  private _emitThinking: boolean;

  private maxUIPayloadSize: number;
  private chunkLargeResults: boolean;

  constructor(options: AGUICallbackHandlerOptions) {
    super({ raiseError: false });
    this.emitCallback = options.onEvent;
    this._enabled = options?.enabled ?? true;
    this._emitTextMessages = options?.emitTextMessages ?? true;
    this._emitToolCalls = options?.emitToolCalls ?? true;
    this._emitThinking = options?.emitThinking ?? true;
    this.maxUIPayloadSize = options?.maxUIPayloadSize ?? 50 * 1024;
    this.chunkLargeResults = options?.chunkLargeResults ?? false;
  }

  // ==================== Public Accessors for Runtime Toggle ====================

  /** Master toggle - when false, no events are emitted */
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
  }

  /** Control TEXT_MESSAGE event emission */
  get emitTextMessages(): boolean {
    return this._emitTextMessages;
  }

  set emitTextMessages(value: boolean) {
    this._emitTextMessages = value;
  }

  /** Control TOOL_CALL event emission */
  get emitToolCalls(): boolean {
    return this._emitToolCalls;
  }

  set emitToolCalls(value: boolean) {
    this._emitToolCalls = value;
  }

  /** Control THINKING event emission */
  get emitThinking(): boolean {
    return this._emitThinking;
  }

  set emitThinking(value: boolean) {
    this._emitThinking = value;
  }

  dispose(): void {
    this.messageIds.clear();
    this.latestMessageIds.clear();
    this.agentRunIds.clear();
    this.parentToAuthoritativeId.clear();
    this.toolCallInfo.clear();
    this.toolCallNames.clear();
    this.agentTurnTracker.clear();
    this.pendingToolCalls.clear();
    this.accumulatedToolArgs.clear();
  }

  // ==================== Convenience Methods for Chunk Events ====================

  /**
   * Emit a TEXT_MESSAGE_CHUNK event (convenience method)
   * Auto-expands to START → CONTENT → END lifecycle
   * 
   * Use this for simple cases where you have the complete message at once
   * instead of handling the streaming lifecycle manually.
   * 
   * @param messageId - Unique message identifier (auto-generated if not provided)
   * @param role - Message role (defaults to "assistant")
   * @param delta - Text content to emit
   */
  async emitTextChunk(
    messageId: string,
    role: "assistant" | "user" | "system" | "developer" = "assistant",
    delta: string
  ): Promise<void> {
    if (!this.enabled || !this.emitTextMessages) return;

    const events = expandEvent({
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId,
      role,
      delta,
    } as BaseEvent);
    
    for (const event of events) {
      this.emitCallback(event);
    }
  }

  /**
   * Emit a TOOL_CALL_CHUNK event (convenience method)
   * Auto-expands to START → ARGS → END lifecycle
   * 
   * Use this for simple tool calls where you have the complete arguments at once
   * instead of handling the streaming lifecycle manually.
   * 
   * @param toolCallId - Unique tool call identifier (auto-generated if not provided)
   * @param toolCallName - Name of the tool being called
   * @param delta - Tool arguments (JSON string)
   * @param parentMessageId - ID of the message that triggered this tool call
   */
  async emitToolChunk(
    toolCallId: string,
    toolCallName: string,
    delta: string,
    parentMessageId?: string
  ): Promise<void> {
    if (!this.enabled || !this.emitToolCalls) return;

    const events = expandEvent({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName,
      delta,
      parentMessageId,
    } as BaseEvent);
    
    for (const event of events) {
      this.emitCallback(event);
    }
  }

  // ==================== LLM Callbacks ====================

  override async handleLLMStart(
    _llm: any,
    _prompts: string[],
    runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    _runName?: string
  ): Promise<void> {
    if (!this.enabled || !this.emitTextMessages) return;

    // Priority: metadata.agui_messageId (from middleware) > metadata.run_id > parentRunId > runId
    const agentRunId =
      ((_metadata as any)?.agui_runId as string | undefined) ||
      ((_metadata as any)?.run_id as string | undefined) ||
      ((_metadata as any)?.configurable?.run_id as string | undefined) ||
      _parentRunId ||
      runId;

    this.agentRunIds.set(runId, agentRunId);
    if (_parentRunId) {
      this.parentToAuthoritativeId.set(_parentRunId, agentRunId);
    }

    // Check if middleware sent us a messageId via metadata
    const middlewareMessageId = (_metadata as any)?.agui_messageId as string | undefined;
    
    if (middlewareMessageId) {
      // Use middleware's messageId for coordination
      this.messageIds.set(runId, middlewareMessageId);
      this.latestMessageIds.set(agentRunId, middlewareMessageId);
      
      // Emit TEXT_MESSAGE_START (coordination with middleware)
      this.emitCallback({
        type: EventType.TEXT_MESSAGE_START,
        messageId: middlewareMessageId,
        role: "assistant",
        timestamp: Date.now(),
      } as BaseEvent);
    } else {
      // Generate our own messageId if middleware didn't provide one
      const turnIndex = this.agentTurnTracker.get(agentRunId) || 0;
      this.agentTurnTracker.set(agentRunId, turnIndex + 1);

      const messageId = generateDeterministicId(agentRunId, turnIndex);
      this.messageIds.set(runId, messageId);
      this.latestMessageIds.set(agentRunId, messageId);
      
      // Emit TEXT_MESSAGE_START (no middleware coordination)
      this.emitCallback({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
        timestamp: Date.now(),
      } as BaseEvent);
    }
  }

  override async handleLLMNewToken(
    token: string,
    _idx: any,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    fields?: any
  ): Promise<void> {
    if (!this.enabled) return;

    const messageId = this.messageIds.get(runId);
    if (!messageId) return;

    try {
      // Emit TEXT_MESSAGE_CONTENT for streaming tokens
      if (token && token.length > 0 && this.emitTextMessages && messageId) {
        this.emitCallback({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: token,
          timestamp: Date.now(),
        } as BaseEvent);
      }

      // Emit TOOL_CALL_ARGS for streaming tool arguments (may contain partial JSON fragments)
      const toolCallChunks = fields?.chunk?.message?.tool_call_chunks;
      if (toolCallChunks && Array.isArray(toolCallChunks) && this.emitToolCalls) {
        const agentRunId = this.agentRunIds.get(runId) ||
                          (_parentRunId ? this.parentToAuthoritativeId.get(_parentRunId) : null) ||
                          _parentRunId ||
                          runId;

        // Track tool call IDs for correlation with handleToolStart
        const pending = this.pendingToolCalls.get(agentRunId) || [];

        for (const chunk of toolCallChunks) {
          if (chunk.id && chunk.args) {
            // Accumulate partial args by toolCallId
            const previousArgs = this.accumulatedToolArgs.get(chunk.id) || "";
            const newArgs = previousArgs + chunk.args;

            // Only accumulate if args have changed (avoid duplicate accumulations)
            if (newArgs !== previousArgs) {
              this.accumulatedToolArgs.set(chunk.id, newArgs);
            }

            // Track this tool call ID for later correlation
            if (!pending.includes(chunk.id)) {
              pending.push(chunk.id);
            }
          }
        }

        if (pending.length > 0) {
          this.pendingToolCalls.set(agentRunId, pending);
        }
      }
    } catch {
      // Fail-safe
    }
  }

  override async handleLLMEnd(
    _output: any,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _extraParams?: Record<string, unknown>
  ): Promise<void> {
    // Collect tool calls from output for subsequent tool callbacks
    // We collect even when disabled, so that tool callbacks have the data they need
    // (tool callbacks will check their own emit flags before emitting)
    try {
      if (_output && typeof _output === "object") {
        const toolCalls = _output.tool_calls || (_output.kwargs?.tool_calls);
        if (Array.isArray(toolCalls)) {
          const agentRunId = this.agentRunIds.get(runId) ||
                            (_parentRunId ? this.parentToAuthoritativeId.get(_parentRunId) : null) ||
                            _parentRunId ||
                            runId;
          const pending = this.pendingToolCalls.get(agentRunId) || [];
          for (const tc of toolCalls) {
            if (tc.id && !pending.includes(tc.id)) {
              pending.push(tc.id);

              // Store tool name for later use in handleToolStart
              if (tc.function?.name) {
                this.toolCallNames.set(tc.id, tc.function.name);
              }

              // Accumulate tool call args for later emission in handleToolStart
              if (tc.function?.arguments) {
                this.accumulatedToolArgs.set(tc.id, tc.function.arguments);
              }
            }
          }
          this.pendingToolCalls.set(agentRunId, pending);
        }
      }
    } catch {
      // Fail-safe
    }

    // Skip event emission if disabled - check after tool call collection
    if (!this.enabled) {
      this.messageIds.delete(runId);
      return;
    }

    const messageId = this.messageIds.get(runId);

    // Extract the final AIMessage for thinking detection
    try {
      const generations = _output?.generations;
      if (Array.isArray(generations) && generations.length > 0) {
        const firstGeneration = generations[0]?.[0];
        if (firstGeneration?.message) {
          this.detectAndEmitThinking(firstGeneration.message, runId, _parentRunId);
        }
      }
    } catch {
      // Fail-safe
    }

    // Emit TEXT_MESSAGE_END
    if (messageId && this.emitTextMessages) {
      this.emitCallback({
        type: EventType.TEXT_MESSAGE_END,
        messageId,
        timestamp: Date.now(),
      } as BaseEvent);
    }

    // Cleanup
    this.messageIds.delete(runId);
  }

  /**
   * Detect and emit thinking events from reasoning content blocks.
   *
   * Uses LangChain V1's contentBlocks API to extract reasoning content
   * and emits the complete thinking event lifecycle:
   * THINKING_START → THINKING_TEXT_MESSAGE_START → THINKING_TEXT_MESSAGE_CONTENT
   * → THINKING_TEXT_MESSAGE_END → THINKING_END
   *
   * Supports multiple reasoning phases via index-based grouping
   * (interleaved thinking pattern: think → respond → tool → think → respond).
   *
   * @param message - The final AIMessage containing reasoning blocks
   * @param runId - The run identifier
   * @param parentRunId - Optional parent run identifier
   */
  private detectAndEmitThinking(
    message: BaseMessage,
    runId: string,
    parentRunId?: string
  ): void {
    // Thinking events are coupled with text messages
    if (!this.emitThinking || !this.emitTextMessages) {
      return;
    }

    // Extract reasoning blocks from the message
    const reasoningBlocks = extractReasoningBlocks(message);

    // No reasoning content, skip
    if (reasoningBlocks.length === 0) {
      return;
    }

    // Group reasoning blocks by index to support multiple thinking phases
    const groupedBlocks = groupReasoningBlocksByIndex(message);

    // Emit one complete thinking cycle per unique index
    for (const [index, blocks] of groupedBlocks) {
      // Emit THINKING_START
      this.emitCallback({
        type: EventType.THINKING_START,
        timestamp: Date.now(),
      } as BaseEvent);

      // Emit THINKING_TEXT_MESSAGE_START (no messageId per AG-UI TypeScript SDK)
      this.emitCallback({
        type: EventType.THINKING_TEXT_MESSAGE_START,
        timestamp: Date.now(),
      } as BaseEvent);

      // Aggregate all reasoning content for this phase into a single CONTENT event
      const phaseContent = blocks
        .map((block) => block.reasoning)
        .filter((text): text is string => typeof text === "string" && text.length > 0)
        .join("");

      if (phaseContent) {
        this.emitCallback({
          type: EventType.THINKING_TEXT_MESSAGE_CONTENT,
          delta: phaseContent,
          timestamp: Date.now(),
        } as BaseEvent);
      }

      // Emit THINKING_TEXT_MESSAGE_END (no messageId)
      this.emitCallback({
        type: EventType.THINKING_TEXT_MESSAGE_END,
        timestamp: Date.now(),
      } as BaseEvent);

      // Emit THINKING_END
      this.emitCallback({
        type: EventType.THINKING_END,
        timestamp: Date.now(),
      } as BaseEvent);
    }
  }

  override async handleLLMError(
    _error: Error,
    runId: string,
    _parentRunId?: string
  ): Promise<void> {
    if (!this.enabled) return;

    this.messageIds.delete(runId);
    const agentRunId = this.agentRunIds.get(runId) ||
                      (_parentRunId ? this.parentToAuthoritativeId.get(_parentRunId) : null) ||
                      _parentRunId ||
                      runId;
    this.pendingToolCalls.delete(agentRunId);
    this.agentRunIds.delete(runId);
  }

  // ==================== Tool Callbacks ====================

  override async handleToolStart(
    tool: any,
    input: string,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ): Promise<void> {
    if (!this.enabled || !this.emitToolCalls) return;

    let toolCallId = runId;
    
    // Try to get tool name from various sources (in priority order):
    // 1. runName parameter (most direct - provided by LangChain)
    // 2. From tool object properties (tool.kwargs.name)
    // 3. From stored tool names (populated in handleLLMEnd from LLM tool_calls)
    // 4. From input JSON
    // 5. Default to "unknown_tool"
    let toolCallName = runName || 
                      (tool as any).kwargs?.name ||
                      (tool as any).name || 
                      (tool as any).func?.name || 
                      (tool as any).getName?.() || 
                      (tool as any).toolName ||
                      (tool as any)._name ||
                      "unknown_tool";  // Ensure always populated

    try {
      // Priority order for toolCallId (MUST use LangChain IDs only):
      // 1. metadata.tool_call_id (modern LangChain pattern)
      // 2. Input's tool_call_id or id field (from tool invocation)
      // 3. Match accumulated streaming args by content
      
      // 1. Check metadata for tool_call_id (if provided)
      if (metadata?.tool_call_id && typeof metadata.tool_call_id === "string") {
        toolCallId = metadata.tool_call_id;
        
        // If we have a stored tool name for this ID, use it
        const storedName = this.toolCallNames.get(toolCallId);
        if (storedName && storedName !== "unknown_tool") {
          toolCallName = storedName;
        }
      }
      // 2. Check input for tool_call_id or id
      else if (input) {
        try {
          const parsed = typeof input === "string" ? JSON.parse(input) : input;
          if (parsed && typeof parsed === "object") {
            if (parsed.tool_call_id) {
              toolCallId = parsed.tool_call_id;
            } else if (parsed.id) {
              toolCallId = parsed.id;
            }
            if (parsed.name) {
              toolCallName = parsed.name;
            }
          }
        } catch {
          // Not JSON, ignore
        }
      }
      // 3. Match accumulated streaming args by content comparison
      if (toolCallId === runId && this.accumulatedToolArgs.size > 0 && input) {
        // Find matching accumulated ID by comparing args content
        for (const [id, args] of this.accumulatedToolArgs) {
          if (input.includes(args) || args.includes(input)) {
            toolCallId = id;
            
            // If we have a stored tool name for this ID, use it
            const storedName = this.toolCallNames.get(id);
            if (storedName && storedName !== "unknown_tool") {
              toolCallName = storedName;
            }
            break;
          }
        }
      }
    } catch {
      // Use defaults
    }

    try {
      // Priority order for toolCallId (MUST use LangChain IDs only):
      // 1. metadata.tool_call_id (modern LangChain pattern)
      // 2. Input's tool_call_id or id field (from tool invocation)
      // 3. Match accumulated streaming args by content
      
      // 1. Check metadata for tool_call_id (if provided)
      if (metadata?.tool_call_id && typeof metadata.tool_call_id === "string") {
        toolCallId = metadata.tool_call_id;
      }
      // 2. Check input for tool_call_id or id
      else if (input) {
        try {
          const parsed = typeof input === "string" ? JSON.parse(input) : input;
          if (parsed && typeof parsed === "object") {
            if (parsed.tool_call_id) {
              toolCallId = parsed.tool_call_id;
            } else if (parsed.id) {
              toolCallId = parsed.id;
            }
            if (parsed.name) {
              toolCallName = parsed.name;
            }
          }
        } catch {
          // Not JSON, ignore
        }
      }
      // 3. Match accumulated streaming args by content comparison
      if (toolCallId === runId && this.accumulatedToolArgs.size > 0 && input) {
        // Find matching accumulated ID by comparing args content
        for (const [id, args] of this.accumulatedToolArgs) {
          if (input.includes(args) || args.includes(input)) {
            toolCallId = id;
            break;
          }
        }
      }
    } catch {
      // Use defaults
    }

    this.toolCallInfo.set(runId, { id: toolCallId, name: toolCallName });

    const agentRunId = (parentRunId ? this.parentToAuthoritativeId.get(parentRunId) : null) || parentRunId || "";
    const messageId = this.latestMessageIds.get(agentRunId);

    try {
      // Emit TOOL_CALL_START first
      this.emitCallback({
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName,
        parentMessageId: messageId,
        timestamp: Date.now(),
      } as BaseEvent);

      // Emit accumulated TOOL_CALL_ARGS (from streaming in handleLLMNewToken)
      // This preserves real-time streaming while maintaining protocol sequence
      const accumulatedArgs = this.accumulatedToolArgs.get(toolCallId);
      if (accumulatedArgs) {
        this.emitCallback({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: accumulatedArgs,
          timestamp: Date.now(),
        } as BaseEvent);
        // Clean up accumulated args
        this.accumulatedToolArgs.delete(toolCallId);
      }
    } catch {
      // Fail-safe
    }
  }

  override async handleToolEnd(
    output: any,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    if (!this.enabled || !this.emitToolCalls) return;

    const toolInfo = this.toolCallInfo.get(runId);
    this.toolCallInfo.delete(runId);

    // Cleanup tool name mapping
    if (toolInfo?.id) {
      this.toolCallNames.delete(toolInfo.id);
    }

    const agentRunId = (parentRunId ? this.parentToAuthoritativeId.get(parentRunId) : null) || parentRunId || "";
    const messageId = this.latestMessageIds.get(agentRunId);

    try {
      const toolCallId = toolInfo?.id ?? runId;

      this.emitCallback({
        type: EventType.TOOL_CALL_END,
        toolCallId,
        timestamp: Date.now(),
      } as BaseEvent);

      this.emitToolResultWithPolicy(output, toolCallId, messageId, toolInfo?.name);
    } catch {
      // Fail-safe
    }
  }

  override async handleToolError(
    _error: Error,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    if (!this.enabled || !this.emitToolCalls) return;

    const toolInfo = this.toolCallInfo.get(runId);
    this.toolCallInfo.delete(runId);
    
    // Cleanup accumulated tool args for this tool call
    if (toolInfo?.id) {
      this.accumulatedToolArgs.delete(toolInfo.id);
    }
    
    const agentRunId = (parentRunId ? this.parentToAuthoritativeId.get(parentRunId) : null) || parentRunId || "";
    const messageId = this.latestMessageIds.get(agentRunId);

    try {
      this.emitCallback({
        type: EventType.TOOL_CALL_END,
        toolCallId: toolInfo?.id ?? runId,
        timestamp: Date.now(),
      } as BaseEvent);
    } catch {
      // Fail-safe
    }
  }

  // ==================== Smart Emission ====================

  private chunkString(content: string, maxChunkSize: number): string[] {
    const chunks: string[] = [];
    let remaining = content;
    
    while (remaining.length > 0) {
      if (new Blob([remaining]).size <= maxChunkSize) {
        chunks.push(remaining);
        break;
      }
      
      let splitPoint = maxChunkSize;
      const spaceIndex = remaining.lastIndexOf(' ', maxChunkSize);
      const newlineIndex = remaining.lastIndexOf('\n', maxChunkSize);
      const boundaryIndex = Math.max(spaceIndex, newlineIndex);
      
      if (boundaryIndex > maxChunkSize * 0.5) {
        splitPoint = boundaryIndex;
      } else {
        while (splitPoint > 0 && remaining.charCodeAt(splitPoint - 1) > 127) {
          splitPoint--;
        }
        if (splitPoint === 0) {
          splitPoint = maxChunkSize;
        }
      }
      
      chunks.push(remaining.substring(0, splitPoint));
      remaining = remaining.substring(splitPoint).trim();
    }
    
    return chunks;
  }

  private emitToolResultWithPolicy(
    output: any,
    toolCallId: string,
    messageId: string | undefined,
    toolCallName?: string
  ): void {
    let content = extractToolOutput(output);
    const resultMessageId = generateId();
    const contentSize = new Blob([content]).size;
    
    if (contentSize <= this.maxUIPayloadSize) {
      this.emitCallback({
        type: EventType.TOOL_CALL_RESULT,
        messageId: resultMessageId,
        toolCallId,
        content,
        role: "tool",
        timestamp: Date.now(),
      } as BaseEvent);
      return;
    }
    
    if (this.chunkLargeResults) {
      const chunks = this.chunkString(content, this.maxUIPayloadSize);
      for (let i = 0; i < chunks.length; i++) {
        // Use CUSTOM event or a new event type for large result chunks
        // to avoid collision with ToolCallChunk which is for arguments
        this.emitCallback({
          type: EventType.CUSTOM,
          name: "LARGE_RESULT_CHUNK",
          value: {
            toolCallId,
            chunk: chunks[i],
            index: i,
            total: chunks.length
          }
        } as BaseEvent);
      }
      return;
    }

    const truncationMessage = ` [Truncated: ${contentSize - this.maxUIPayloadSize + 50} bytes]`;
    const availableSpace = this.maxUIPayloadSize - truncationMessage.length;
    const truncatedContent = content.substring(0, Math.max(0, availableSpace)) + truncationMessage;

    this.emitCallback({
      type: EventType.TOOL_CALL_RESULT,
      messageId: resultMessageId,
      toolCallId,
      content: truncatedContent,
      role: "tool",
      timestamp: Date.now(),
    } as BaseEvent);
  }
}
