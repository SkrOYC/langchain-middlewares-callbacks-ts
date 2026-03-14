/**
 * AG-UI Callback Handler
 *
 * Handles streaming events for LLM tokens and tool calls.
 */

import { type BaseEvent, EventType } from "@ag-ui/core";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseMessage } from "@langchain/core/messages";
import { extractToolOutput } from "../utils/cleaner";
import { expandEvent } from "../utils/event-normalizer";
import { generateDeterministicId, generateId } from "../utils/id-generator";
import {
  extractReasoningBlocks,
  groupReasoningBlocksByIndex,
} from "../utils/reasoning-blocks";

/**
 * Configuration options for the callback handler.
 */
export interface AGUICallbackHandlerOptions {
  /** Callback function for emitting AG-UI events */
  publish: (event: BaseEvent) => void;
  /** Master toggle - when false, no events are emitted (default: true) */
  enabled?: boolean;
  /** Emit TEXT_MESSAGE events: START, CONTENT, END (default: true) */
  emitTextMessages?: boolean;
  /** Emit TOOL_CALL events: START, ARGS, END, RESULT (default: true) */
  emitToolCalls?: boolean;
  /** Emit TOOL_CALL_RESULT events (default: true) */
  emitToolResults?: boolean;
  /** Emit THINKING events: START, TEXT_MESSAGE_*, END (default: true) */
  emitThinking?: boolean;
  /**
   * Reasoning migration mode.
   * - "thinking" (default): emit deprecated THINKING_* events for backward compatibility
   * - "reasoning": emit REASONING_* events
   */
  reasoningEventMode?: "thinking" | "reasoning";
  /** Maximum payload size in bytes for UI events (default: 50KB) */
  maxUIPayloadSize?: number;
  /** Whether to chunk large payloads instead of truncating */
  chunkLargeResults?: boolean;
}

type RecordLike = Record<string, unknown>;

interface ToolCallChunk {
  id?: string;
  name?: string;
  args?: string;
  index?: number;
}

interface ToolCallRecord {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ToolInputResolution {
  toolCallId?: string;
  toolCallName?: string;
  argsDelta?: string;
}

interface StreamingReasoningChunk {
  index: number;
  reasoning?: string;
}

interface StreamingReasoningState {
  phaseId: string;
  messageId: string;
}

interface ToolCallIdentity {
  id: string;
  name: string;
}

interface ToolLike {
  kwargs?: {
    name?: string;
  };
  name?: string;
  func?: {
    name?: string;
  };
  getName?: () => unknown;
  toolName?: string;
  _name?: string;
}

/**
 * Callback handler for AG-UI protocol streaming events.
 * Handles LLM token streaming and tool call lifecycle events.
 */
export class AGUICallbackHandler extends BaseCallbackHandler {
  name = "ag-ui-callback";

  private readonly messageIds = new Map<string, string>();
  private readonly latestMessageIds = new Map<string, string>();
  private readonly startedMessageIds = new Set<string>();
  private readonly agentRunIds = new Map<string, string>(); // Maps current runId to authoritative agentRunId
  private readonly parentToAuthoritativeId = new Map<string, string>(); // Maps internal parentRunId to authoritative agentRunId
  private readonly toolCallInfo = new Map<
    string,
    { id: string; name: string }
  >();
  private readonly toolCallNames = new Map<string, string>(); // Maps toolCallId to tool name from LLM tool_calls
  private readonly agentTurnTracker = new Map<string, number>();
  private readonly pendingToolCalls = new Map<string, string[]>();
  private readonly accumulatedToolArgs = new Map<string, string>(); // Accumulates partial args for streaming tool calls
  private readonly streamingToolCallIds = new Map<string, string>(); // Maps agentRunId:index to toolCallId for args-only deltas
  private readonly streamedReasoningRuns = new Set<string>();
  private readonly openReasoningStates = new Map<string, StreamingReasoningState>();
  private readonly warnedMissingStreamingContentBlocks = new Set<string>();
  private readonly emitCallback: (event: BaseEvent) => void;

  private _enabled: boolean;
  private _emitTextMessages: boolean;
  private _emitToolCalls: boolean;
  private _emitToolResults: boolean;
  private _emitThinking: boolean;
  private _reasoningEventMode: "thinking" | "reasoning";

  private readonly maxUIPayloadSize: number;
  private readonly chunkLargeResults: boolean;

