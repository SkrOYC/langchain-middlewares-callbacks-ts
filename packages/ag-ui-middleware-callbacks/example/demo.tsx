
import React, { useState, useEffect, useRef, useCallback } from "react";
import type { AGUITransport } from "../src/index";

// ============================================================================
// AG-UI Event Type Guards (per AG-UI spec)
// ============================================================================

interface BaseEvent {
  type: string;
  timestamp?: number;
}

interface TextMessageEvent extends BaseEvent {
  messageId?: string;
  delta?: string;
  role?: string;
}

interface ThinkingEvent extends BaseEvent {
  title?: string;
  messageId?: string;
}

interface ToolEvent extends BaseEvent {
  toolCallId: string;
  toolCallName?: string;
  delta?: string;
  parentMessageId?: string;
}

interface StateEvent extends BaseEvent {
  snapshot?: Record<string, unknown>;
  delta?: Array<{ op: string; path: string; value?: unknown }>;
}

interface RunEvent extends BaseEvent {
  threadId?: string;
  runId?: string;
  parentRunId?: string;
  message?: string;
  code?: string;
  result?: unknown;
}

interface CustomEvent extends BaseEvent {
  name: string;
  value: Record<string, unknown>;
}

function isTextMessageEvent(event: any): event is TextMessageEvent {
  return [
    "TEXT_MESSAGE_START",
    "TEXT_MESSAGE_CONTENT",
    "TEXT_MESSAGE_END",
    "TEXT_MESSAGE_CHUNK",
  ].includes(event.type);
}

function isThinkingEvent(event: any): event is ThinkingEvent {
  return [
    "THINKING_START",
    "THINKING_END",
    "THINKING_TEXT_MESSAGE_START",
    "THINKING_TEXT_MESSAGE_CONTENT",
    "THINKING_TEXT_MESSAGE_END",
  ].includes(event.type);
}

function isToolEvent(event: any): event is ToolEvent {
  return [
    "TOOL_CALL_START",
    "TOOL_CALL_ARGS",
    "TOOL_CALL_END",
    "TOOL_CALL_RESULT",
    "TOOL_CALL_CHUNK",
  ].includes(event.type);
}

function isStateEvent(event: any): event is StateEvent {
  return ["STATE_SNAPSHOT", "STATE_DELTA"].includes(event.type);
}

function isRunEvent(event: any): event is RunEvent {
  return ["RUN_STARTED", "RUN_FINISHED", "RUN_ERROR"].includes(event.type);
}

function isCustomEvent(event: any): event is CustomEvent {
  return event.type === "CUSTOM";
}

// ============================================================================
// Types & Interfaces
// ============================================================================

interface AgentConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface SessionState {
  threadId: string | null;
  runId: string | null;
  parentRunId: string | null;
}

interface RecoveryState {
  lastEventId: string | null;
  lastErrorCode: string | null;
}

interface AppState {
  user: Record<string, unknown> | null;
  conversation: Record<string, unknown> | null;
  ui: Record<string, unknown> | null;
}

interface ChatEvent {
  id: string;
  type: "message" | "thinking" | "tool-result" | "activity";
  messageId?: string;
  content?: string;
  role?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
  activityType?: string;
  isComplete?: boolean;  // For thinking events - marks if thinking is complete
  timestamp: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Apply JSON Patch (RFC 6902) to an object
 */
function applyStateDelta(obj: any, patch: Array<{ op: string; path: string; value?: any }>): any {
  const result = { ...obj };
  for (const operation of patch) {
    const { op, path, value } = operation;
    const parts = path.split("/").filter(Boolean);
    const lastKey = parts.pop()!;
    let target = result;
    for (const part of parts) {
      target = target[part];
      if (!target) break;
    }
    switch (op) {
      case "add":
      case "replace":
        target[lastKey] = value;
        break;
      case "remove":
        delete target[lastKey];
        break;
    }
  }
  return result;
}

// ============================================================================
// State Manager for AG-UI State Synchronization (per AG-UI spec)
// ============================================================================

class StateManager {
  private state: AppState = {
    user: null,
    conversation: null,
    ui: null,
  };
  private listeners: Set<(state: AppState) => void> = new Set();

  applyStateEvent(event: any): void {
    switch (event.type) {
      case "STATE_SNAPSHOT":
        this.state = (event.snapshot as AppState) || this.state;
        break;
      case "STATE_DELTA":
        // Use the shared helper function instead of duplicating logic
        this.state = applyStateDelta(this.state, event.delta || []);
        break;
    }
    this.notifyListeners();
  }

  getState(): AppState {
    return { ...this.state };
  }

  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const currentState = this.getState();
    this.listeners.forEach((listener) => listener(currentState));
  }
}

