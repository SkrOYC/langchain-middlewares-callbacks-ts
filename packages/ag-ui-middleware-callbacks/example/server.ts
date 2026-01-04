/**
 * AG-UI Middleware Callbacks Example Server
 * 
 * Minimal HTTP server demonstrating AG-UI protocol compliance
 * with the ag-ui-middleware-callbacks package.
 */

import { createAgent, tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import {
  createAGUIAgent,
  type AGUITransport,
  AGUICallbackHandler,
} from "../src/index";

// ============================================================================
// Session Management (In-Memory)
// ============================================================================

interface Session {
  id: string;
  config: AgentConfig;
  messages: Array<{ role: string; content: string }>;
}

interface AgentConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
  config: AgentConfig;
  sessionId?: string;
}

const sessions = new Map<string, Session>();

function generateSessionId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// ============================================================================
// Tools
// ============================================================================

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
    return `The result of ${a} ${operation} ${b} is ${result}`;
  },
  {
    name: "calculator",
    description: "Perform basic arithmetic operations",
    schema: {
      type: "object",
      properties: {
        a: { type: "number", description: "First number" },
        b: { type: "number", description: "Second number" },
        operation: {
          type: "string",
          description: "Operation: add, subtract, multiply, divide",
          enum: ["add", "subtract", "multiply", "divide"],
        },
      },
      required: ["a", "b", "operation"],
    },
  }
);

const echoTool = tool(
  async ({ text }: { text: string }) => {
    return `You said: "${text}"`;
  },
  {
    name: "echo",
    description: "Echoes back the input text",
    schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to echo" },
      },
      required: ["text"],
    },
  }
);

// ============================================================================
// HTTP Server
// ============================================================================

const PORT = 3000;

// GET / → Serve the HTML client
const GET_INDEX = async (request: Request): Promise<Response> => {
  return new Response(Bun.file("./public/index.html"), {
    headers: { "Content-Type": "text/html" },
  });
};

  // POST /chat → Create or update session, trigger agent execution
const POST_CHAT = async (request: Request): Promise<Response> => {
  try {
    const body = (await request.json()) as ChatRequest;
    
    console.log('POST /chat received:', JSON.stringify(body, null, 2));
    
    // Validate request - require config for new sessions
    if (!body.sessionId && (!body.config?.baseUrl || !body.config?.model)) {
      return new Response(
        JSON.stringify({ error: "Missing baseUrl or model for new session" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let sessionId = body.sessionId;
    let session: Session;

    if (sessionId && sessions.has(sessionId)) {
      // Existing session - append new messages
      session = sessions.get(sessionId)!;
      
      // Add new user messages to session
      const newMessages = body.messages || [];
      for (const msg of newMessages) {
        if (msg.role === 'user') {
          session.messages.push(msg);
        }
      }
    } else {
      // New session - create with provided config and messages
      sessionId = generateSessionId();
      
      console.log('Creating new session with config:', JSON.stringify(body.config, null, 2));
      
      session = {
        id: sessionId,
        config: body.config!,
        messages: body.messages || [],
      };
      sessions.set(sessionId, session);
    }

    return new Response(JSON.stringify({ sessionId }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error handling chat request:", error);
    return new Response(
      JSON.stringify({ error: `Failed: ${error}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

// GET /chat?sessionId=xxx → SSE endpoint with agent execution
const GET_CHAT_STREAM = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    return new Response("Missing sessionId", { status: 400 });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return new Response("Session not found", { status: 404 });
  }

  // Set SSE headers
  const headers = new Headers();
  headers.set("Content-Type", "text/event-stream");
  headers.set("Cache-Control", "no-cache");
  headers.set("Connection", "keep-alive");

  // Create model with explicit streaming enabled
  const model = new ChatOpenAI({
    model: session.config.model,
    streaming: true,  // Enable streaming for token callbacks
    configuration: {
      baseURL: session.config.baseUrl,
      apiKey: session.config.apiKey,
    },
  });

  console.log('ChatOpenAI created with:', {
    model: session.config.model,
    baseURL: session.config.baseUrl,
    // Don't log API key for security
  });

  // Return streaming response
  return new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let streamCompleted = false;

        // Safety timeout - close stream after 15 seconds
        const timeoutId = setTimeout(() => {
          if (!streamCompleted) {
            console.log('Stream timeout - closing');
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "RUN_ERROR", message: "Request timeout" })}\n\n`));
              controller.close();
            } catch {
              // Already closed
            }
          }
        }, 15000);

        try {
          // Create AG-UI transport
          const transport: AGUITransport = {
            emit: async (event) => {
              const data = `data: ${JSON.stringify(event)}\n\n`;
              try {
                controller.enqueue(encoder.encode(data));
              } catch {
                // Stream closed
              }
            },
          };

          // Create agent with AG-UI middleware
          const agent = createAGUIAgent({
            model,
            tools: [calculatorTool, echoTool],
            transport,
            middlewareOptions: {
              errorDetailLevel: "message",
              emitStateSnapshots: "initial",
            },
          });

          // Create callback handler for streaming events
          const aguiCallback = new AGUICallbackHandler(transport);

          // Run agent with streamEvents for token-level streaming
          // streamEvents() triggers handleLLMNewToken callbacks for TEXT_MESSAGE_CONTENT
          const eventStream = await (agent as any).streamEvents(
            { messages: session.messages },
            {
              configurable: { thread_id: sessionId },
              version: "v2",
              callbacks: [aguiCallback],
            }
          );

          // Consume the stream - middleware and callbacks emit all events automatically
          for await (const _event of eventStream) {
            // No manual event handling needed - AG-UI middleware + callbacks handle everything:
            // - RUN_STARTED, RUN_FINISHED, STATE_SNAPSHOT (middleware)
            // - TEXT_MESSAGE_START/END, STEP_STARTED/FINISHED (callbacks)
            // - TEXT_MESSAGE_CONTENT, TOOL_CALL_ARGS, TOOL_CALL_START/END/RESULT (callbacks)
          }

          // Cleanup callback handler
          aguiCallback.dispose();

          // Clean up session after stream completes
          sessions.delete(sessionId);
          
          streamCompleted = true;
          clearTimeout(timeoutId);
          controller.close();
        } catch (error) {
          streamCompleted = true;
          clearTimeout(timeoutId);
          
          const errorEvent = {
            type: "RUN_ERROR",
            message: error instanceof Error ? error.message : String(error),
          };
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
            controller.close();
          } catch {
            // Stream closed
          }
        }
      },
    }),
    { headers }
  );
};

// Main request handler
const handleRequest = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname === "/" && request.method === "GET") {
    return GET_INDEX(request);
  }

  if (url.pathname === "/chat") {
    if (request.method === "POST") {
      return POST_CHAT(request);
    }
    if (request.method === "GET") {
      return GET_CHAT_STREAM(request);
    }
  }

  return new Response("Not Found", { status: 404 });
};

// Start server
console.log(`🚀 AG-UI Example Server running at http://localhost:${PORT}`);
console.log(`📝 Open http://localhost:${PORT} in your browser`);

Bun.serve({
  port: PORT,
  fetch: handleRequest,
});
