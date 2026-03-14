import { type BaseEvent, EventSchemas } from "@ag-ui/core";
import {
  CUSTOM_HOST_HEADER,
  DEFAULT_AGENT_CONFIG,
  DEFAULT_CUSTOM_HOST_TOKEN,
  type ExampleAgentConfig,
} from "./config";
import { handleCustomHostRequest } from "./custom-host";
import {
  assertCanonicalEventSequence,
  buildRunAgentInput,
  parseSSEEvents,
  readSSEFrames,
  summarizeEvent,
} from "./runtime";
import { handleChatRequest } from "./server";

export type VerifyMode = "default" | "custom-host";

export interface VerificationOptions {
  mode: VerifyMode;
  prompt: string;
  config?: Partial<ExampleAgentConfig>;
  authToken?: string;
}

export interface ValidationIssue {
  index: number;
  type: string;
  issues: string[];
}

export interface VerificationAudit {
  emptyAssistantMessages: string[];
  toolCallsWithoutArgs: string[];
  reasoningStartsAfterTextMessages: boolean;
  invalidEvents: ValidationIssue[];
}

export interface VerificationResult {
  frames: string[];
  events: BaseEvent[];
  audit: VerificationAudit;
}

export function envConfig(): ExampleAgentConfig {
  return {
    provider:
      Bun.env.EXAMPLE_PROVIDER === "openai-compatible"
        ? "openai-compatible"
        : DEFAULT_AGENT_CONFIG.provider,
    baseUrl: Bun.env.EXAMPLE_BASE_URL ?? DEFAULT_AGENT_CONFIG.baseUrl,
    apiKey: Bun.env.EXAMPLE_API_KEY ?? DEFAULT_AGENT_CONFIG.apiKey,
    model: Bun.env.EXAMPLE_MODEL ?? DEFAULT_AGENT_CONFIG.model,
    useResponsesApi: Bun.env.EXAMPLE_USE_RESPONSES_API === "true",
    outputVersion:
      Bun.env.EXAMPLE_OUTPUT_VERSION === "v1"
        ? "v1"
        : DEFAULT_AGENT_CONFIG.outputVersion,
  };
}

function buildHeaders(mode: VerifyMode, authToken?: string): Headers {
  const headers = new Headers({
    "Content-Type": "application/json",
  });

  if (mode === "custom-host") {
    headers.set(
      CUSTOM_HOST_HEADER,
      authToken ?? Bun.env.EXAMPLE_AUTH_TOKEN ?? DEFAULT_CUSTOM_HOST_TOKEN
    );
  }

  return headers;
}

function assertOneEventPerFrame(frames: string[]): void {
  for (const [index, frame] of frames.entries()) {
    const dataLines = frame
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith("data: "));

    if (dataLines.length !== 1) {
      throw new Error(
        `Expected exactly one data line in frame ${index}, received ${dataLines.length}.`
      );
    }
  }
}

function validateEvents(events: BaseEvent[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [index, event] of events.entries()) {
    const result = EventSchemas.safeParse(event);
    if (!result.success) {
      issues.push({
        index,
        type: event.type,
        issues: result.error.issues.map(
          (issue) =>
            `${issue.path.join(".") || "<root>"}: ${issue.message}`
        ),
      });
    }
  }

  return issues;
}

