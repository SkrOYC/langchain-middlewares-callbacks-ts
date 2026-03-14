import { HttpAgent, type AgentSubscriber } from "@ag-ui/client";
import {
  type ExampleAgentConfig,
  DEFAULT_AGENT_CONFIG,
} from "./config";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

interface ToolCallState {
  id: string;
  name: string;
  args: string;
  result: string;
}

const storageKey = "agui-example-config";

const providerSelect = document.getElementById("provider") as HTMLSelectElement;
const baseUrlInput = document.getElementById("base-url") as HTMLInputElement;
const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const modelInput = document.getElementById("model") as HTMLInputElement;
const promptInput = document.getElementById("prompt") as HTMLTextAreaElement;
const sendButton = document.getElementById("send") as HTMLButtonElement;
const abortButton = document.getElementById("abort") as HTMLButtonElement;
const statusNode = document.getElementById("status") as HTMLDivElement;
const messagesNode = document.getElementById("messages") as HTMLDivElement;
const toolsNode = document.getElementById("tools") as HTMLDivElement;

const threadId = `thread_${crypto.randomUUID()}`;
const agent = new HttpAgent({
  url: "/chat",
  threadId,
});

let messages: ChatMessage[] = [];
let toolCalls = new Map<string, ToolCallState>();
let isRunning = false;
let strictPathConfig = {
  useResponsesApi: DEFAULT_AGENT_CONFIG.useResponsesApi,
  outputVersion: DEFAULT_AGENT_CONFIG.outputVersion,
};

function loadConfig(): ExampleAgentConfig {
  const rawConfig = localStorage.getItem(storageKey);
  if (!rawConfig) {
    return DEFAULT_AGENT_CONFIG;
  }

  try {
    return {
      ...DEFAULT_AGENT_CONFIG,
      ...(JSON.parse(rawConfig) as Partial<ExampleAgentConfig>),
    };
  } catch {
    return DEFAULT_AGENT_CONFIG;
  }
}

function saveConfig(config: ExampleAgentConfig): void {
  localStorage.setItem(storageKey, JSON.stringify(config));
}

function currentConfig(): ExampleAgentConfig {
  return {
    provider: providerSelect.value as ExampleAgentConfig["provider"],
    baseUrl: baseUrlInput.value,
    apiKey: apiKeyInput.value,
    model: modelInput.value,
    useResponsesApi: strictPathConfig.useResponsesApi,
    outputVersion: strictPathConfig.outputVersion,
  };
}

function setStatus(message: string): void {
  statusNode.textContent = message;
}

function renderMessages(): void {
  messagesNode.innerHTML = "";

  for (const message of messages) {
    const wrapper = document.createElement("article");
    wrapper.className = `message ${message.role}`;

    const title = document.createElement("div");
    title.className = "message-title";
    title.textContent = message.role;

    const body = document.createElement("div");
    body.textContent = message.content;

    wrapper.append(title, body);
    messagesNode.append(wrapper);
  }
}

function renderTools(): void {
  toolsNode.innerHTML = "";
  if (toolCalls.size === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "hint";
    emptyState.textContent = "No tool activity yet.";
    toolsNode.append(emptyState);
    return;
  }

  for (const toolCall of toolCalls.values()) {
    const wrapper = document.createElement("article");
    wrapper.className = "tool-card";

    const title = document.createElement("div");
    title.className = "tool-title";
    title.textContent = toolCall.name;

    const args = document.createElement("pre");
    args.textContent = toolCall.args || "(waiting for args)";

    const result = document.createElement("pre");
    result.textContent = toolCall.result || "(running)";

    wrapper.append(title, args, result);
    toolsNode.append(wrapper);
  }
}

