
import React, { useState, useEffect, useRef } from "react";
import type { AGUITransport } from "../src/index";

// ============================================================================
// Types & Interfaces
// ============================================================================

interface AgentConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
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
  .thinking-header { font-weight: 600; color: #4a90a4; display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .thinking-content { color: #666; line-height: 1.6; }
  .tool-result { background: white; border: 1px solid #e9ecef; border-radius: 8px; padding: 12px; margin: 8px 0 8px 40px; font-size: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .tool-result-header { font-weight: 600; color: #495057; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .tool-result-content { font-family: 'SF Mono', Monaco, monospace; color: #28a745; background: #f8f9fa; padding: 8px 12px; border-radius: 4px; margin-top: 8px; font-size: 13px; }
  .tool-args { font-family: 'SF Mono', Monaco, monospace; color: #6c757d; font-size: 11px; background: #f1f3f5; padding: 6px 10px; border-radius: 4px; margin-bottom: 6px; }
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
`;

function App() {
  const [chatEvents, setChatEvents] = useState<ChatEvent[]>([]);
  const [input, setInput] = useState("");
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Form State
  const [formBaseUrl, setFormBaseUrl] = useState("https://opencode.ai/zen/v1");
  const [formApiKey, setFormApiKey] = useState("");
  const [formModel, setFormModel] = useState("grok-code");

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
    if (eventSource) {
      eventSource.close();
    }

    const newEventSource = new EventSource(`/chat?sessionId=${id}`);
    setEventSource(newEventSource);

    newEventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        // Lifecycle Events
        case "RUN_STARTED":
          setIsRunning(true);
          break;

        case "RUN_FINISHED":
          setIsRunning(false);
          break;

        case "RUN_ERROR":
          setIsRunning(false);
          break;

        case "STEP_STARTED":
        case "STEP_FINISHED":
          // Log steps (could add to UI in future)
          break;

        // Activity Events (AG-UI Protocol Section 5)
        case "ACTIVITY_SNAPSHOT":
          // Add or update activity message
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
          // Update existing activity with JSON patch
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

        // State Events (AG-UI Protocol Section 4)
        case "STATE_SNAPSHOT":
          // Could be used for conversation recovery - log for now
          console.log("State snapshot received:", data.snapshot);
          break;

        case "STATE_DELTA":
          // Incremental state updates - log for now
          console.log("State delta received:", data.delta);
          break;

        case "MESSAGES_SNAPSHOT":
          // Full conversation history - could be used for recovery
          console.log("Messages snapshot received:", data.messages.length, "messages");
          break;

        // Message Events
        case "TEXT_MESSAGE_START":
          // Add new assistant message to timeline
          setChatEvents((prev) => [
            ...prev,
            {
              id: data.messageId,
              type: "message",
              role: "assistant",
              content: "",
              messageId: data.messageId,
              timestamp: Date.now(),
            },
          ]);
          break;

        case "TEXT_MESSAGE_CONTENT":
          // Append to last assistant message
          setChatEvents((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.type === "message" && last.role === "assistant") {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, content: last.content + data.delta };
              return updated;
            }
            return prev;
          });
          break;

        case "TEXT_MESSAGE_END":
          // Message completed
          break;

        // Thinking Events
        case "THINKING_START":
          setChatEvents((prev) => [
            ...prev,
            {
              id: data.messageId,
              type: "thinking",
              messageId: data.messageId,
              content: "",
              timestamp: Date.now(),
            },
          ]);
          break;

        case "THINKING_TEXT_MESSAGE_START":
          // Thinking content stream started - content will follow
          break;

        case "THINKING_TEXT_MESSAGE_CONTENT":
          setChatEvents((prev) => {
            const index = prev.findIndex((e) => e.type === "thinking" && e.messageId === data.messageId);
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = { ...updated[index], content: updated[index].content + data.delta };
              return updated;
            }
            return prev;
          });
          break;

        case "THINKING_TEXT_MESSAGE_END":
          // Thinking content stream completed
          break;

        case "THINKING_END":
          // Thinking completed
          break;

        // Tool Events
        case "TOOL_CALL_START":
          // Tool call started - will be followed by result
          break;

        case "TOOL_CALL_ARGS":
          // Update tool args in most recent tool result or create placeholder
          setChatEvents((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.type === "tool-result" && last.toolCallId === data.toolCallId) {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, toolArgs: last.toolArgs + String(data.delta) };
              return updated;
            }
            // Create placeholder if doesn't exist
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                type: "tool-result",
                toolCallId: data.toolCallId,
                toolName: "Unknown",
                toolArgs: String(data.delta),
                toolResult: "",
                timestamp: Date.now(),
              },
            ];
          });
          break;

        case "TOOL_CALL_END":
          // Tool call ended - args are complete
          break;

        case "TOOL_CALL_RESULT":
          // Update or create tool result
          setChatEvents((prev) => {
            const index = prev.findIndex((e) => e.type === "tool-result" && e.toolCallId === data.toolCallId);
            const toolResult: ChatEvent = {
              id: data.messageId,
              type: "tool-result",
              toolCallId: data.toolCallId,
              toolName: data.toolCallName || "Unknown Tool",
              toolArgs: prev[index]?.toolArgs || "",
              toolResult: String(data.content),
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

        default:
          // Unknown event type
          break;
      }
    };

    newEventSource.onerror = (error) => {
      console.error("SSE error:", error);
      setIsRunning(false);
      newEventSource.close();
    };
  };

  return (
    <div className="chat-container">
      {isClient && isSettingsOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
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
              <div key={event.id} className="thinking-block">
                <div className="thinking-header">
                  Thinking...
                </div>
                <div className="thinking-content">{event.content}</div>
              </div>
            );
          } else if (event.type === "tool-result") {
            return (
              <div key={event.id} className="tool-result">
                <div className="tool-result-header">
                  Tool: {event.toolName}
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
            try {
              const content = JSON.parse(event.content || "{}");
              status = content.status || "processing";
              statusText = status.charAt(0).toUpperCase() + status.slice(1);
            } catch {}
            return (
              <div key={event.id} className="activity-block">
                <div className="activity-header">
                  Activity: {event.activityType || "AGENT_STEP"}
                  <span className={`activity-status ${status}`}>{statusText}</span>
                </div>
                <div className="activity-content">
                  <pre style={{ margin: 0, fontSize: "11px", overflow: "auto" }}>
                    {event.content}
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
          const body = await req.json();
          let sessionId = body.sessionId || Math.random().toString(36).slice(2);
          if (!sessions.has(sessionId)) {
            sessions.set(sessionId, { messages: [], config: body.config });
          }
          const session = sessions.get(sessionId);
          session.messages.push(...(body.messages || []));
          return new Response(JSON.stringify({ sessionId }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        if (req.method === "GET") {
          const sessionId = url.searchParams.get("sessionId");
          const session = sessions.get(sessionId || "");
          if (!session) return new Response("Not Found", { status: 404 });

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
                const transport: AGUITransport = {
                  emit: async (event) => {
                    try {
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
                      );
                    } catch {}
                  },
                };
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
              },
            }),
            {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
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
