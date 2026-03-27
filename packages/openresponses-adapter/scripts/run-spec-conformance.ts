#!/usr/bin/env bun

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseSSEStream } from "../contracts/openresponses/compliance-runner/sse-parser.ts";
import type { OpenResponsesCompatibleAgent } from "../src/core/types.ts";
import { createFakeAgent } from "../src/testing/fake-agent.ts";
import {
  createCallbackDrivenAgent,
  simulateIncompleteStream,
  simulateReasoningSummaryStream,
  simulateTextStream,
} from "../tests/helpers/streaming-fixtures.ts";

declare const Bun: typeof import("bun");

const packageRoot = resolve(import.meta.dir, "..");
const distServerPath = pathToFileURL(
  resolve(packageRoot, "dist/server.js")
).href;

function assertCondition(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const buildPackage = async (): Promise<void> => {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "build"],
    cwd: packageRoot,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
};

const startFixtureServer = async (params: {
  agent: OpenResponsesCompatibleAgent;
  timeoutBudgets?: {
    agentExecutionMs?: number;
    previousResponseLoadMs?: number;
    previousResponseSaveMs?: number;
    requestValidationMs?: number;
  };
}) => {
  const { buildOpenResponsesApp } = (await import(
    distServerPath
  )) as typeof import("../src/server/index.ts");

  const app = await buildOpenResponsesApp({
    agent: params.agent,
    ...(params.timeoutBudgets ? { timeoutBudgets: params.timeoutBudgets } : {}),
  });

  const server = Bun.serve({
    fetch(request) {
      return app.fetch(request);
    },
    hostname: "127.0.0.1",
    port: 0,
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    async stop() {
      await server.stop(true);
    },
  };
};

const createJsonHeaders = () => ({
  "content-type": "application/json",
});

const createBaseRequest = () => ({
  model: "test-model",
  input: "Hello",
  tools: [],
  parallel_tool_calls: true,
  stream: true,
  metadata: {},
});

const collectRawSSE = async (
  baseUrl: string,
  body: Record<string, unknown>
) => {
  const response = await fetch(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: createJsonHeaders(),
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  return {
    response,
    raw,
  };
};

const runResponseResourceCompleteness = async (): Promise<void> => {
  const server = await startFixtureServer({ agent: createFakeAgent() });

  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: "POST",
      headers: createJsonHeaders(),
      body: JSON.stringify({
        ...createBaseRequest(),
        stream: false,
        instructions: "Be terse.",
        text: { format: { type: "text" }, verbosity: "medium" },
        reasoning: { effort: "medium", summary: "auto" },
        temperature: 0.3,
        top_p: 0.9,
        presence_penalty: 0,
        frequency_penalty: 0,
        top_logprobs: 0,
        max_output_tokens: 128,
        max_tool_calls: 2,
        store: false,
        background: false,
        service_tier: "default",
        safety_identifier: "safe-1",
        prompt_cache_key: "cache-1",
      }),
    });

    assertCondition(
      response.status === 200,
      "response-resource-complete: expected 200"
    );
    assertCondition(
      response.headers.get("content-type")?.includes("application/json"),
      "response-resource-complete: expected application/json"
    );

    const payload = (await response.json()) as Record<string, unknown>;
    for (const field of [
      "id",
      "object",
      "created_at",
      "completed_at",
      "status",
      "incomplete_details",
      "model",
      "previous_response_id",
      "instructions",
      "output",
      "error",
      "tools",
      "tool_choice",
      "truncation",
      "parallel_tool_calls",
      "text",
      "top_p",
      "presence_penalty",
      "frequency_penalty",
      "top_logprobs",
      "temperature",
      "reasoning",
      "usage",
      "max_output_tokens",
      "max_tool_calls",
      "store",
      "background",
      "service_tier",
      "metadata",
      "safety_identifier",
      "prompt_cache_key",
    ]) {
      assertCondition(
        field in payload,
        `response-resource-complete: missing ${field}`
      );
    }
  } finally {
    await server.stop();
  }
};

const runSseFramingAndOrdering = async (): Promise<void> => {
  const server = await startFixtureServer({
    agent: createCallbackDrivenAgent({ onStream: simulateTextStream }),
  });

  try {
    const parsedResponse = await fetch(`${server.baseUrl}/v1/responses`, {
      method: "POST",
      headers: createJsonHeaders(),
      body: JSON.stringify(createBaseRequest()),
    });
    assertCondition(parsedResponse.status === 200, "sse-framing: expected 200");
    assertCondition(
      parsedResponse.headers.get("content-type")?.includes("text/event-stream"),
      "sse-framing: expected text/event-stream"
    );

    const parsed = await parseSSEStream(parsedResponse);
    assertCondition(
      parsed.errors.length === 0,
      `sse-framing: ${parsed.errors.join("; ")}`
    );

    const types = parsed.events.map((event) => event.event);
    assertCondition(
      JSON.stringify(types.slice(0, 3)) ===
        JSON.stringify([
          "response.created",
          "response.queued",
          "response.in_progress",
        ]),
      "sse-framing: expected created -> queued -> in_progress ordering"
    );

    for (const event of parsed.events) {
      const data = event.data as { type?: string; sequence_number?: number };
      assertCondition(
        event.event === data.type,
        `sse-framing: event header/body mismatch for ${event.event}`
      );
    }

    const sequenceNumbers = parsed.events.map((event) => {
      return (event.data as { sequence_number: number }).sequence_number;
    });
    for (let index = 0; index < sequenceNumbers.length; index++) {
      assertCondition(
        sequenceNumbers[index] === index + 1,
        "sse-framing: expected monotonic sequence_number values"
      );
    }

    const rawResponse = await collectRawSSE(
      server.baseUrl,
      createBaseRequest()
    );
    assertCondition(
      !rawResponse.raw.includes("\nid:"),
      "sse-framing: SSE stream must not emit id fields"
    );
    assertCondition(
      rawResponse.raw.trimEnd().endsWith("data: [DONE]"),
      "sse-framing: stream must terminate with literal [DONE]"
    );
  } finally {
    await server.stop();
  }
};

