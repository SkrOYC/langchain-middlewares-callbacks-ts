import React, { useState, useEffect, useRef, useCallback } from "react";
// Note: @ag-ui/client is loaded via import map in the HTML
import { HttpAgent, AgentSubscriber, RunAgentInput } from "@ag-ui/client";

// ============================================================================
// CSS Styles
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

// ============================================================================
// Types
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
  isComplete?: boolean;
  timestamp: number;
}

// ============================================================================
// React Components (UI)
// ============================================================================

function App() {
  const [chatEvents, setChatEvents] = useState<ChatEvent[]>([]);
  const [input, setInput] = useState("");
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Form State
  const [formBaseUrl, setFormBaseUrl] = useState("https://opencode.ai/zen/v1");
  const [formApiKey, setFormApiKey] = useState("");
  const [formModel, setFormModel] = useState("grok-code");

  // Agent ref
  const agentRef = useRef<HttpAgent | null>(null);

  // Initialize agent on client side
  useEffect(() => {
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
  }, []);

  // Scroll to bottom when events change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatEvents]);

  const saveSettings = () => {
    const newConfig = { baseUrl: formBaseUrl, apiKey: formApiKey, model: formModel };
    setConfig(newConfig);
    localStorage.setItem("agui_config", JSON.stringify(newConfig));
    setIsSettingsOpen(false);
  };

  // Initialize agent when config changes
  useEffect(() => {
    if (!config) return;

    // Create HttpAgent
    const agent = new HttpAgent({
      url: "/chat",
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Create subscriber
    const subscriber: AgentSubscriber = {
      onTextMessageStartEvent: ({ event }) => {
        setChatEvents((prev) => [
          ...prev,
          {
            id: event.messageId,
            type: "message",
            role: event.role || "assistant",
            content: "",
            messageId: event.messageId,
            timestamp: Date.now(),
          },
        ]);
      },
      onTextMessageContentEvent: ({ event, textMessageBuffer }) => {
        setChatEvents((prev) => {
          const updated = [...prev];
          const index = updated.findIndex((e) => e.messageId === event.messageId);
          if (index !== -1) {
            updated[index] = { ...updated[index], content: textMessageBuffer };
          }
          return updated;
        });
      },
      onToolCallStartEvent: ({ event }) => {
        setChatEvents((prev) => [
          ...prev,
          {
            id: event.toolCallId,
            type: "tool-result",
            toolCallId: event.toolCallId,
            toolName: event.toolCallName || "Unknown Tool",
            toolArgs: "",
            toolResult: "",
            timestamp: Date.now(),
          },
        ]);
      },
      onToolCallArgsEvent: ({ event, toolCallBuffer }) => {
        setChatEvents((prev) => {
          const updated = [...prev];
          const index = updated.findIndex((e) => e.toolCallId === event.toolCallId);
          if (index !== -1) {
            updated[index] = { ...updated[index], toolArgs: toolCallBuffer };
          }
          return updated;
        });
      },
      onToolCallResultEvent: ({ event }) => {
        setChatEvents((prev) => {
          const updated = [...prev];
          const index = updated.findIndex((e) => e.toolCallId === event.toolCallId);
          if (index !== -1) {
            updated[index] = { ...updated[index], toolResult: String(event.content) };
          }
          return updated;
        });
      },
      onRunErrorEvent: ({ event }) => {
        setChatEvents((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: "message",
            role: "assistant",
            content: `Error: ${event.message || "Unknown error"}`,
            timestamp: Date.now(),
          },
        ]);
      },
    };

    agent.subscribe(subscriber);
    agentRef.current = agent;
  }, [config]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !agentRef.current) return;

    // Add user message
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
      await agentRef.current.runAgent({
        messages: [{ role: "user", content: input }],
        threadId: crypto.randomUUID(),
        state: {},
      } as RunAgentInput);
    } catch (err) {
      console.error("Failed to send:", err);
    } finally {
      setIsRunning(false);
    }
  }, [input]);

  return (
    <div className="chat-container">
      {isSettingsOpen && (
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

  const sessions = new Map<string, { messages: Array<{ role: string; content: string }>; config: AgentConfig }>();

  // Calculator tool
  const calculatorTool = tool(
    async ({ a, b, operation }: { a: number; b: number; operation: string }) => {
      let result: number;
      switch (operation) {
        case "add": result = a + b; break;
        case "subtract": result = a - b; break;
        case "multiply": result = a * b; break;
        case "divide": result = a / b; break;
        default: return `Unknown operation: ${operation}`;
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
          operation: { type: "string", enum: ["add", "subtract", "multiply", "divide"] },
        },
        required: ["a", "b", "operation"],
      },
    }
  );

  Bun.serve({
    port: 3000,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      // Serve HTML
      if (url.pathname === "/") {
        const html = renderToString(
          <html>
            <head>
              <title>AG-UI Demo</title>
              <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>AG</text></svg>" />
              <script type="importmap">
                {JSON.stringify({
                  imports: {
                    "@ag-ui/client": "https://cdn.jsdelivr.net/npm/@ag-ui/client@0.0.42/+esm",
                  },
                })}
              </script>
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
        return new Response("<!DOCTYPE html>" + html, { headers: { "Content-Type": "text/html" } });
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

      // Chat endpoint - handles session creation and event streaming
      if (url.pathname === "/chat") {
        // POST: Handle both simple session creation and streaming requests
        if (req.method === "POST") {
          try {
            const body = await req.json();
            
            // Check if this is a streaming request (has messages to process)
            const bodyAny = body as Record<string, unknown>;
            const messages = bodyAny.messages as Array<{ role: string; content: string }>;
            if (messages && messages.length > 0) {
              // Create or get session
              const threadId = bodyAny.threadId as string || Math.random().toString(36).slice(2);
              const config = bodyAny.config as AgentConfig || { baseUrl: "", apiKey: "", model: "grok-code" };
              const session = sessions.get(threadId) || { messages: [], config };
              sessions.set(threadId, session);
              
              // Add messages to session
              session.messages.push(...messages);
              
              // Create model for streaming
              const model = new ChatOpenAI({
                model: session.config.model || "grok-code",
                streaming: true,
                configuration: { baseURL: session.config.baseUrl, apiKey: session.config.apiKey },
              });

              return new Response(
                new ReadableStream({
                  async start(controller) {
                    const encoder = new TextEncoder();
                    
                    const sendEvent = (event: unknown) => {
                      try {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                      } catch (err) {
                        console.error("Error sending SSE event:", err);
                      }
                    };
                    
                    const sendErrorAndClose = (message: string, code?: string) => {
                      try {
                        sendEvent({ type: "RUN_ERROR", message, code, timestamp: Date.now() });
                        controller.close();
                      } catch {
                        controller.close();
                      }
                    };
                    
                    const transport = {
                      emit: async (event: unknown) => { sendEvent(event); },
                    };
                    
                    try {
                      const agent = createAGUIAgent({
                        model,
                        tools: [calculatorTool],
                        transport,
                        middlewareOptions: {
                          emitToolResults: true,
                          emitStateSnapshots: "initial",
                          emitActivities: true,
                          maxUIPayloadSize: 50 * 1024,
                          chunkLargeResults: false,
                          errorDetailLevel: "message",
                        },
                      });

                      const aguiCallback = new AGUICallbackHandler(transport);

                      const eventStream = await (agent as unknown as { streamEvents: (input: { messages: Array<{ role: string; content: string }> }, options: { version: string; callbacks: Array<unknown> }) => AsyncIterable<unknown> }).streamEvents(
                        { messages: session.messages },
                        { version: "v2", callbacks: [aguiCallback] }
                      );

                      for await (const event of eventStream) {
                        if ((event as { event: string }).event === "on_chain_end" && (event as { data?: { output?: { messages?: Array<unknown> } } }).data?.output?.messages) {
                          session.messages = (event as { data: { output: { messages: Array<{ role: string; content: string }> } } }).data.output.messages as Array<{ role: string; content: string }>;
                        }
                      }
                      controller.close();
                    } catch (err) {
                      const errorMessage = err instanceof Error ? err.message : String(err);
                      console.error("Agent execution error:", err);
                      sendErrorAndClose(errorMessage, "AGENT_EXECUTION_ERROR");
                    }
                  },
                }),
                { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } }
              );
            }
            
            // Simple session creation (no streaming)
            const sessionId = body.sessionId || body.threadId || Math.random().toString(36).slice(2);
            if (!sessions.has(sessionId)) {
              sessions.set(sessionId, { messages: [], config: body.config || {} });
            }
            const session = sessions.get(sessionId)!;
            session.messages.push(...(body.messages || []));
            
            return new Response(JSON.stringify({ sessionId, threadId: sessionId }), { 
              headers: { "Content-Type": "application/json" } 
            });
          } catch (err) {
            return new Response(JSON.stringify({ error: "Invalid request body" }), { 
              status: 400, 
              headers: { "Content-Type": "application/json" } 
            });
          }
        }
        
        // GET: Legacy SSE streaming with sessionId query param
        if (req.method === "GET") {
          const sessionId = url.searchParams.get("sessionId");
          if (!sessionId) {
            return new Response(JSON.stringify({ error: "Missing sessionId" }), { status: 400, headers: { "Content-Type": "application/json" } });
          }
          
          const session = sessions.get(sessionId);
          if (!session) {
            return new Response(JSON.stringify({ error: "Session not found", sessionId }), { status: 404, headers: { "Content-Type": "application/json" } });
          }

          const model = new ChatOpenAI({
            model: session.config.model || "grok-code",
            streaming: true,
            configuration: { baseURL: session.config.baseUrl, apiKey: session.config.apiKey },
          });

          return new Response(
            new ReadableStream({
              async start(controller) {
                const encoder = new TextEncoder();
                
                const sendEvent = (event: unknown) => {
                  try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                  } catch (err) {
                    console.error("Error sending SSE event:", err);
                  }
                };
                
                const sendErrorAndClose = (message: string, code?: string) => {
                  try {
                    sendEvent({ type: "RUN_ERROR", message, code, timestamp: Date.now() });
                    controller.close();
                  } catch {
                    controller.close();
                  }
                };
                
                const transport = {
                  emit: async (event: unknown) => { sendEvent(event); },
                };
                
                try {
                  const agent = createAGUIAgent({
                    model,
                    tools: [calculatorTool],
                    transport,
                    middlewareOptions: {
                      emitToolResults: true,
                      emitStateSnapshots: "initial",
                      emitActivities: true,
                      maxUIPayloadSize: 50 * 1024,
                      chunkLargeResults: false,
                      errorDetailLevel: "message",
                    },
                  });

                  const aguiCallback = new AGUICallbackHandler(transport);

                  const eventStream = await (agent as unknown as { streamEvents: (input: { messages: Array<{ role: string; content: string }> }, options: { version: string; callbacks: Array<unknown> }) => AsyncIterable<unknown> }).streamEvents(
                    { messages: session.messages },
                    { version: "v2", callbacks: [aguiCallback] }
                  );

                  for await (const event of eventStream) {
                    if ((event as { event: string }).event === "on_chain_end" && (event as { data?: { output?: { messages?: Array<unknown> } } }).data?.output?.messages) {
                      session.messages = (event as { data: { output: { messages: Array<{ role: string; content: string }> } } }).data.output.messages as Array<{ role: string; content: string }>;
                    }
                  }
                  controller.close();
                } catch (err) {
                  const errorMessage = err instanceof Error ? err.message : String(err);
                  console.error("Agent execution error:", err);
                  sendErrorAndClose(errorMessage, "AGENT_EXECUTION_ERROR");
                }
              },
            }),
            { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } }
          );
        }
      }

      // SSE endpoint
      if (url.pathname === "/chat" && req.method === "GET") {
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) {
          return new Response(JSON.stringify({ error: "Missing sessionId" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        
        const session = sessions.get(sessionId);
        if (!session) {
          return new Response(JSON.stringify({ error: "Session not found", sessionId }), { status: 404, headers: { "Content-Type": "application/json" } });
        }

        const model = new ChatOpenAI({
          model: session.config.model,
          streaming: true,
          configuration: { baseURL: session.config.baseUrl, apiKey: session.config.apiKey },
        });

        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              
              // Helper functions
              const sendEvent = (event: unknown) => {
                try {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                } catch (err) {
                  console.error("Error sending SSE event:", err);
                }
              };
              
              const sendErrorAndClose = (message: string, code?: string) => {
                try {
                  sendEvent({ type: "RUN_ERROR", message, code, timestamp: Date.now() });
                  controller.close();
                } catch {
                  controller.close();
                }
              };
              
              // Transport for AG-UI events
              const transport = {
                emit: async (event: unknown) => { sendEvent(event); },
              };
              
              try {
                const agent = createAGUIAgent({
                  model,
                  tools: [calculatorTool],
                  transport,
                  middlewareOptions: {
                    emitToolResults: true,
                    emitStateSnapshots: "initial",
                    emitActivities: true,
                    maxUIPayloadSize: 50 * 1024,
                    chunkLargeResults: false,
                    errorDetailLevel: "message",
                  },
                });

                const aguiCallback = new AGUICallbackHandler(transport);

                const eventStream = await (agent as unknown as { streamEvents: (input: { messages: Array<{ role: string; content: string }> }, options: { version: string; callbacks: Array<unknown> }) => AsyncIterable<unknown> }).streamEvents(
                  { messages: session.messages },
                  { version: "v2", callbacks: [aguiCallback] }
                );

                for await (const event of eventStream) {
                  if ((event as { event: string }).event === "on_chain_end" && (event as { data?: { output?: { messages?: Array<unknown> } } }).data?.output?.messages) {
                    session.messages = (event as { data: { output: { messages: Array<{ role: string; content: string }> } } }).data.output.messages as Array<{ role: string; content: string }>;
                  }
                }
                controller.close();
              } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                console.error("Agent execution error:", err);
                sendErrorAndClose(errorMessage, "AGENT_EXECUTION_ERROR");
              }
            },
          }),
          { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } }
        );
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