// ============================================================================
// React Components (UI)
// ============================================================================

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; height: 100vh; display: flex; flex-direction: column; }
  #root { height: 100%; display: flex; flex-direction: column; align-items: center; padding: 20px; }
  .chat-container { flex: 1; display: flex; flex-direction: column; width: 100%; max-width: 700px; }
  .messages { flex: 1; overflow-y: auto; padding: 20px 0; }
  .message { margin-bottom: 16px; display: flex; gap: 12px; }
  .message.user { flex-direction: row-reverse; }
  .message-bubble { max-width: 70%; padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
  .message.assistant .message-bubble { background: white; border-bottom-left-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
  .message.user .message-bubble { background: #007aff; color: white; border-bottom-right-radius: 4px; }
  .message.tool .message-bubble { background: #e8f5e9; color: #2e7d32; border-radius: 4px; font-family: monospace; font-size: 12px; }
  .thinking-block { background: linear-gradient(135deg, #f0f4f8 0%, #e8eef3 100%); border-left: 3px solid #4a90a4; border-radius: 4px; padding: 12px 16px; margin: 8px 0 8px 40px; font-style: italic; color: #555; font-size: 13px; position: relative; }
  .thinking-block.completed { background: linear-gradient(135deg, #f0f9f0 0%, #e0f2e0 100%); border-left-color: #4caf50; }
  .thinking-header { font-weight: 600; color: #4a90a4; display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .thinking-block.completed .thinking-header { color: #4caf50; }
  .thinking-content { color: #666; line-height: 1.6; }
  .thinking-completed-badge { background: #e8f5e9; color: #388e3c; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: auto; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .tool-result { background: white; border: 1px solid #e9ecef; border-radius: 8px; padding: 12px; margin: 8px 0 8px 40px; font-size: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .tool-result-header { font-weight: 600; color: #495057; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .tool-result-content { font-family: 'SF Mono', Monaco, monospace; color: #28a745; background: #f8f9fa; padding: 8px 12px; border-radius: 4px; margin-top: 8px; font-size: 13px; }
  .tool-args { font-family: 'SF Mono', Monaco, monospace; color: #6c757d; font-size: 12px; background: #f1f3f5; padding: 6px 10px; border-radius: 4px; margin-bottom: 6px; }
  .tool-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #e0e0e0; border-top-color: #4a90a4; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 6px; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .tool-loading { color: #4a90a4; font-style: italic; }
  .activity-block { background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%); border-left: 3px solid #ff9800; border-radius: 4px; padding: 12px 16px; margin: 8px 0 8px 40px; }
  .activity-header { font-weight: 600; color: #e65100; display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .activity-content { color: #333; line-height: 1.6; font-size: 13px; }
  .activity-status { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 8px; }
  .activity-status.started { background: #e3f2fd; color: #1976d2; }
  .activity-status.processing { background: #fff3e0; color: #f57c00; }
  .activity-status.completed { background: #e8f5e9; color: #388e3c; }
  .input-area { display: flex; gap: 12px; padding: 16px; background: white; border-top: 1px solid #e0e0e0; border-radius: 12px; }
  .input-area input { flex: 1; padding: 12px 16px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; transition: border-color 0.2s; }
  .input-area input:focus { outline: none; border-color: #007aff; }
  .btn { padding: 10px 16px; border: none; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
  .btn-primary { background: #007aff; color: white; }
  .btn-primary:hover { background: #0056b3; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; backdrop-filter: blur(4px); }
  .modal-content { background: white; padding: 24px; border-radius: 12px; width: 400px; max-width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
  .modal-content h2 { margin-bottom: 20px; color: #333; }
  .form-group { margin-bottom: 16px; display: flex; flex-direction: column; gap: 6px; }
  .form-group label { font-size: 12px; color: #666; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
  .form-group input { padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; transition: border-color 0.2s; }
  .form-group input:focus { outline: none; border-color: #007aff; }
  .modal-buttons { display: flex; gap: 10px; margin-top: 20px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding: 10px 0; }
  .header h3 { color: #333; margin-bottom: 4px; }
  .settings-btn { padding: 8px 16px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s; }
  .settings-btn:hover { background: #e9ecef; }
  .error-message { background: #ffebee; border-left: 3px solid #f44336; border-radius: 4px; padding: 12px 16px; margin: 8px 0 8px 40px; color: #c62828; font-size: 13px; }
  .error-code { font-weight: 600; margin-right: 8px; }
  .retry-indicator { background: #fff3e0; border-left: 3px solid #ff9800; border-radius: 4px; padding: 8px 12px; margin: 8px 0 8px 40px; font-size: 12px; color: #e65100; }
  .retry-count { font-weight: 600; }
`;

function App() {
  const [chatEvents, setChatEvents] = useState<ChatEvent[]>([]);
  const [input, setInput] = useState("");
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>({
    threadId: null,
    runId: null,
    parentRunId: null,
  });
  const [recoveryState, setRecoveryState] = useState<RecoveryState>({
    lastEventId: null,
    lastErrorCode: null,
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [appState, setAppState] = useState<AppState>({
    user: null,
    conversation: null,
    ui: null,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const stateManagerRef = useRef<StateManager | null>(null);

  // Form State
  const [formBaseUrl, setFormBaseUrl] = useState("https://opencode.ai/zen/v1");
  const [formApiKey, setFormApiKey] = useState("");
  const [formModel, setFormModel] = useState("grok-code");

  // Initialize StateManager for AG-UI state synchronization
  useEffect(() => {
    stateManagerRef.current = new StateManager();
    
    // Subscribe to state changes for UI sync
    const unsubscribe = stateManagerRef.current.subscribe((newState) => {
      setAppState(newState);
    });
    
    return () => {
      unsubscribe();
    };
  }, []);

  // Initialize from localStorage - only on client side to prevent hydration mismatch
  const [isClient, setIsClient] = useState(false);
  
  useEffect(() => {
    setIsClient(true);
    const savedConfig = localStorage.getItem("agui_config");
    if (savedConfig) {
      const parsed = JSON.parse(savedConfig);
      setConfig(parsed);
      setFormBaseUrl(parsed.baseUrl);
      setFormApiKey(parsed.apiKey);
      setFormModel(parsed.model);
    } else {
      setIsSettingsOpen(true);
    }
    const savedSessionId = localStorage.getItem("agui_session_id");
    if (savedSessionId) setSessionId(savedSessionId);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatEvents]);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [eventSource]);

  const saveSettings = () => {
    const newConfig = { baseUrl: formBaseUrl, apiKey: formApiKey, model: formModel };
    setConfig(newConfig);
    localStorage.setItem("agui_config", JSON.stringify(newConfig));
    setIsSettingsOpen(false);
  };

  const handleSend = async () => {
    if (!input.trim() || !config) return;

    // Add user message to timeline
    const userMessage: ChatEvent = {
      id: crypto.randomUUID(),
      type: "message",
      role: "user",
      content: input,
      timestamp: Date.now(),
    };
    setChatEvents((prev) => [...prev, userMessage]);
    setInput("");
    setIsRunning(true);

    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: input }],
          config,
          sessionId,
        }),
      });

      const data = await res.json();
      if (data.sessionId) {
        setSessionId(data.sessionId);
        localStorage.setItem("agui_session_id", data.sessionId);
        connectSSE(data.sessionId);
      }
    } catch (err) {
      console.error("Failed to send:", err);
      setIsRunning(false);
    }
  };

  const connectSSE = (id: string) => {
    // Prevent multiple concurrent connections
    if (eventSource) {
      console.log("Closing existing EventSource before creating new one");
      eventSource.close();
      setEventSource(null);
    }

    console.log("Creating SSE connection for session:", id);
    const newEventSource = new EventSource(`/chat?sessionId=${id}`);
    setEventSource(newEventSource);

    newEventSource.onopen = () => {
      console.log("SSE connection opened successfully");
    };

    newEventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        // =========================================================================
        // Lifecycle Events (AG-UI Protocol Section 6)
        // =========================================================================
        case "RUN_STARTED":
          // Store lifecycle context for conversation tracking (per AG-UI spec)
          // Reset recovery state for new run
          setRecoveryState((prev) => ({
            ...prev,
            lastErrorCode: null,
          }));
          setSessionState((prev) => ({
            ...prev,
            threadId: data.threadId || null,
            runId: data.runId || null,
            parentRunId: data.parentRunId || null,
          }));
          setIsRunning(true);
          console.log("Run started:", { threadId: data.threadId, runId: data.runId });
          break;

        case "RUN_FINISHED":
          setIsRunning(false);
          // Optionally display result if provided (per AG-UI spec)
          if (data.result !== undefined) {
            console.log("Run result:", data.result);
          }
          break;

        case "RUN_ERROR":
          setIsRunning(false);
          // Enhanced error handling per AG-UI spec (ERROR_HANDLING.md)
          const isRetryable = [
            "TOOL_EXECUTION_FAILED",
            "TOOL_TIMEOUT",
            "RATE_LIMIT",
            "MODEL_UNAVAILABLE",
            "INTERNAL_ERROR",
            "TIMEOUT",
          ].includes(data.code);
          
          setChatEvents((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              type: "message",
              role: "assistant",
              content: `Error${data.code ? ` (${data.code})` : ""}: ${data.message || "Unknown error"}${isRetryable ? " - Retrying..." : ""}`,
              timestamp: Date.now(),
            },
          ]);
          
          // Update recovery state for retry logic
          setRecoveryState((prev) => ({
            ...prev,
            lastErrorCode: data.code || null,
          }));
          break;

        case "STEP_STARTED":
        case "STEP_FINISHED":
          // Log steps per AG-UI spec
          console.log(`Step ${data.type.split("_")[1].toLowerCase()}:`, data.stepName);
          break;

        // =========================================================================
        // Activity Events (AG-UI Protocol Section 5)
        // =========================================================================
        case "ACTIVITY_SNAPSHOT":
          // Add or update activity message per spec
          setChatEvents((prev) => {
            const index = prev.findIndex((e) => e.messageId === data.messageId);
            const activityEvent: ChatEvent = {
              id: data.messageId,
              type: "activity",
              messageId: data.messageId,
              activityType: data.activityType,
              content: JSON.stringify(data.content, null, 2),
              timestamp: Date.now(),
            };
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = activityEvent;
              return updated;
            }
            return [...prev, activityEvent];
          });
          break;

        case "ACTIVITY_DELTA":
          // Update existing activity with JSON patch per spec
          setChatEvents((prev) => {
            const index = prev.findIndex((e) => e.messageId === data.messageId);
            if (index !== -1 && prev[index].content) {
              try {
                const updated = [...prev];
                const currentContent = JSON.parse(updated[index].content || "{}");
                const patchedContent = applyStateDelta(currentContent, data.patch);
                updated[index] = { ...updated[index], content: JSON.stringify(patchedContent, null, 2) };
                return updated;
              } catch {
                return prev;
              }
            }
            return prev;
          });
          break;

        // =========================================================================
        // State Events (AG-UI Protocol Section 4) - Updated per spec
        // =========================================================================
        case "STATE_SNAPSHOT":
          // Apply full state dump for initialization or recovery per spec
          if (stateManagerRef.current) {
            stateManagerRef.current.applyStateEvent(data);
          }
          console.log("State snapshot applied:", Object.keys(data.snapshot || {}).length, "keys");
          break;

        case "STATE_DELTA":
          // Apply incremental state updates using JSON Patch per spec
          if (stateManagerRef.current) {
            stateManagerRef.current.applyStateEvent(data);
          }
          console.log("State delta applied:", data.delta?.length || 0, "operations");
          break;

        case "MESSAGES_SNAPSHOT":
          // Apply full conversation history for recovery per spec
          // Smart reconciliation to prevent duplicates when IDs mismatch between streaming and snapshot
          if (Array.isArray(data.messages)) {
            setChatEvents((prev) => {
              // Create a copy of existing events to work with
              const existingEvents = [...prev];
              
              data.messages.forEach((msg: any) => {
                // Find existing event by messageId OR by Content+Role match
                // This handles cases where IDs don't align between streaming and snapshot
                const existingIndex = existingEvents.findIndex((e) => {
                  // Primary: Match by messageId (exact ID match)
                  if (e.messageId === msg.id) return true;
                  
                  // Secondary: Match by content and role (handles ID-less local messages)
                  // Only match if content is non-empty to avoid false positives
                  if (msg.content && msg.content.trim()) {
                    return e.role === msg.role && e.content?.trim() === msg.content.trim();
                  }
                  
                  return false;
                });

                if (existingIndex !== -1) {
                  // Reconciliation: Update existing event with server's messageId
                  // This "anchors" the message to the server history for future deduplication
                  existingEvents[existingIndex] = {
                    ...existingEvents[existingIndex],
                    messageId: msg.id,
                    // Update content from server as ground truth (handles text edits)
                    content: msg.content ?? existingEvents[existingIndex].content,
                    // Preserve server-assigned id if different
                    id: msg.id || existingEvents[existingIndex].id,
                  };
                } else {
                  // Truly new message (e.g., history recovery on page refresh)
                  existingEvents.push({
                    id: msg.id || crypto.randomUUID(),
                    type: msg.role === "tool" ? "tool-result" : msg.role === "assistant" ? "message" : "message",
                    role: msg.role,
                    content: msg.content || "",
                    messageId: msg.id,
                    toolCallId: msg.toolCallId,
                    toolName: msg.toolName,
                    toolArgs: msg.toolArgs,
                    toolResult: msg.toolResult,
                    timestamp: Date.now(),
                  });
                }
              });
              
              return existingEvents;
            });
            console.log("Conversation reconciled:", data.messages.length, "messages");
          }
          break;

        // =========================================================================
        // Message Events (AG-UI Protocol Section 2) - Updated per spec
        // =========================================================================
        case "TEXT_MESSAGE_START":
          // Add new assistant message to timeline per spec
          setChatEvents((prev) => [
            ...prev,
            {
              id: data.messageId,
              type: "message",
              role: data.role || "assistant", // Explicit role per spec
              content: "",
              messageId: data.messageId,
              timestamp: Date.now(),
            },
          ]);
          break;

        case "TEXT_MESSAGE_CONTENT":
          // Append to last assistant message per spec
          setChatEvents((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.type === "message" && last.role === "assistant") {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, content: last.content + (data.delta || "") };
              return updated;
            }
            return prev;
          });
          break;

        case "TEXT_MESSAGE_END":
          // Message completed per spec
          break;

        case "TEXT_MESSAGE_CHUNK":
          // Convenience event that auto-expands to Start → Content → End per spec
          if (data.messageId) {
            setChatEvents((prev) => {
              const index = prev.findIndex((e) => e.messageId === data.messageId && e.type === "message");
              if (index !== -1) {
                // Update existing message
                const updated = [...prev];
                updated[index] = { 
                  ...updated[index], 
                  content: updated[index].content + (data.delta || ""),
                  role: data.role || updated[index].role,
                };
                return updated;
              }
              // Create new message if doesn't exist
              return [...prev, {
                id: data.messageId,
                type: "message",
                role: data.role || "assistant",
                content: data.delta || "",
                messageId: data.messageId,
                timestamp: Date.now(),
              }];
            });
          }
          break;

        // =========================================================================
        // Thinking Events (AG-UI Protocol Section 2) - Updated per spec
        // =========================================================================
        case "THINKING_START":
          // Add title field support if present per spec
          const thinkingTitle = data.title || "Thinking";
          setChatEvents((prev) => [
            ...prev,
            {
              id: data.messageId || crypto.randomUUID(),
              type: "thinking",
              messageId: data.messageId, // MessageId for lifecycle tracking per spec
              content: "",
              timestamp: Date.now(),
            },
          ]);
          break;

        case "THINKING_TEXT_MESSAGE_START":
          // Thinking content stream started per spec
          break;

        case "THINKING_TEXT_MESSAGE_CONTENT":
          // Append to thinking content with proper messageId correlation per spec
          setChatEvents((prev) => {
            const index = data.messageId 
              ? prev.findIndex((e) => e.type === "thinking" && e.messageId === data.messageId)
              : prev.reduce((acc, e, i) => e.type === "thinking" ? i : acc, -1);
            
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = { ...updated[index], content: updated[index].content + (data.delta || "") };
              return updated;
            }
            return prev;
          });
          break;

        case "THINKING_TEXT_MESSAGE_END":
          // Thinking content stream completed per spec
          break;

        case "THINKING_END":
          // Mark thinking as complete per spec - update the thinking block to show completion
          setChatEvents((prev) => {
            // Find the most recent thinking event that's not yet complete
            const index = prev.findIndex((e) => e.type === "thinking" && !e.isComplete);
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = { ...updated[index], isComplete: true };
              return updated;
            }
            return prev;
          });
          break;

        // =========================================================================
        // Tool Events (AG-UI Protocol Section 3) - Updated per spec
        // =========================================================================
        case "TOOL_CALL_START":
          // Tool call started - update existing tool result with tool name
          // Log for debugging (parentMessageId is used for tracking which message triggered the tool)
          setChatEvents((prev) => {
            const index = prev.findIndex((e) => e.type === "tool-result" && e.toolCallId === data.toolCallId);
            if (index !== -1) {
              // Update existing tool result with the tool name
              const updated = [...prev];
              updated[index] = { 
                ...updated[index], 
                toolName: data.toolCallName || updated[index].toolName 
              };
              return updated;
            }
            return prev;
          });
          if (data.parentMessageId) {
            console.log("Tool call started:", data.toolCallName, "parent:", data.parentMessageId);
          }
          break;

        case "TOOL_CALL_ARGS":
          // Update tool args by toolCallId or create placeholder per spec
          // FIX: Use findIndex by toolCallId instead of relying on last event
          setChatEvents((prev) => {
            const index = prev.findIndex((e) => e.type === "tool-result" && e.toolCallId === data.toolCallId);
            if (index !== -1) {
              // Update existing tool result - only append if content is different
              const toolEvent = prev[index];
              const newArgs = String(data.delta || "");
              const currentArgs = toolEvent.toolArgs || "";
              if (!currentArgs.endsWith(newArgs)) {
                const updated = [...prev];
                updated[index] = { ...toolEvent, toolArgs: currentArgs + newArgs };
                return updated;
              }
              return prev; // No change needed
            }
            // Create placeholder if doesn't exist
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                type: "tool-result",
                toolCallId: data.toolCallId,
                toolName: data.toolCallName || "Unknown Tool", // Use actual tool name
                toolArgs: String(data.delta || ""),
                toolResult: "",
                timestamp: Date.now(),
              },
            ];
          });
          break;

        case "TOOL_CALL_END":
          // Tool call ended - args are complete per spec
          break;

        case "TOOL_CALL_CHUNK":
          // Convenience event that auto-expands to Start → Args → End per spec
          const chunkToolCallId = data.toolCallId || crypto.randomUUID();
          const chunkToolName = data.toolCallName || "Unknown";
          const chunkDelta = data.delta || "";
          
          setChatEvents((prev) => {
            const index = prev.findIndex((e) => e.type === "tool-result" && e.toolCallId === chunkToolCallId);
            
            if (index !== -1) {
              // Update existing tool result - only append if content is different
              const currentArgs = prev[index].toolArgs || "";
              if (!currentArgs.endsWith(chunkDelta)) {
                const updated = [...prev];
                updated[index] = { 
                  ...updated[index], 
                  toolName: chunkToolName,
                  toolArgs: currentArgs + chunkDelta,
                };
                return updated;
              }
              return prev; // No change needed
            }
            // Create new tool result placeholder
            return [...prev, {
              id: crypto.randomUUID(),
              type: "tool-result",
              toolCallId: chunkToolCallId,
              toolName: chunkToolName,
              toolArgs: chunkDelta,
              toolResult: "",
              timestamp: Date.now(),
            }];
          });
          break;

        case "TOOL_CALL_RESULT":
          // Update or create tool result per spec
          setChatEvents((prev) => {
            const index = prev.findIndex((e) => e.type === "tool-result" && e.toolCallId === data.toolCallId);
            const toolResult: ChatEvent = {
              id: data.messageId || crypto.randomUUID(),
              type: "tool-result",
              toolCallId: data.toolCallId,
              toolName: data.toolCallName || "Unknown Tool",
              toolArgs: prev[index]?.toolArgs || "",
              toolResult: String(data.content || ""),
              timestamp: Date.now(),
            };
            
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = toolResult;
              return updated;
            }
            return [...prev, toolResult];
          });
          break;

        // =========================================================================
        // Extensibility Events (AG-UI Protocol Section 8)
        // =========================================================================
        case "RAW":
          // Passthrough for provider-specific events per spec
          console.log("RAW event:", data.event, "from source:", data.source);
          break;

        case "CUSTOM":
          // Application-specific events per spec
          if (data.name === "LARGE_RESULT_CHUNK") {
            // Handle large tool result chunks from AGUICallbackHandler
            setChatEvents((prev) => {
              const index = prev.findIndex((e) => 
                e.type === "tool-result" && e.toolCallId === data.value.toolCallId
              );
              
              if (index !== -1) {
                const updated = [...prev];
                const currentContent = updated[index].toolResult || "";
                const chunkIndex = data.value.index;
                
                if (chunkIndex === 0) {
                  // First chunk - replace content
                  updated[index] = {
                    ...updated[index],
                    toolResult: data.value.chunk,
                  };
                } else {
                  // Accumulate chunks
                  updated[index] = {
                    ...updated[index],
                    toolResult: currentContent + data.value.chunk,
                  };
                }
                return updated;
              }
              
              // Create new tool result for chunked result
              return [...prev, {
                id: crypto.randomUUID(),
                type: "tool-result",
                toolCallId: data.value.toolCallId,
                toolName: "Unknown",
                toolArgs: "",
                toolResult: data.value.chunk,
                timestamp: Date.now(),
              }];
            });
          } else {
            // Log other custom events
            console.log("CUSTOM event:", data.name, data.value);
          }
          break;

        default:
          // Unknown event type - log for debugging
          console.log("Unknown event type:", data.type, data);
          break;
      }
    };

    newEventSource.onerror = (error) => {
      // Only log error if there's an actual error object
      // EventSource fires onerror when connection closes, which is normal after RUN_FINISHED
      if (error && error.type !== "error") {
        console.error("SSE error:", error);
      }
      setIsRunning(false);
      newEventSource.close();
    };
  };

  return (
    <div className="chat-container">
      {isClient && isSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Configure Agent</h2>
            <div className="form-group">
              <label>Base URL</label>
              <input
                value={formBaseUrl}
                onChange={(e) => setFormBaseUrl(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>API Key</label>
              <input
                type="password"
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </div>
            <div className="form-group">
              <label>Model</label>
              <input
                value={formModel}
                onChange={(e) => setFormModel(e.target.value)}
              />
            </div>
            <div className="modal-buttons">
              <button className="btn btn-primary" onClick={saveSettings}>
                Save & Start
              </button>
              {config && (
                <button className="btn" onClick={() => setIsSettingsOpen(false)}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="header">
        <div>
          <h3>AG-UI Demo</h3>
        </div>
        <button className="settings-btn" onClick={() => setIsSettingsOpen(true)}>
          Settings
        </button>
      </div>

      <div className="messages">
        {chatEvents.map((event) => {
          if (event.type === "message") {
            return (
              <div key={event.id} className={`message ${event.role}`}>
                <div className="message-bubble">{event.content}</div>
              </div>
            );
          } else if (event.type === "thinking") {
            return (
              <div key={event.id} className={`thinking-block ${event.isComplete ? "completed" : ""}`}>
                <div className="thinking-header">
                  {event.isComplete ? "Thought" : "Thinking..."}
                  {event.isComplete && <span className="thinking-completed-badge">Done</span>}
                </div>
                <div className="thinking-content">{event.content}</div>
              </div>
            );
          } else if (event.type === "tool-result") {
            const isLoading = !event.toolResult;
            return (
              <div key={event.id} className="tool-result">
                <div className="tool-result-header">
                  {isLoading && <span className="tool-spinner" />}
                  {isLoading ? (
                    <span className="tool-loading">Running: {event.toolName}</span>
                  ) : (
                    <>Tool: {event.toolName}</>
                  )}
                </div>
                {event.toolArgs && (
                  <div className="tool-args">Args: {event.toolArgs}</div>
                )}
                {event.toolResult && (
                  <div className="tool-result-content">{event.toolResult}</div>
                )}
              </div>
            );
          } else if (event.type === "activity") {
            // Parse activity content to display status
            let status = "processing";
            let statusText = "Processing";
            let parseError = false;
            try {
              const content = JSON.parse(event.content || "{}");
              status = content.status || "processing";
              statusText = status.charAt(0).toUpperCase() + status.slice(1);
            } catch {
              parseError = true;
              status = "error";
              statusText = "Parse Error";
            }
            return (
              <div key={event.id} className="activity-block">
                <div className="activity-header">
                  Activity: {event.activityType || "AGENT_STEP"}
                  <span className={`activity-status ${status}`}>{statusText}</span>
                </div>
                <div className="activity-content">
                  <pre style={{ margin: 0, fontSize: "11px", overflow: "auto" }}>
                    {parseError ? `Invalid JSON: ${event.content}` : event.content}
                  </pre>
                </div>
              </div>
            );
          }
          return null;
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && handleSend()}
          placeholder={isRunning ? "Agent is running..." : "Type a message..."}
          disabled={!config || isRunning}
        />
        <button className="btn btn-primary" onClick={handleSend} disabled={!config || isRunning}>
          {isRunning ? "Running..." : "Send"}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Server Side Logic (Bun.serve)
// ============================================================================

if (import.meta.main) {
  const { renderToString } = await import("react-dom/server");
  const { tool } = await import("@langchain/core/tools");
  const { ChatOpenAI } = await import("@langchain/openai");
  const { createAGUIAgent, AGUICallbackHandler } = await import("../src/index");

  const sessions = new Map<string, any>();

  // Tools
  const calculatorTool = tool(
    async ({ a, b, operation }: { a: number; b: number; operation: string }) => {
      let result: number;
      switch (operation) {
        case "add":
          result = a + b;
          break;
        case "subtract":
          result = a - b;
          break;
        case "multiply":
          result = a * b;
          break;
        case "divide":
          result = a / b;
          break;
        default:
          return `Unknown operation: ${operation}`;
      }
      return `Result: ${result}`;
    },
    {
      name: "calculator",
      description: "Perform arithmetic",
      schema: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
          operation: {
            type: "string",
            enum: ["add", "subtract", "multiply", "divide"],
          },
        },
        required: ["a", "b", "operation"],
      },
    }
  );

  Bun.serve({
    port: 3000,
    async fetch(req) {
      const url = new URL(req.url);

      // Serve HTML
      if (url.pathname === "/") {
        const html = renderToString(
          <html>
            <head>
              <title>AG-UI Demo</title>
              <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>AG</text></svg>" />
              <style dangerouslySetInnerHTML={{ __html: CSS }} />
            </head>
            <body>
              <div id="root">
                <App />
              </div>
              <script type="module" src="/client.js"></script>
            </body>
          </html>
        );
        return new Response("<!DOCTYPE html>" + html, {
          headers: { "Content-Type": "text/html" },
        });
      }

      // Self-bundle for browser
      if (url.pathname === "/client.js") {
        const build = await Bun.build({
          entrypoints: [import.meta.filename!],
          target: "browser",
          minify: true,
          define: {
            "import.meta.main": "false",
            "process.env.NODE_ENV": JSON.stringify("development"),
          },
          external: [
            "react-dom/server",
            "@langchain/core/tools",
            "@langchain/openai",
            "langchain",
          ],
        });
        return new Response(build.outputs[0]);
      }

      // Chat Endpoints
      if (url.pathname === "/chat") {
        if (req.method === "POST") {
          try {
            const body = await req.json();
            console.log("POST /chat body:", JSON.stringify(body, null, 2));
            
            let sessionId = body.sessionId || Math.random().toString(36).slice(2);
            const newSession = !sessions.has(sessionId);
            
            if (newSession) {
              console.log("Creating new session:", sessionId);
              sessions.set(sessionId, { messages: [], config: body.config });
            }
            
            const session = sessions.get(sessionId);
            session.messages.push(...(body.messages || []));
            
            console.log("Session config for", sessionId, ":", JSON.stringify(session.config, null, 2));
            
            return new Response(JSON.stringify({ sessionId }), {
              headers: { "Content-Type": "application/json" },
            });
          } catch (err) {
            console.error("Error in POST /chat:", err);
            return new Response(JSON.stringify({ error: "Invalid request body" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        if (req.method === "GET") {
          const sessionId = url.searchParams.get("sessionId");
          
          if (!sessionId) {
            return new Response(JSON.stringify({ error: "Missing sessionId" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          
          const session = sessions.get(sessionId);
          if (!session) {
            console.error("Session not found:", sessionId);
            return new Response(JSON.stringify({ error: "Session not found", sessionId }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }

          // Verify config is valid (apiKey can be blank for open models)
          if (!session.config || !session.config.model) {
            console.error("Invalid session config:", sessionId, session.config);
            return new Response(JSON.stringify({ error: "Invalid session configuration", details: session.config }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          console.log("Starting SSE stream for session:", sessionId);

          const model = new ChatOpenAI({
            model: session.config.model,
            streaming: true,
            configuration: {
              baseURL: session.config.baseUrl,
              apiKey: session.config.apiKey,
            },
          });

          return new Response(
            new ReadableStream({
              async start(controller) {
                const encoder = new TextEncoder();
                
                // Helper function to send events safely
                const sendEvent = (event: any) => {
                  try {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
                    );
                  } catch (err) {
                    console.error("Error sending SSE event:", err);
                  }
                };
                
                // Helper function to send error event and close
                const sendErrorAndClose = (message: string, code?: string) => {
                  try {
                    sendEvent({
                      type: "RUN_ERROR",
                      message,
                      code,
                      timestamp: Date.now(),
                    });
                    controller.close();
                  } catch {
                    controller.close();
                  }
                };
                
                const transport: AGUITransport = {
                  emit: async (event) => {
                    sendEvent(event);
                  },
                };
                
                try {
                  const agent = createAGUIAgent({
                    model,
                    tools: [calculatorTool],
                    transport,
                    middlewareOptions: {
                      // Lifecycle events from middleware (RUN_STARTED, RUN_FINISHED, ACTIVITY, etc.)
                      emitToolResults: true,
                      emitStateSnapshots: "initial",
                      emitActivities: true,
                      maxUIPayloadSize: 50 * 1024,
                      chunkLargeResults: false,
                      errorDetailLevel: "message",
                      // Custom mappers for transformed events
                      activityMapper: (node) => ({
                        ...node,
                        _demoMapped: true,
                        _demoTimestamp: Date.now(),
                        stepDescription: node.stepName
                          ? `Executing: ${node.stepName}`
                          : "Agent processing",
                      }),
                      stateMapper: (state) => ({
                        ...state,
                        _demoNote: "This state snapshot was transformed by stateMapper",
                      }),
                    },
                  });

                  // AGUICallbackHandler handles LLM streaming events
                  // (TEXT_MESSAGE, THINKING, TOOL_CALL - events that come from the model)
                  const aguiCallback = new AGUICallbackHandler(transport);

                  const eventStream = await (agent as any).streamEvents(
                    { messages: session.messages },
                    { version: "v2", callbacks: [aguiCallback] }
                  );

                  for await (const event of eventStream) {
                    if (
                      event.event === "on_chain_end" &&
                      event.data?.output?.messages
                    ) {
                      session.messages = event.data.output.messages;
                    }
                  }
                  controller.close();
                } catch (err) {
                  // Handle errors during agent execution
                  const errorMessage = err instanceof Error ? err.message : String(err);
                  console.error("Agent execution error:", err);
                  sendErrorAndClose(errorMessage, "AGENT_EXECUTION_ERROR");
                }
              },
            }),
            {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
              },
            }
          );
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log("🚀 AG-UI Demo: http://localhost:3000");
}

// ============================================================================
// Client Side Hydration
// ============================================================================

if (typeof document !== "undefined") {
  const { hydrateRoot } = await import("react-dom/client");
  hydrateRoot(document.getElementById("root")!, <App />);
}