const runPostStartFailure = async (): Promise<void> => {
  const server = await startFixtureServer({
    agent: createFakeAgent({
      streamChunks: [{ type: "chunk", content: "late" }],
      delay: 30,
    }),
    timeoutBudgets: { agentExecutionMs: 10 },
  });

  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: "POST",
      headers: createJsonHeaders(),
      body: JSON.stringify(createBaseRequest()),
    });

    const parsed = await parseSSEStream(response);
    assertCondition(
      parsed.errors.length === 0,
      `post-start-failure: ${parsed.errors.join("; ")}`
    );

    const types = parsed.events.map((event) => event.event);
    const errorIndex = types.indexOf("error");
    const failedIndex = types.indexOf("response.failed");
    assertCondition(errorIndex >= 0, "post-start-failure: missing error event");
    assertCondition(
      failedIndex > errorIndex,
      "post-start-failure: response.failed must follow error"
    );
    assertCondition(
      parsed.finalResponse?.status === "failed",
      "post-start-failure: final response must be failed"
    );
  } finally {
    await server.stop();
  }
};

const runIncompleteTerminal = async (): Promise<void> => {
  const server = await startFixtureServer({
    agent: createCallbackDrivenAgent({ onStream: simulateIncompleteStream }),
  });

  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: "POST",
      headers: createJsonHeaders(),
      body: JSON.stringify(createBaseRequest()),
    });

    const parsed = await parseSSEStream(response);
    assertCondition(
      parsed.errors.length === 0,
      `incomplete-stream: ${parsed.errors.join("; ")}`
    );
    const incompleteEvent = parsed.events.find((event) => {
      return event.event === "response.incomplete";
    });
    assertCondition(
      incompleteEvent,
      "incomplete-stream: missing response.incomplete"
    );
    assertCondition(
      parsed.finalResponse?.status === "incomplete",
      "incomplete-stream: final response must be incomplete"
    );
  } finally {
    await server.stop();
  }
};

const runReasoningSummaryCoverage = async (): Promise<void> => {
  const server = await startFixtureServer({
    agent: createCallbackDrivenAgent({
      onStream: simulateReasoningSummaryStream,
    }),
  });

  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: "POST",
      headers: createJsonHeaders(),
      body: JSON.stringify(createBaseRequest()),
    });

    const parsed = await parseSSEStream(response);
    assertCondition(
      parsed.errors.length === 0,
      `reasoning-summary: ${parsed.errors.join("; ")}`
    );
    const types = parsed.events.map((event) => event.event);
    for (const type of [
      "response.reasoning_summary_part.added",
      "response.reasoning_summary_text.delta",
      "response.reasoning_summary_text.done",
      "response.reasoning_summary_part.done",
    ]) {
      assertCondition(
        types.includes(type),
        `reasoning-summary: missing ${type}`
      );
    }

    const reasoningItem = parsed.finalResponse?.output.find((item) => {
      return (
        typeof item === "object" && item !== null && item.type === "reasoning"
      );
    }) as { summary?: Array<{ type: string; text: string }> } | undefined;
    assertCondition(
      reasoningItem,
      "reasoning-summary: missing reasoning output item"
    );
    assertCondition(
      reasoningItem.summary?.[0]?.text === "Short answer summary",
      "reasoning-summary: final reasoning item must preserve summary text"
    );
  } finally {
    await server.stop();
  }
};

const checks = [
  {
    id: "response-resource-complete",
    run: runResponseResourceCompleteness,
  },
  {
    id: "sse-framing-and-ordering",
    run: runSseFramingAndOrdering,
  },
  {
    id: "post-start-failure",
    run: runPostStartFailure,
  },
  {
    id: "incomplete-terminal",
    run: runIncompleteTerminal,
  },
  {
    id: "reasoning-summary-coverage",
    run: runReasoningSummaryCoverage,
  },
] as const;

await buildPackage();

const results: Array<{
  id: string;
  status: "passed" | "failed";
  error?: string;
}> = [];

for (const check of checks) {
  try {
    await check.run();
    results.push({ id: check.id, status: "passed" });
  } catch (error) {
    results.push({
      id: check.id,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const failed = results.filter((result) => result.status === "failed");
process.stdout.write(
  `Spec conformance summary: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total\n`
);
for (const result of results) {
  process.stdout.write(
    `${result.id}: ${result.status}${result.error ? ` - ${result.error}` : ""}\n`
  );
}

if (failed.length > 0) {
  process.exit(1);
}