  constructor(options: AGUICallbackHandlerOptions) {
    super({ raiseError: false });
    if (typeof options.publish !== "function") {
      throw new TypeError("publish must be a function");
    }

    this.emitCallback = options.publish;
    this._enabled = options?.enabled ?? true;
    this._emitTextMessages = options?.emitTextMessages ?? true;
    this._emitToolCalls = options?.emitToolCalls ?? true;
    this._emitToolResults = options?.emitToolResults ?? true;
    this._emitThinking = options?.emitThinking ?? true;
    this._reasoningEventMode = options?.reasoningEventMode ?? "thinking";
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

  /** Control TOOL_CALL_RESULT event emission */
  get emitToolResults(): boolean {
    return this._emitToolResults;
  }

  set emitToolResults(value: boolean) {
    this._emitToolResults = value;
  }

  /** Control THINKING event emission */
  get emitThinking(): boolean {
    return this._emitThinking;
  }

  set emitThinking(value: boolean) {
    this._emitThinking = value;
  }

  /** Control reasoning event family: THINKING_* (legacy) or REASONING_* (new) */
  get reasoningEventMode(): "thinking" | "reasoning" {
    return this._reasoningEventMode;
  }

  set reasoningEventMode(value: "thinking" | "reasoning") {
    this._reasoningEventMode = value;
  }

  dispose(): void {
    this.messageIds.clear();
    this.latestMessageIds.clear();
    this.startedMessageIds.clear();
    this.agentRunIds.clear();
    this.parentToAuthoritativeId.clear();
    this.toolCallInfo.clear();
    this.toolCallNames.clear();
    this.agentTurnTracker.clear();
    this.pendingToolCalls.clear();
    this.accumulatedToolArgs.clear();
    this.streamingToolCallIds.clear();
    this.streamedReasoningRuns.clear();
    this.openReasoningStates.clear();
    this.warnedMissingStreamingContentBlocks.clear();
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
  emitTextChunk(
    messageId: string,
    role: "assistant" | "user" | "system" | "developer",
    delta: string
  ): void {
    if (!(this.enabled && this.emitTextMessages)) {
      return;
    }

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
  emitToolChunk(
    toolCallId: string,
    toolCallName: string,
    delta: string,
    parentMessageId?: string
  ): void {
    if (!(this.enabled && this.emitToolCalls)) {
      return;
    }

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

  override handleLLMStart(
    _llm: unknown,
    _prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
    _runName?: string
  ): void {
    if (!(this.enabled && this.emitTextMessages)) {
      return;
    }

    const context = this.getContext(extraParams);
    const agentRunId = this.resolveCallbackAgentRunId(
      runId,
      parentRunId,
      metadata,
      context
    );

    this.agentRunIds.set(runId, agentRunId);
    if (parentRunId) {
      this.parentToAuthoritativeId.set(parentRunId, agentRunId);
    }

    this.prepareAssistantMessage(
      runId,
      agentRunId,
      this.getString(metadata, "agui_messageId")
    );
  }

  override handleLLMNewToken(
    token: string,
    _idx: unknown,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    fields?: unknown
  ): void {
    if (!this.enabled) {
      return;
    }

    const messageId = this.messageIds.get(runId);
    if (!messageId) {
      return;
    }

    try {
      const agentRunId = this.resolveAgentRunId(runId, parentRunId);
      this.emitStreamingReasoning(fields, messageId, runId);
      if (token && token.length > 0) {
        this.closeStreamingReasoning(runId);
        this.ensureAssistantMessageStarted(messageId, agentRunId);
      }
      this.emitStreamingToken(token, messageId);
      if (this.emitToolCalls) {
        this.trackStreamingToolCallArgs(fields, agentRunId);
      }
    } catch {
      // Fail-safe
    }
  }

  override handleLLMEnd(
    output: unknown,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    _extraParams?: Record<string, unknown>
  ): void {
    const agentRunId = this.resolveAgentRunId(runId, parentRunId);

    // Collect tool calls from output for subsequent tool callbacks
    // We collect even when disabled, so that tool callbacks have the data they need
    // (tool callbacks will check their own emit flags before emitting)
    this.collectToolCallsFromOutput(output, agentRunId);

    // Skip event emission if disabled - check after tool call collection
    if (!this.enabled) {
      const messageId = this.messageIds.get(runId);
      if (messageId) {
        this.startedMessageIds.delete(messageId);
      }
      this.closeStreamingReasoning(runId);
      this.streamedReasoningRuns.delete(runId);
      this.warnedMissingStreamingContentBlocks.delete(runId);
      this.messageIds.delete(runId);
      this.clearStreamingToolCallIds(agentRunId);
      return;
    }

    const messageId = this.messageIds.get(runId);

    if (!this.streamedReasoningRuns.has(runId)) {
      // Extract the final AIMessage for thinking detection when reasoning was not streamed.
      this.emitThinkingFromOutput(output, messageId ?? runId);
    }

    this.closeStreamingReasoning(runId);

    this.emitAssistantMessageFromOutput(output, messageId, agentRunId);

    // Emit TEXT_MESSAGE_END
    this.emitTextMessageEnd(messageId);

    // Cleanup
    if (messageId) {
      this.startedMessageIds.delete(messageId);
    }
    this.messageIds.delete(runId);
    this.clearStreamingToolCallIds(agentRunId);
    this.streamedReasoningRuns.delete(runId);
    this.warnedMissingStreamingContentBlocks.delete(runId);
  }

  /**
   * Detect and emit thinking events from reasoning content blocks.
   *
   * Uses LangChain V1's contentBlocks API to extract reasoning content
   * and emits either:
   * - THINKING_START → THINKING_TEXT_MESSAGE_START → THINKING_TEXT_MESSAGE_CONTENT
   *   → THINKING_TEXT_MESSAGE_END → THINKING_END
   * - REASONING_START → REASONING_MESSAGE_START → REASONING_MESSAGE_CONTENT
   *   → REASONING_MESSAGE_END → REASONING_END
   *
   * Supports multiple reasoning phases via index-based grouping
   * (interleaved thinking pattern: think → respond → tool → think → respond).
   *
   * @param message - The final AIMessage containing reasoning blocks
   * @param idBase - Stable ID base for deterministic phase/message IDs
   */
  private detectAndEmitThinking(message: BaseMessage, idBase: string): void {
    // Thinking events are coupled with text messages
    if (!(this.emitThinking && this.emitTextMessages)) {
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
      const reasoningPhaseId = generateDeterministicId(
        `${idBase}-reasoning-phase`,
        index
      );
      const reasoningMessageId = generateDeterministicId(
        `${idBase}-reasoning-message`,
        index
      );

      if (this.reasoningEventMode === "reasoning") {
        this.emitCallback({
          type: EventType.REASONING_START,
          messageId: reasoningPhaseId,
          timestamp: Date.now(),
        } as BaseEvent);
        this.emitCallback({
          type: EventType.REASONING_MESSAGE_START,
          messageId: reasoningMessageId,
          role: "reasoning",
          timestamp: Date.now(),
        } as BaseEvent);
      } else {
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
      }

      // Aggregate all reasoning content for this phase into a single CONTENT event
      const phaseContent = blocks
        .map((block) => block.reasoning)
        .filter((text): text is string => text.trim().length > 0)
        .join("");

      if (phaseContent) {
        if (this.reasoningEventMode === "reasoning") {
          this.emitCallback({
            type: EventType.REASONING_MESSAGE_CONTENT,
            messageId: reasoningMessageId,
            delta: phaseContent,
            timestamp: Date.now(),
          } as BaseEvent);
        } else {
          this.emitCallback({
            type: EventType.THINKING_TEXT_MESSAGE_CONTENT,
            delta: phaseContent,
            timestamp: Date.now(),
          } as BaseEvent);
        }
      }
      if (this.reasoningEventMode === "reasoning") {
        this.emitCallback({
          type: EventType.REASONING_MESSAGE_END,
          messageId: reasoningMessageId,
          timestamp: Date.now(),
        } as BaseEvent);
        this.emitCallback({
          type: EventType.REASONING_END,
          messageId: reasoningPhaseId,
          timestamp: Date.now(),
        } as BaseEvent);
      } else {
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
  }

  override handleLLMError(
    _error: Error,
    runId: string,
    parentRunId?: string
  ): void {
    if (!this.enabled) {
      return;
    }

    const messageId = this.messageIds.get(runId);
    if (messageId) {
      this.startedMessageIds.delete(messageId);
    }
    this.messageIds.delete(runId);
    const agentRunId = this.resolveAgentRunId(runId, parentRunId);
    this.pendingToolCalls.delete(agentRunId);
    this.agentRunIds.delete(runId);
    this.closeStreamingReasoning(runId);
    this.streamedReasoningRuns.delete(runId);
    this.warnedMissingStreamingContentBlocks.delete(runId);
    this.clearStreamingToolCallIds(agentRunId);
  }

  // ==================== Tool Callbacks ====================

  override handleToolStart(
    tool: unknown,
    input: string,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ): void {
    if (!(this.enabled && this.emitToolCalls)) {
      return;
    }

    const toolInput = this.resolveToolInput(
      tool,
      input,
      runId,
      metadata,
      runName
    );
    const toolCall = {
      id: toolInput.toolCallId ?? runId,
      name: toolInput.toolCallName ?? this.getToolCallName(tool, runName),
    };
    this.toolCallInfo.set(runId, toolCall);

    const agentRunId = this.resolveParentAgentRunId(parentRunId);
    const messageId = this.latestMessageIds.get(agentRunId);
    this.emitToolStartSequence(toolCall, messageId, toolInput.argsDelta);
  }

  override handleToolEnd(
    output: unknown,
    runId: string,
    parentRunId?: string
  ): void {
    if (!(this.enabled && this.emitToolCalls)) {
      return;
    }

    const toolInfo = this.toolCallInfo.get(runId);
    this.toolCallInfo.delete(runId);

    // Cleanup tool name mapping
    if (toolInfo?.id) {
      this.toolCallNames.delete(toolInfo.id);
    }

    const messageId = this.latestMessageIds.get(
      this.resolveParentAgentRunId(parentRunId)
    );

    try {
      const toolCallId = toolInfo?.id ?? runId;

      this.emitCallback({
        type: EventType.TOOL_CALL_END,
        toolCallId,
        timestamp: Date.now(),
      } as BaseEvent);

      if (this.emitToolResults) {
        this.emitToolResultWithPolicy(
          output,
          toolCallId,
          messageId,
          toolInfo?.name
        );
      }
    } catch {
      // Fail-safe
    }
  }

  override handleToolError(
    _error: Error,
    runId: string,
    _parentRunId?: string
  ): void {
    if (!(this.enabled && this.emitToolCalls)) {
      return;
    }

    const toolInfo = this.toolCallInfo.get(runId);
    this.toolCallInfo.delete(runId);

    // Cleanup accumulated tool args for this tool call
    if (toolInfo?.id) {
      this.accumulatedToolArgs.delete(toolInfo.id);
    }

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
      const spaceIndex = remaining.lastIndexOf(" ", maxChunkSize);
      const newlineIndex = remaining.lastIndexOf("\n", maxChunkSize);
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
    output: unknown,
    toolCallId: string,
    _messageId: string | undefined,
    _toolCallName?: string
  ): void {
    const content = extractToolOutput(output);
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
            total: chunks.length,
          },
        } as BaseEvent);
      }
      return;
    }

    const truncationMessage = ` [Truncated: ${contentSize - this.maxUIPayloadSize + 50} bytes]`;
    const availableSpace = this.maxUIPayloadSize - truncationMessage.length;
    const truncatedContent =
      content.substring(0, Math.max(0, availableSpace)) + truncationMessage;

    this.emitCallback({
      type: EventType.TOOL_CALL_RESULT,
      messageId: resultMessageId,
      toolCallId,
      content: truncatedContent,
      role: "tool",
      timestamp: Date.now(),
    } as BaseEvent);
  }

  private asRecord(value: unknown): RecordLike | undefined {
    if (typeof value === "object" && value !== null) {
      return value as RecordLike;
    }

    return undefined;
  }

  private getString(
    record: RecordLike | undefined,
    key: string
  ): string | undefined {
    const value = record?.[key];
    return typeof value === "string" ? value : undefined;
  }

  private getContext(
    extraParams?: Record<string, unknown>
  ): RecordLike | undefined {
    return this.asRecord(this.asRecord(extraParams)?.options)?.context as
      | RecordLike
      | undefined;
  }

  private resolveCallbackAgentRunId(
    runId: string,
    parentRunId?: string,
    metadata?: RecordLike,
    context?: RecordLike
  ): string {
    return (
      this.getString(metadata, "run_id") ||
      this.getString(metadata, "runId") ||
      this.getString(context, "run_id") ||
      this.getString(context, "runId") ||
      this.getString(metadata, "agui_runId") ||
      parentRunId ||
      runId
    );
  }

  private resolveAgentRunId(runId: string, parentRunId?: string): string {
    return (
      this.agentRunIds.get(runId) ||
      (parentRunId
        ? this.parentToAuthoritativeId.get(parentRunId)
        : undefined) ||
      parentRunId ||
      runId
    );
  }

  private resolveParentAgentRunId(parentRunId?: string): string {
    return (
      (parentRunId
        ? this.parentToAuthoritativeId.get(parentRunId)
        : undefined) ||
      parentRunId ||
      ""
    );
  }

  private prepareAssistantMessage(
    runId: string,
    _agentRunId: string,
    middlewareMessageId?: string
  ): void {
    const messageId =
      middlewareMessageId ?? this.createAssistantMessageId(_agentRunId);

    this.messageIds.set(runId, messageId);
  }

  private ensureAssistantMessageStarted(
    messageId: string,
    agentRunId: string
  ): void {
    if (this.startedMessageIds.has(messageId)) {
      return;
    }

    this.startedMessageIds.add(messageId);
    this.latestMessageIds.set(agentRunId, messageId);
    this.emitCallback({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
      timestamp: Date.now(),
    } as BaseEvent);
  }

  private createAssistantMessageId(agentRunId: string): string {
    const turnIndex = this.agentTurnTracker.get(agentRunId) || 0;
    this.agentTurnTracker.set(agentRunId, turnIndex + 1);
    return generateDeterministicId(agentRunId, turnIndex);
  }

  private emitStreamingToken(token: string, messageId: string): void {
    if (!(token && token.length > 0 && this.emitTextMessages)) {
      return;
    }

    this.emitCallback({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: token,
      timestamp: Date.now(),
    } as BaseEvent);
  }

  private emitAssistantMessageFromOutput(
    output: unknown,
    messageId: string | undefined,
    agentRunId: string
  ): void {
    if (!(messageId && this.emitTextMessages)) {
      return;
    }

    if (this.startedMessageIds.has(messageId)) {
      return;
    }

    const content = this.getOutputTextContent(output);
    if (!(typeof content === "string" && content.length > 0)) {
      return;
    }

    this.ensureAssistantMessageStarted(messageId, agentRunId);
    this.emitStreamingToken(content, messageId);
  }

  private trackStreamingToolCallArgs(
    fields: unknown,
    agentRunId: string
  ): void {
    const toolCallChunks = this.getToolCallChunks(fields);
    if (toolCallChunks.length === 0) {
      return;
    }

    const pending = [...(this.pendingToolCalls.get(agentRunId) || [])];
    let hasPendingUpdates = false;

    for (const chunk of toolCallChunks) {
      const toolCallId = this.resolveStreamingToolCallId(agentRunId, chunk);
      if (!toolCallId) {
        continue;
      }

      if (chunk.name) {
        this.toolCallNames.set(toolCallId, chunk.name);
      }

      if (typeof chunk.args === "string") {
        const previousArgs = this.accumulatedToolArgs.get(toolCallId) || "";
        const nextArgs = previousArgs + chunk.args;
        if (nextArgs !== previousArgs) {
          this.accumulatedToolArgs.set(toolCallId, nextArgs);
        }
      }

      if (!pending.includes(toolCallId)) {
        pending.push(toolCallId);
        hasPendingUpdates = true;
      }
    }

    if (hasPendingUpdates) {
      this.pendingToolCalls.set(agentRunId, pending);
    }
  }

  private emitStreamingReasoning(
    fields: unknown,
    assistantMessageId: string,
    runId: string
  ): void {
    if (!(this.emitThinking && this.emitTextMessages)) {
      return;
    }

    const reasoningChunks = this.getStreamingReasoningChunks(fields, runId);
    if (reasoningChunks.length === 0) {
      return;
    }

    this.streamedReasoningRuns.add(runId);

    for (const chunk of reasoningChunks) {
      const state = this.ensureStreamingReasoningState(
        runId,
        assistantMessageId,
        chunk.index
      );
      if (!(typeof chunk.reasoning === "string" && chunk.reasoning.length > 0)) {
        continue;
      }
      this.emitCallback({
        type: EventType.REASONING_MESSAGE_CONTENT,
        messageId: state.messageId,
        delta: chunk.reasoning,
        timestamp: Date.now(),
      } as BaseEvent);
    }
  }

  private getStreamingReasoningChunks(
    fields: unknown,
    runId: string
  ): StreamingReasoningChunk[] {
    const chunk = this.asRecord(this.asRecord(fields)?.chunk);
    const message = chunk?.message;
    const messageRecord = this.asRecord(message);
    const contentBlocks = this.getStreamingContentBlocks(message);

    if (
      contentBlocks.length === 0 &&
      this.hasRawStreamingReasoning(messageRecord)
    ) {
      this.warnMissingStreamingContentBlocks(runId);
    }

    return contentBlocks
      .map((entry) => this.asRecord(entry))
      .flatMap((entry) => {
        const reasoning = this.getString(entry, "reasoning");
        if (entry?.type !== "reasoning") {
          return [];
        }

        return [
          {
            index: typeof entry.index === "number" ? entry.index : 0,
            reasoning,
          },
        ];
      });
  }

  private getStreamingContentBlocks(message: unknown): unknown[] {
    const messageRecord = this.asRecord(message);
    if (Array.isArray(messageRecord?.contentBlocks)) {
      return messageRecord.contentBlocks;
    }

    return [];
  }

  private hasRawStreamingReasoning(
    messageRecord: RecordLike | undefined
  ): boolean {
    if (!Array.isArray(messageRecord?.content)) {
      return false;
    }

    return messageRecord.content.some((entry) => {
      const block = this.asRecord(entry);
      return block?.type === "reasoning" && typeof block.reasoning === "string";
    });
  }

  private warnMissingStreamingContentBlocks(runId?: string): void {
    if (!runId || this.warnedMissingStreamingContentBlocks.has(runId)) {
      return;
    }

    this.warnedMissingStreamingContentBlocks.add(runId);
    console.warn(
      "[AG-UI] Stream chunk exposed reasoning outside LangChain contentBlocks; reasoning events were skipped for this chunk."
    );
  }

  private ensureStreamingReasoningState(
    runId: string,
    assistantMessageId: string,
    index: number
  ): StreamingReasoningState {
    const key = `${runId}:${index}`;
    const existing = this.openReasoningStates.get(key);
    if (existing) {
      return existing;
    }

    const state = {
      phaseId: generateDeterministicId(
        `${assistantMessageId}-reasoning-phase`,
        index
      ),
      messageId: generateDeterministicId(
        `${assistantMessageId}-reasoning-message`,
        index
      ),
    };
    this.openReasoningStates.set(key, state);

    this.emitCallback({
      type: EventType.REASONING_START,
      messageId: state.phaseId,
      timestamp: Date.now(),
    } as BaseEvent);
    this.emitCallback({
      type: EventType.REASONING_MESSAGE_START,
      messageId: state.messageId,
      role: "reasoning",
      timestamp: Date.now(),
    } as BaseEvent);

    return state;
  }

  private closeStreamingReasoning(runId: string): void {
    const prefix = `${runId}:`;
    for (const [key, state] of this.openReasoningStates) {
      if (!key.startsWith(prefix)) {
        continue;
      }

      this.emitCallback({
        type: EventType.REASONING_MESSAGE_END,
        messageId: state.messageId,
        timestamp: Date.now(),
      } as BaseEvent);
      this.emitCallback({
        type: EventType.REASONING_END,
        messageId: state.phaseId,
        timestamp: Date.now(),
      } as BaseEvent);
      this.openReasoningStates.delete(key);
    }
  }

  private getToolCallChunks(fields: unknown): ToolCallChunk[] {
    const chunk = this.asRecord(this.asRecord(fields)?.chunk);
    const message = this.asRecord(chunk?.message);
    const messageKwargs = this.asRecord(message?.kwargs);
    const toolCallChunks =
      message?.tool_call_chunks ?? messageKwargs?.tool_call_chunks;

    if (!Array.isArray(toolCallChunks)) {
      return [];
    }

    return toolCallChunks.map((entry) => {
      const record = this.asRecord(entry);
      return {
        id: this.getString(record, "id"),
        name: this.getString(record, "name"),
        args: this.getString(record, "args"),
        index: typeof record?.index === "number" ? record.index : undefined,
      };
    });
  }

  private resolveStreamingToolCallId(
    agentRunId: string,
    chunk: ToolCallChunk
  ): string | undefined {
    if (chunk.id) {
      const key = this.getStreamingToolCallKey(agentRunId, chunk.index);
      if (key) {
        this.streamingToolCallIds.set(key, chunk.id);
      }
      return chunk.id;
    }

    const key = this.getStreamingToolCallKey(agentRunId, chunk.index);
    if (!key) {
      return undefined;
    }

    return this.streamingToolCallIds.get(key);
  }

  private getStreamingToolCallKey(
    agentRunId: string,
    index?: number
  ): string | undefined {
    if (typeof index !== "number") {
      return undefined;
    }

    return `${agentRunId}:${index}`;
  }

  private clearStreamingToolCallIds(agentRunId: string): void {
    const prefix = `${agentRunId}:`;
    for (const key of this.streamingToolCallIds.keys()) {
      if (key.startsWith(prefix)) {
        this.streamingToolCallIds.delete(key);
      }
    }
  }

  private collectToolCallsFromOutput(
    output: unknown,
    agentRunId: string
  ): void {
    try {
      const toolCalls = this.getOutputToolCalls(output);
      if (toolCalls.length === 0) {
        return;
      }

      const pending = [...(this.pendingToolCalls.get(agentRunId) || [])];
      for (const toolCall of toolCalls) {
        if (!(toolCall.id && !pending.includes(toolCall.id))) {
          continue;
        }

        pending.push(toolCall.id);
        if (toolCall.function?.name) {
          this.toolCallNames.set(toolCall.id, toolCall.function.name);
        }
        if (toolCall.function?.arguments) {
          this.accumulatedToolArgs.set(
            toolCall.id,
            toolCall.function.arguments
          );
        }
      }

      this.pendingToolCalls.set(agentRunId, pending);
    } catch {
      // Fail-safe
    }
  }

  private getOutputToolCalls(output: unknown): ToolCallRecord[] {
    const outputRecord = this.asRecord(output);
    const kwargs = this.asRecord(outputRecord?.kwargs);
    const toolCalls = outputRecord?.tool_calls ?? kwargs?.tool_calls;

    if (Array.isArray(toolCalls)) {
      return toolCalls.map((entry) => {
        const record = this.asRecord(entry);
        const fn = this.asRecord(record?.function);
        return {
          id: this.getString(record, "id"),
          function: {
            name: this.getString(fn, "name"),
            arguments: this.getString(fn, "arguments"),
          },
        };
      });
    }

    const message = this.getOutputMessage(output);
    const messageRecord = this.asRecord(message);
    const messageToolCalls = messageRecord?.tool_calls;
    if (!Array.isArray(messageToolCalls)) {
      return [];
    }

    return messageToolCalls.map((entry) => {
      const record = this.asRecord(entry);
      const fn = this.asRecord(record?.function);
      return {
        id: this.getString(record, "id"),
        function: {
          name:
            this.getString(fn, "name") ?? this.getString(record, "name"),
          arguments:
            this.getString(fn, "arguments") ??
            this.stringifyIfDefined(record?.args),
        },
      };
    });
  }

  private emitThinkingFromOutput(output: unknown, idBase: string): void {
    try {
      const outputRecord = this.asRecord(output);
      const generations = outputRecord?.generations;
      if (!Array.isArray(generations) || generations.length === 0) {
        return;
      }

      const firstGenerationGroup = generations[0];
      if (
        !Array.isArray(firstGenerationGroup) ||
        firstGenerationGroup.length === 0
      ) {
        return;
      }

      const firstGeneration = this.asRecord(firstGenerationGroup[0]);
      const message = firstGeneration?.message;
      if (!message) {
        return;
      }

      this.detectAndEmitThinking(message as BaseMessage, idBase);
    } catch {
      // Fail-safe
    }
  }

  private emitTextMessageEnd(messageId?: string): void {
    if (
      !(messageId && this.emitTextMessages) ||
      !this.startedMessageIds.has(messageId)
    ) {
      return;
    }

    this.emitCallback({
      type: EventType.TEXT_MESSAGE_END,
      messageId,
      timestamp: Date.now(),
    } as BaseEvent);
  }

  private resolveToolInput(
    tool: unknown,
    input: string,
    runId: string,
    metadata?: RecordLike,
    runName?: string
  ): ToolInputResolution {
    let toolCallId = runId;
    let toolCallName = this.getToolCallName(tool, runName);
    let argsDelta = input || undefined;

    const metadataToolCallId = this.getString(metadata, "tool_call_id");
    if (metadataToolCallId) {
      return {
        toolCallId: metadataToolCallId,
        toolCallName: this.resolveStoredToolName(metadataToolCallId, toolCallName),
        argsDelta,
      };
    }

    const parsedInput = this.parseToolInput(input);
    if (parsedInput) {
      toolCallId =
        this.getString(parsedInput, "tool_call_id") ||
        this.getString(parsedInput, "id") ||
        toolCallId;
      toolCallName = this.getString(parsedInput, "name") || toolCallName;
      argsDelta = this.resolveToolArgsDelta(parsedInput, input);
    }

    const matchedToolCallId =
      toolCallId === runId
        ? this.findMatchingAccumulatedToolCallId(input)
        : undefined;
    if (matchedToolCallId) {
      toolCallId = matchedToolCallId;
    }

    return {
      toolCallId,
      toolCallName: this.resolveStoredToolName(toolCallId, toolCallName),
      argsDelta,
    };
  }

  private getToolCallName(tool: unknown, runName?: string): string {
    if (runName) {
      return runName;
    }

    const toolRecord = this.asRecord(tool) as ToolLike | undefined;
    if (!toolRecord) {
      return "unknown_tool";
    }

    const callbackName = toolRecord.getName?.();
    if (typeof callbackName === "string" && callbackName.length > 0) {
      return callbackName;
    }

    return (
      toolRecord.kwargs?.name ||
      toolRecord.name ||
      toolRecord.func?.name ||
      toolRecord.toolName ||
      toolRecord._name ||
      "unknown_tool"
    );
  }

  private parseToolInput(input: string): RecordLike | undefined {
    if (!input) {
      return undefined;
    }

    try {
      return this.asRecord(JSON.parse(input));
    } catch {
      return undefined;
    }
  }

  private findMatchingAccumulatedToolCallId(input: string): string | undefined {
    if (!input) {
      return undefined;
    }

    for (const [toolCallId, args] of this.accumulatedToolArgs) {
      if (input.includes(args) || args.includes(input)) {
        return toolCallId;
      }
    }

    return undefined;
  }

  private resolveStoredToolName(
    toolCallId: string,
    fallbackName: string
  ): string {
    const storedName = this.toolCallNames.get(toolCallId);
    if (storedName && storedName !== "unknown_tool") {
      return storedName;
    }

    return fallbackName;
  }

  private emitToolStartSequence(
    toolCall: ToolCallIdentity,
    parentMessageId?: string,
    inputArgsDelta?: string
  ): void {
    try {
      this.emitCallback({
        type: EventType.TOOL_CALL_START,
        toolCallId: toolCall.id,
        toolCallName: toolCall.name,
        parentMessageId,
        timestamp: Date.now(),
      } as BaseEvent);

      const argsDelta =
        inputArgsDelta ?? this.accumulatedToolArgs.get(toolCall.id);
      if (!argsDelta) {
        return;
      }

      this.emitCallback({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: toolCall.id,
        delta: argsDelta,
        timestamp: Date.now(),
      } as BaseEvent);
      this.accumulatedToolArgs.delete(toolCall.id);
    } catch {
      // Fail-safe
    }
  }

  private getOutputMessage(output: unknown): unknown {
    const outputRecord = this.asRecord(output);
    const generations = outputRecord?.generations;
    if (!Array.isArray(generations) || generations.length === 0) {
      return undefined;
    }

    const firstGroup = generations[0];
    if (!Array.isArray(firstGroup) || firstGroup.length === 0) {
      return undefined;
    }

    return this.asRecord(firstGroup[0])?.message;
  }

  private getOutputTextContent(output: unknown): string | undefined {
    const outputRecord = this.asRecord(output);
    const message = this.getOutputMessage(output);
    const messageRecord = this.asRecord(message);
    const content = messageRecord?.content;
    if (typeof content === "string" && content.length > 0) {
      return content;
    }

    const text = this.getString(this.asRecord(messageRecord?.kwargs), "text");
    if (text && text.length > 0) {
      return text;
    }

    const contentBlocks = messageRecord?.contentBlocks;
    if (Array.isArray(contentBlocks)) {
      const blockText = contentBlocks
        .map((block) => this.asRecord(block))
        .filter((block) => block?.type === "text")
        .map((block) => this.getString(block, "text"))
        .filter((value): value is string => Boolean(value && value.length > 0))
        .join("");

      if (blockText.length > 0) {
        return blockText;
      }
    }

    const generations = Array.isArray(outputRecord?.generations)
      ? outputRecord.generations
      : undefined;
    const firstGroup = Array.isArray(generations?.[0]) ? generations[0] : undefined;
    const generation = this.asRecord(firstGroup?.[0]);
    const generationText = generation?.text;
    return typeof generationText === "string" && generationText.length > 0
      ? generationText
      : undefined;
  }

  private resolveToolArgsDelta(
    parsedInput: RecordLike,
    rawInput: string
  ): string | undefined {
    if (typeof parsedInput.args === "string") {
      return parsedInput.args;
    }

    const stringifiedArgs = this.stringifyIfDefined(parsedInput.args);
    if (stringifiedArgs) {
      return stringifiedArgs;
    }

    if (typeof parsedInput.arguments === "string") {
      return parsedInput.arguments;
    }

    const stringifiedArguments = this.stringifyIfDefined(parsedInput.arguments);
    if (stringifiedArguments) {
      return stringifiedArguments;
    }

    return rawInput || undefined;
  }

  private stringifyIfDefined(value: unknown): string | undefined {
    if (typeof value === "undefined") {
      return undefined;
    }

    if (typeof value === "string") {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
}