function syncMessagesFromAgent(): void {
  const nextMessages = ((agent as unknown as { messages?: unknown[] }).messages ??
    []) as Array<Record<string, unknown>>;

  messages = nextMessages
    .filter(
      (message) =>
        (message.role === "assistant" || message.role === "user") &&
        typeof message.id === "string" &&
        typeof message.content === "string"
    )
    .map((message) => ({
      id: message.id as string,
      role: message.role as ChatMessage["role"],
      content: message.content as string,
    }));
}

function updateControls(): void {
  sendButton.disabled = isRunning;
  abortButton.disabled = !isRunning;

  const isMock = providerSelect.value === "mock";
  baseUrlInput.disabled = isMock;
  apiKeyInput.disabled = isMock;
  modelInput.disabled = isMock;
}

function seedConfig(config: ExampleAgentConfig): void {
  strictPathConfig = {
    useResponsesApi: config.useResponsesApi,
    outputVersion: config.outputVersion,
  };
  providerSelect.value = config.provider;
  baseUrlInput.value = config.baseUrl;
  apiKeyInput.value = config.apiKey;
  modelInput.value = config.model;
  updateControls();
}

async function sendPrompt(): Promise<void> {
  const prompt = promptInput.value.trim();
  if (!prompt || isRunning) {
    return;
  }

  const config = currentConfig();
  saveConfig(config);

  const userMessage: ChatMessage = {
    id: `message_${crypto.randomUUID()}`,
    role: "user",
    content: prompt,
  };

  messages = [...messages, userMessage];
  (agent as unknown as { messages?: ChatMessage[] }).messages = messages;
  toolCalls = new Map();
  renderMessages();
  renderTools();

  isRunning = true;
  updateControls();
  setStatus("Streaming response...");

  const subscriber: AgentSubscriber = {
    onTextMessageStartEvent: ({ event }) => {
      messages = [
        ...messages,
        {
          id: event.messageId,
          role: "assistant",
          content: "",
        },
      ];
      renderMessages();
    },
    onTextMessageContentEvent: ({ event, textMessageBuffer }) => {
      messages = messages.map((message) =>
        message.id === event.messageId
          ? { ...message, content: textMessageBuffer }
          : message
      );
      renderMessages();
    },
    onToolCallStartEvent: ({ event }) => {
      toolCalls.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolCallName,
        args: "",
        result: "",
      });
      renderTools();
    },
    onToolCallArgsEvent: ({ event, toolCallBuffer }) => {
      const toolCall = toolCalls.get(event.toolCallId);
      if (!toolCall) {
        return;
      }

      toolCalls.set(event.toolCallId, {
        ...toolCall,
        args: toolCallBuffer,
      });
      renderTools();
    },
    onToolCallResultEvent: ({ event }) => {
      const toolCall = toolCalls.get(event.toolCallId);
      if (!toolCall) {
        return;
      }

      toolCalls.set(event.toolCallId, {
        ...toolCall,
        result: String(event.content),
      });
      renderTools();
    },
  };

  try {
    const result = await agent.runAgent(
      {
        runId: `run_${crypto.randomUUID()}`,
        tools: [],
        context: [],
        forwardedProps: config,
      },
      subscriber
    );

    syncMessagesFromAgent();
    renderMessages();
    setStatus(`Completed. ${result.newMessages.length} new message(s).`);
  } catch (error) {
    messages = [
      ...messages,
      {
        id: `error_${crypto.randomUUID()}`,
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
    renderMessages();
    setStatus("Run failed.");
  } finally {
    isRunning = false;
    updateControls();
  }
}

function abortRun(): void {
  agent.abortRun();
  setStatus("Abort requested.");
}

seedConfig(loadConfig());
renderMessages();
renderTools();
setStatus("Ready.");

providerSelect.addEventListener("change", () => {
  updateControls();
  saveConfig(currentConfig());
});

for (const input of [baseUrlInput, apiKeyInput, modelInput]) {
  input.addEventListener("change", () => saveConfig(currentConfig()));
}

sendButton.addEventListener("click", () => {
  void sendPrompt();
});

abortButton.addEventListener("click", abortRun);

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    void sendPrompt();
  }
});