function auditEvents(events: BaseEvent[]): VerificationAudit {
  const messageHasContent = new Map<string, boolean>();
  const messageHasEnd = new Map<string, boolean>();
  const toolCallHasArgs = new Map<string, boolean>();
  const toolCallHasEnd = new Map<string, boolean>();
  const eventTypes = events.map((event) => event.type);

  for (const event of events) {
    if (event.type === "TEXT_MESSAGE_START") {
      messageHasContent.set(event.messageId, false);
      messageHasEnd.set(event.messageId, false);
      continue;
    }

    if (event.type === "TEXT_MESSAGE_CONTENT") {
      messageHasContent.set(event.messageId, true);
      continue;
    }

    if (event.type === "TEXT_MESSAGE_END") {
      messageHasEnd.set(event.messageId, true);
      continue;
    }

    if (event.type === "TOOL_CALL_START") {
      toolCallHasArgs.set(event.toolCallId, false);
      toolCallHasEnd.set(event.toolCallId, false);
      continue;
    }

    if (event.type === "TOOL_CALL_ARGS") {
      toolCallHasArgs.set(event.toolCallId, true);
      continue;
    }

    if (event.type === "TOOL_CALL_END") {
      toolCallHasEnd.set(event.toolCallId, true);
    }
  }

  return {
    emptyAssistantMessages: [...messageHasContent.entries()]
      .filter(([messageId, hasContent]) => hasContent === false && messageHasEnd.get(messageId))
      .map(([messageId]) => messageId),
    toolCallsWithoutArgs: [...toolCallHasArgs.entries()]
      .filter(([toolCallId, hasArgs]) => hasArgs === false && toolCallHasEnd.get(toolCallId))
      .map(([toolCallId]) => toolCallId),
    reasoningStartsAfterTextMessages:
      eventTypes.includes("REASONING_START") &&
      eventTypes.includes("TEXT_MESSAGE_START") &&
      eventTypes.indexOf("REASONING_START") >
        eventTypes.indexOf("TEXT_MESSAGE_START"),
    invalidEvents: validateEvents(events),
  };
}

export async function runExampleVerification(
  options: VerificationOptions
): Promise<VerificationResult> {
  const input = buildRunAgentInput(options.prompt, options.config);
  const request = new Request("https://example.local/chat", {
    method: "POST",
    headers: buildHeaders(options.mode, options.authToken),
    body: JSON.stringify(input),
  });

  const response =
    options.mode === "custom-host"
      ? await handleCustomHostRequest(request)
      : await handleChatRequest(request);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Unexpected status ${response.status}: ${body}`);
  }

  const frames = await readSSEFrames(response);
  assertOneEventPerFrame(frames);

  const events = parseSSEEvents(frames);
  assertCanonicalEventSequence(events);

  return {
    frames,
    events,
    audit: auditEvents(events),
  };
}

export function assertVerificationResult(
  result: VerificationResult,
  options: {
    expectToolCallArgs?: boolean;
    allowEmptyAssistantMessages?: boolean;
    allowReasoningAfterText?: boolean;
  } = {}
): void {
  if (result.audit.invalidEvents.length > 0) {
    const detail = result.audit.invalidEvents
      .map(
        (issue) =>
          `#${issue.index} ${issue.type}: ${issue.issues.join("; ")}`
      )
      .join("\n");
    throw new Error(`Invalid AG-UI events detected:\n${detail}`);
  }

  if (
    options.expectToolCallArgs &&
    result.audit.toolCallsWithoutArgs.length > 0
  ) {
    throw new Error(
      `Expected TOOL_CALL_ARGS for tool-call trace, but none were emitted for ${result.audit.toolCallsWithoutArgs.join(", ")}.`
    );
  }

  if (
    options.allowEmptyAssistantMessages !== true &&
    result.audit.emptyAssistantMessages.length > 0
  ) {
    throw new Error(
      `Observed empty assistant text message lifecycle for ${result.audit.emptyAssistantMessages.join(", ")}.`
    );
  }

  if (
    options.allowReasoningAfterText !== true &&
    result.audit.reasoningStartsAfterTextMessages
  ) {
    throw new Error(
      "Observed REASONING_START after TEXT_MESSAGE_START; reasoning must be emitted before assistant text."
    );
  }
}

export function printVerificationResult(
  label: string,
  result: VerificationResult
): void {
  console.log(label);
  console.log(`Frames: ${result.frames.length}`);
  console.log(`Events: ${result.events.length}`);
  console.log("");

  for (const event of result.events) {
    console.log(summarizeEvent(event));
  }

  console.log("");
  console.log(
    `Schema-valid events: ${result.events.length - result.audit.invalidEvents.length}/${result.events.length}`
  );
  console.log(
    `Empty assistant messages: ${result.audit.emptyAssistantMessages.length}`
  );
  console.log(
    `Tool calls without args: ${result.audit.toolCallsWithoutArgs.length}`
  );
  console.log(
    `Reasoning before text: ${result.audit.reasoningStartsAfterTextMessages ? "no" : "yes"}`
  );
}
