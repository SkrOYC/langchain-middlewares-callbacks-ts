
import React, { useState, useEffect, useRef } from "react";
import type { AGUITransport } from "../src/index";

// ============================================================================
// Types & Interfaces
// ============================================================================

interface Message {
  id?: string;
  role: "user" | "assistant" | "tool" | "system" | "reasoning";
  content: string;
}

interface AgentConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ToolResult {
  toolCallId: string;
  toolName: string;
  content: string;
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
  .message.reasoning .message-bubble { background: #f0f0f0; color: #666; border-left: 3px solid #ccc; font-style: italic; border-radius: 4px; }
  .message.tool .message-bubble { background: #e8f5e9; color: #2e7d32; border-radius: 4px; font-family: monospace; font-size: 12px; }
  .tool-indicator { background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 8px 12px; font-size: 12px; color: #856404; margin: 8px 0; }
  .tool-result { background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 12px; margin: 8px 0 8px 60px; font-size: 12px; }
  .tool-result-header { font-weight: 600; color: #495057; margin-bottom: 4px; }
  .tool-result-content { font-family: 'SF Mono', Monaco, monospace; color: #28a745; }
  .input-area { display: flex; gap: 12px; padding: 16px; background: white; border-top: 1px solid #e0e0e0; border-radius: 12px; }
  .input-area input { flex: 1; padding: 12px 16px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }
  .btn { padding: 10px 16px; border: none; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; }
  .btn-primary { background: #007aff; color: white; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal-content { background: white; padding: 24px; border-radius: 12px; width: 400px; max-width: 90%; }
  .form-group { margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px; }
  .form-group label { font-size: 12px; color: #666; font-weight: 500; }
  .form-group input { padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; }
`;

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolResults, setToolResults] = useState<ToolResult[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Form State
  const [formBaseUrl, setFormBaseUrl] = useState("https://api.openai.com/v1");
  const [formApiKey, setFormApiKey] = useState("");
  const [formModel, setFormModel] = useState("gpt-4o-mini");

  // Initialize from localStorage
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
    const savedSessionId = localStorage.getItem("agui_session_id");
    if (savedSessionId) setSessionId(savedSessionId);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolResults, activeTool]);

  const saveSettings = () => {
    const newConfig = { baseUrl: formBaseUrl, apiKey: formApiKey, model: formModel };
    setConfig(newConfig);
    localStorage.setItem("agui_config", JSON.stringify(newConfig));
    setIsSettingsOpen(false);
  };

  const handleSend = async () => {
    if (!input.trim() || !config) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setToolResults([]);
    setInput("");

    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [userMsg],
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
    }
  };

  const connectSSE = (id: string) => {
    const eventSource = new EventSource(`/chat?sessionId=${id}`);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case "MESSAGES_SNAPSHOT":
          setMessages(data.messages);
          break;
        case "TEXT_MESSAGE_START":
          setMessages((prev) => [...prev, { id: data.messageId, role: "assistant", content: "" }]);
          break;
        case "TEXT_MESSAGE_CONTENT":
          setMessages((prev) => prev.map(m => 
            m.id === data.messageId ? { ...m, content: m.content + data.delta } : m
          ));
          break;
        case "REASONING_MESSAGE_START":
          setMessages((prev) => [...prev, { id: data.messageId, role: "reasoning", content: "" }]);
          break;
        case "REASONING_MESSAGE_CONTENT":
          setMessages((prev) => prev.map(m => 
            m.id === data.messageId ? { ...m, content: m.content + data.delta } : m
          ));
          break;
        case "TOOL_CALL_START":
          setActiveTool(data.toolCallName);
          // Initialize or update tool result with streaming args placeholder
          setToolResults(prev => {
            const existing = prev.find(tr => tr.toolCallId === data.toolCallId);
            if (existing) return prev;
            return [...prev, { toolCallId: data.toolCallId, toolName: data.toolCallName, content: "" }];
          });
          break;
        case "TOOL_CALL_ARGS":
          setToolResults(prev => prev.map(tr => 
            tr.toolCallId === data.toolCallId ? { ...tr, content: tr.content + data.delta } : tr
          ));
          break;
        case "TOOL_CALL_END":
          setActiveTool(null);
          break;
        case "TOOL_CALL_RESULT":
          setToolResults((prev) => {
            const exists = prev.some(tr => tr.toolCallId === data.toolCallId);
            if (exists) {
              return prev.map(tr => tr.toolCallId === data.toolCallId ? { ...tr, content: data.content } : tr);
            }
            return [...prev, {
              toolCallId: data.toolCallId,
              toolName: data.toolCallName || "Result",
              content: data.content
            }];
          });
          break;
        case "RUN_ERROR":
          alert(`Error: ${data.message}`);
          eventSource.close();
          break;
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };
  };

  return (
    <div className="chat-container">
      {isSettingsOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Configure Agent</h2>
            <div className="form-group">
              <label>Base URL</label>
              <input value={formBaseUrl} onChange={e => setFormBaseUrl(e.target.value)} />
            </div>
            <div className="form-group">
              <label>API Key</label>
              <input type="password" value={formApiKey} onChange={e => setFormApiKey(e.target.value)} placeholder="sk-..." />
            </div>
            <div className="form-group">
              <label>Model</label>
              <input value={formModel} onChange={e => setFormModel(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button className="btn btn-primary" onClick={saveSettings}>Save & Start</button>
              {config && <button className="btn" onClick={() => setIsSettingsOpen(false)}>Cancel</button>}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
        <h3>AG-UI Demo</h3>
        <button className="btn" onClick={() => setIsSettingsOpen(true)}>⚙️ Settings</button>
      </div>

      <div className="messages">
        {messages.map((m, i) => (
          <div key={m.id || i} className={`message ${m.role}`}>
            <div className="message-bubble">{m.content}</div>
          </div>
        ))}
        {activeTool && (
          <div className="tool-indicator">Using tool: {activeTool}</div>
        )}
        {toolResults.map((tr) => (
          <div key={tr.toolCallId} className="tool-result">
            <div className="tool-result-header">Tool: {tr.toolName}</div>
            <div className="tool-result-content">{tr.content}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="input-area">
        <input 
          value={input} 
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && handleSend()}
          placeholder="Type a message..."
          disabled={!config}
        />
        <button className="btn btn-primary" onClick={handleSend} disabled={!config}>Send</button>
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
          operation: { type: "string", enum: ["add", "subtract", "multiply", "divide"] }
        },
        required: ["a", "b", "operation"]
      }
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
              <style dangerouslySetInnerHTML={{ __html: CSS }} />
            </head>
            <body>
              <div id="root"><App /></div>
              <script type="module" src="/client.js"></script>
            </body>
          </html>
        );
        return new Response("<!DOCTYPE html>" + html, { headers: { "Content-Type": "text/html" } });
      }

      // Self-bundle for the browser
      if (url.pathname === "/client.js") {
        const build = await Bun.build({
          entrypoints: [import.meta.filename!],
          target: "browser",
          minify: true,
          define: { 
            "import.meta.main": "false",
            "process.env.NODE_ENV": JSON.stringify("development")
          },
          external: ["react-dom/server", "@langchain/core/tools", "@langchain/openai", "langchain"]
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
          return new Response(JSON.stringify({ sessionId }), { headers: { "Content-Type": "application/json" } });
        }

        if (req.method === "GET") {
          const sessionId = url.searchParams.get("sessionId");
          const session = sessions.get(sessionId || "");
          if (!session) return new Response("Not Found", { status: 404 });

          const model = new ChatOpenAI({
            model: session.config.model,
            streaming: true,
            configuration: { baseURL: session.config.baseUrl, apiKey: session.config.apiKey },
          });

          return new Response(
            new ReadableStream({
              async start(controller) {
                const encoder = new TextEncoder();
                const transport: AGUITransport = {
                  emit: async (event) => {
                    try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch {}
                  }
                };
                const agent = createAGUIAgent({ model, tools: [calculatorTool], transport });
                const aguiCallback = new AGUICallbackHandler(transport);

                const eventStream = await (agent as any).streamEvents(
                  { messages: session.messages },
                  { version: "v2", callbacks: [aguiCallback] }
                );

                for await (const event of eventStream) {
                  if (event.event === "on_chain_end" && event.data?.output?.messages) {
                    session.messages = event.data.output.messages;
                  }
                }
                aguiCallback.dispose();
                controller.close();
              }
            }),
            { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }
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
