import { type AgentSubscriber, HttpAgent, RunAgentInput } from "@ag-ui/client";
import React, { useCallback, useEffect, useRef, useState } from "react";

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
  .message-content { line-height: 1.6; }
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

interface Message {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
}

interface ToolCall {
	id: string;
	name: string;
	args: string;
	result?: string;
}

// ============================================================================
// React Components (UI)
// ============================================================================

function App() {
	const [messages, setMessages] = useState<Message[]>([]);
	const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
	const [input, setInput] = useState("");
	const [config, setConfig] = useState<AgentConfig | null>(null);
	const [isRunning, setIsRunning] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// Form State
	const [formBaseUrl, setFormBaseUrl] = useState("https://opencode.ai/zen/v1");
	const [formApiKey, setFormApiKey] = useState("");
	const [formModel, setFormModel] = useState("grok-code");

	// Agent ref
	const agentRef = useRef<HttpAgent | null>(null);

	// Load saved config
	useEffect(() => {
		const savedConfig = localStorage.getItem("agui_config");
		if (savedConfig) {
			const parsed = JSON.parse(savedConfig);
			setConfig(parsed);
			setFormBaseUrl(parsed.baseUrl);
			setFormApiKey(parsed.apiKey);
			setFormModel(parsed.model);
		} else {
			// Use defaults if no saved config
			const defaultConfig = {
				baseUrl: formBaseUrl,
				apiKey: formApiKey,
				model: formModel,
			};
			setConfig(defaultConfig);
		}
	}, []);

	// Scroll to bottom
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, toolCalls]);

	const saveSettings = () => {
		const newConfig = {
			baseUrl: formBaseUrl,
			apiKey: formApiKey,
			model: formModel,
		};
		setConfig(newConfig);
		localStorage.setItem("agui_config", JSON.stringify(newConfig));
	};

	// Initialize agent
	useEffect(() => {
		if (!config) return;

		const agent = new HttpAgent({
			url: "/chat",
		});

		agentRef.current = agent;
	}, [config]);

	const handleSend = useCallback(async () => {
		if (!input.trim() || !agentRef.current || !config) return;

		const userMessage: Message = {
			id: crypto.randomUUID(),
			role: "user",
			content: input,
		};

		setMessages((prev) => [...prev, userMessage]);
		setInput("");
		setIsRunning(true);
		setToolCalls([]);

		try {
			// Set messages on agent instance
			agentRef.current.messages = [userMessage];

			// Create subscriber for real-time event handling
			const subscriber: AgentSubscriber = {
				onTextMessageStartEvent: ({ event }) => {
					setMessages((prev) => [
						...prev,
						{
							id: event.messageId,
							role: "assistant",
							content: "",
						},
					]);
				},
				onTextMessageContentEvent: ({ event, textMessageBuffer }) => {
					setMessages((prev) =>
						prev.map((msg) =>
							msg.id === event.messageId
								? { ...msg, content: textMessageBuffer }
								: msg,
						),
					);
				},
				onToolCallStartEvent: ({ event }) => {
					setToolCalls((prev) => [
						...prev,
						{
							id: event.toolCallId,
							name: event.toolCallName || "Unknown Tool",
							args: "",
						},
					]);
				},
				onToolCallArgsEvent: ({ event, toolCallBuffer }) => {
					setToolCalls((prev) =>
						prev.map((tool) =>
							tool.id === event.toolCallId
								? { ...tool, args: toolCallBuffer }
								: tool,
						),
					);
				},
				onToolCallResultEvent: ({ event }) => {
					setToolCalls((prev) =>
						prev.map((tool) =>
							tool.id === event.toolCallId
								? { ...tool, result: String(event.content) }
								: tool,
						),
					);
				},
			};

			// Run agent with subscriber
			await agentRef.current.runAgent(
				{
					forwardedProps: {
						baseUrl: config.baseUrl,
						apiKey: config.apiKey,
						model: config.model,
					},
				},
				subscriber,
			);
		} catch (err) {
			console.error("Failed to send:", err);
			setMessages((prev) => [
				...prev,
				{
					id: crypto.randomUUID(),
					role: "assistant",
					content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
				},
			]);
		} finally {
			setIsRunning(false);
		}
	}, [input, config]);

	return (
		<div className="chat-container">
			<div className="header">
				<div>
					<h3>AG-UI Demo</h3>
				</div>
				<button
					className="settings-btn"
					onClick={() => setFormBaseUrl(formBaseUrl)}
				>
					Settings
				</button>
			</div>

			<div className="messages">
				{messages.map((message) => (
					<div key={message.id} className={`message ${message.role}`}>
						<div className="message-bubble">
							<div className="message-content">{message.content}</div>
						</div>
					</div>
				))}

				{toolCalls.map((tool) => (
					<div key={tool.id} className="tool-result">
						<div className="tool-result-header">
							{!tool.result && <span className="tool-spinner" />}
							{tool.result ? (
								<>Tool: {tool.name}</>
							) : (
								<span className="tool-loading">Running: {tool.name}</span>
							)}
						</div>
						{tool.args && <div className="tool-args">Args: {tool.args}</div>}
						{tool.result && (
							<div className="tool-result-content">{tool.result}</div>
						)}
					</div>
				))}

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
				<button
					className="btn btn-primary"
					onClick={handleSend}
					disabled={!config || isRunning}
				>
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

	// In-memory session storage
	const sessions = new Map<
		string,
		{ messages: Array<{ role: string; content: string }> }
	>();

	// Calculator tool
	const calculatorTool = tool(
		async ({
			a,
			b,
			operation,
		}: {
			a: number;
			b: number;
			operation: string;
		}) => {
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
			description: "Perform arithmetic operations",
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
		},
	);

	// Import map JSON (pre-serialized to avoid JSX escaping)
	const importMapJson = JSON.stringify({
		imports: {
			"@ag-ui/client": "https://cdn.jsdelivr.net/npm/@ag-ui/client@0.0.42/+esm",
		},
	});

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
							<link
								rel="icon"
								href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>AG</text></svg>"
							/>
							<script
								type="importmap"
								dangerouslySetInnerHTML={{ __html: importMapJson }}
							/>
							<style dangerouslySetInnerHTML={{ __html: CSS }} />
						</head>
						<body>
							<div id="root">
								<App />
							</div>
							<script type="module" src="/client.js"></script>
						</body>
					</html>,
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

			// AG-UI Chat endpoint (POST only - always returns SSE)
			if (url.pathname === "/chat" && req.method === "POST") {
				try {
					const body = await req.json();
					const bodyAny = body as Record<string, unknown>;
					const messages = bodyAny.messages as Array<{
						role: string;
						content: string;
					}>;
					const threadId =
						(bodyAny.threadId as string) || Math.random().toString(36).slice(2);

					// Read config from forwardedProps
					const forwardedProps = (bodyAny.forwardedProps || {}) as Record<
						string,
						string
					>;
					const config: AgentConfig = {
						baseUrl: forwardedProps.baseUrl || "https://opencode.ai/zen/v1",
						apiKey: forwardedProps.apiKey || "",
						model: forwardedProps.model || "grok-code",
					};

					// Get or create session
					let session = sessions.get(threadId);
					if (!session) {
						session = { messages: [] };
						sessions.set(threadId, session);
					}

					// Add new messages to session
					session.messages.push(...messages);

					// Create model
					const modelOptions: ConstructorParameters<typeof ChatOpenAI>[0] = {
						model: config.model || "grok-code",
						streaming: true,
						configuration: {
							baseURL: config.baseUrl,
							apiKey: config.apiKey, // Empty string is valid for some endpoints
						},
					};

					const model = new ChatOpenAI(modelOptions);

					// Return SSE stream
					return new Response(
						new ReadableStream({
							async start(controller) {
								const encoder = new TextEncoder();

								const sendEvent = (event: unknown) => {
									try {
										controller.enqueue(
											encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
										);
									} catch (err) {
										console.error("Error sending SSE event:", err);
									}
								};

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

								const transport = {
									emit: async (event: unknown) => {
										sendEvent(event);
									},
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

									const eventStream = await (
										agent as unknown as {
											streamEvents: (
												input: {
													messages: Array<{ role: string; content: string }>;
												},
												options: { version: string; callbacks: Array<unknown> },
											) => AsyncIterable<unknown>;
										}
									).streamEvents(
										{ messages: session!.messages },
										{ version: "v2", callbacks: [aguiCallback] },
									);

									for await (const event of eventStream) {
										if (
											(event as { event: string }).event === "on_chain_end" &&
											(
												event as {
													data?: { output?: { messages?: Array<unknown> } };
												}
											).data?.output?.messages
										) {
											session!.messages = (
												event as {
													data: {
														output: {
															messages: Array<{
																role: string;
																content: string;
															}>;
														};
													};
												}
											).data.output.messages as Array<{
												role: string;
												content: string;
											}>;
										}
									}

									controller.close();
								} catch (err) {
									const errorMessage =
										err instanceof Error ? err.message : String(err);
									console.error("Agent execution error:", err);
									sendErrorAndClose(errorMessage, "AGENT_EXECUTION_ERROR");
								}
							},
						}),
						{
							headers: {
								"Content-Type": "text/event-stream",
								"Cache-Control": "no-cache",
								Connection: "keep-alive",
							},
						},
					);
				} catch (err) {
					return new Response(
						JSON.stringify({ error: "Invalid request body" }),
						{
							status: 400,
							headers: { "Content-Type": "application/json" },
						},
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
