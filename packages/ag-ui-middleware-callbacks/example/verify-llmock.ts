#!/usr/bin/env bun

import { type BaseEvent, EventSchemas } from "@ag-ui/core";
import {
  CUSTOM_HOST_HEADER,
  DEFAULT_CUSTOM_HOST_TOKEN,
  type ExampleAgentConfig,
} from "./config";
import { handleCustomHostRequest } from "./custom-host";
import { startExampleLLMock } from "./llmock";
import {
  assertCanonicalEventSequence,
  buildRunAgentInput,
  parseSSEEvents,
  readSSEFrames,
  summarizeEvent,
} from "./runtime";
import { handleChatRequest } from "./server";

type VerifyMode = "default" | "custom-host";

interface VerificationResult {
  mode: VerifyMode;
  prompt: string;
  frames: string[];
  events: BaseEvent[];
}

function printUsage(): void {
  console.log(`Deterministic AG-UI verifier with llmock

Usage:
  bun run verify-llmock.ts
`);
}

function assertOneEventPerFrame(frames: string[], events: BaseEvent[]): void {
  const dataFrames = frames.filter((frame) => frame.startsWith("data: "));
  if (dataFrames.length !== events.length) {
    throw new Error(
      `Expected one AG-UI event per SSE frame, received ${events.length} events across ${dataFrames.length} data frames.`
    );
  }
}

function assertSchemaValid(events: BaseEvent[]): void {
  for (const [index, event] of events.entries()) {
    const result = EventSchemas.safeParse(event);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new Error(
        `Event ${index} (${event.type}) failed AG-UI schema validation: ${issue?.message ?? "unknown error"}.`
      );
    }
  }
}

function assertNoEmptyAssistantMessages(events: BaseEvent[]): void {
  const started = new Set<string>();
  const ended = new Set<string>();
  const contentCounts = new Map<string, number>();

  for (const event of events) {
    if (event.type === "TEXT_MESSAGE_START") {
      started.add(event.messageId);
      continue;
    }

    if (event.type === "TEXT_MESSAGE_CONTENT") {
      contentCounts.set(
        event.messageId,
        (contentCounts.get(event.messageId) ?? 0) + 1
      );
      continue;
    }

    if (event.type === "TEXT_MESSAGE_END") {
      ended.add(event.messageId);
    }
  }

  const emptyMessages = [...started].filter(
    (messageId) => ended.has(messageId) && (contentCounts.get(messageId) ?? 0) === 0
  );

  if (emptyMessages.length > 0) {
    throw new Error(
      `Assistant emitted empty text-message lifecycles for messageIds: ${emptyMessages.join(", ")}.`
    );
  }
}

function assertToolLifecycle(events: BaseEvent[]): void {
  const toolStarts = events.filter((event) => event.type === "TOOL_CALL_START");
  const toolArgs = new Set(
    events
      .filter((event) => event.type === "TOOL_CALL_ARGS")
      .map((event) => event.toolCallId)
  );
  const toolEnds = new Set(
    events
      .filter((event) => event.type === "TOOL_CALL_END")
      .map((event) => event.toolCallId)
  );
  const toolResults = new Set(
    events
      .filter((event) => event.type === "TOOL_CALL_RESULT")
      .map((event) => event.toolCallId)
  );

  if (toolStarts.length === 0) {
    throw new Error("Expected at least one TOOL_CALL_START event.");
  }

  for (const event of toolStarts) {
    if (!toolArgs.has(event.toolCallId)) {
      throw new Error(
        `Missing TOOL_CALL_ARGS for toolCallId ${event.toolCallId}.`
      );
    }

    if (!toolEnds.has(event.toolCallId)) {
      throw new Error(
        `Missing TOOL_CALL_END for toolCallId ${event.toolCallId}.`
      );
    }

    if (!toolResults.has(event.toolCallId)) {
      throw new Error(
        `Missing TOOL_CALL_RESULT for toolCallId ${event.toolCallId}.`
      );
    }
  }
}

async function runScenario(
  mode: VerifyMode,
  prompt: string,
  forwardedConfig: ExampleAgentConfig
): Promise<VerificationResult> {
  const headers = new Headers({
    "Content-Type": "application/json",
  });

  if (mode === "custom-host") {
    headers.set(
      CUSTOM_HOST_HEADER,
      Bun.env.EXAMPLE_AUTH_TOKEN ?? DEFAULT_CUSTOM_HOST_TOKEN
    );
  }

  const request = new Request("https://example.local/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(buildRunAgentInput(prompt, forwardedConfig)),
  });

  const response =
    mode === "custom-host"
      ? await handleCustomHostRequest(request)
      : await handleChatRequest(request);

  if (!response.ok) {
    throw new Error(`Unexpected status ${response.status}: ${await response.text()}`);
  }

  const frames = await readSSEFrames(response);
  const events = parseSSEEvents(frames);

  assertCanonicalEventSequence(events);
  assertOneEventPerFrame(frames, events);
  assertSchemaValid(events);
  assertNoEmptyAssistantMessages(events);

  if (events.at(-1)?.type === "RUN_ERROR") {
    throw new Error("Verifier received RUN_ERROR.");
  }

  return {
    mode,
    prompt,
    frames,
    events,
  };
}

async function run(): Promise<void> {
  const llmock = await startExampleLLMock();

  try {
    const results = [
      await runScenario("default", "Say hello in one short sentence.", llmock.config),
      await runScenario("default", "Calculate 2 + 2", llmock.config),
      await runScenario("custom-host", "Say hello in one short sentence.", llmock.config),
      await runScenario("custom-host", "Calculate 2 + 2", llmock.config),
    ];

    for (const result of results) {
      if (result.prompt === "Calculate 2 + 2") {
        assertToolLifecycle(result.events);
      }

      console.log(`[${result.mode}] ${result.prompt}`);
      console.log(`Frames: ${result.frames.length} Events: ${result.events.length}`);
      for (const event of result.events) {
        console.log(`  ${summarizeEvent(event)}`);
      }
      console.log("");
    }

    console.log(`LLMock requests captured: ${llmock.getRequests().length}`);
    console.log("Deterministic verifier passed.");
  } finally {
    await llmock.stop();
  }
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printUsage();
  process.exit(0);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
