#!/usr/bin/env bun

import { HumanMessage } from "@langchain/core/messages";
import { concat } from "@langchain/core/utils/stream";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createExampleModel } from "./runtime";
import { envConfig } from "./verification";

interface FixtureChunk {
  token: string;
  message: Record<string, unknown>;
}

interface ChatModelFixture {
  capturedAt: string;
  provider: string;
  baseUrl: string;
  model: string;
  prompt: string;
  useResponsesApi: boolean;
  outputVersion: "v0" | "v1";
  chunks: FixtureChunk[];
  finalMessage: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPlainRecord(value: unknown): Record<string, unknown> {
  const json = JSON.stringify(value);
  return json ? (JSON.parse(json) as Record<string, unknown>) : {};
}

function normalizeMessage(value: unknown): Record<string, unknown> {
  const message = value as {
    id?: string;
    content?: unknown;
    contentBlocks?: unknown;
    additional_kwargs?: unknown;
    response_metadata?: unknown;
    tool_call_chunks?: unknown;
    tool_calls?: unknown;
    invalid_tool_calls?: unknown;
  };

  return {
    ...(typeof message.id === "string" ? { id: message.id } : {}),
    content: toPlainRecord({ value: message.content }).value,
    contentBlocks: toPlainRecord({ value: message.contentBlocks }).value,
    additional_kwargs: toPlainRecord({ value: message.additional_kwargs }).value,
    response_metadata: toPlainRecord({ value: message.response_metadata }).value,
    tool_call_chunks: toPlainRecord({ value: message.tool_call_chunks }).value,
    tool_calls: toPlainRecord({ value: message.tool_calls }).value,
    invalid_tool_calls: toPlainRecord({ value: message.invalid_tool_calls }).value,
  };
}

function getTokenDelta(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((entry) => (isRecord(entry) ? entry : undefined))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter(
      (entry) => entry.type === "text" && typeof entry.text === "string"
    )
    .map((entry) => entry.text as string)
    .join("");
}

const prompt =
  process.argv[2] ??
  "Think step by step and then answer: what is 37 * 19? Put the final answer on its own line.";

const config = {
  ...envConfig(),
  useResponsesApi: true,
  outputVersion: "v1" as const,
};

const model = createExampleModel(config);
const stream = await model.stream([new HumanMessage(prompt)]);

const chunks: FixtureChunk[] = [];
let finalChunk: unknown;

for await (const chunk of stream) {
  finalChunk = finalChunk ? concat(finalChunk as never, chunk as never) : chunk;
  const plainChunk = normalizeMessage(chunk);
  chunks.push({
    token: getTokenDelta(plainChunk),
    message: plainChunk,
  });
}

const fixture: ChatModelFixture = {
  capturedAt: new Date().toISOString(),
  provider: config.provider,
  baseUrl: config.baseUrl,
  model: config.model,
  prompt,
  useResponsesApi: true,
  outputVersion: "v1",
  chunks,
  finalMessage: normalizeMessage(finalChunk),
};

const fixturesDir = join(import.meta.dir, "..", "tests", "fixtures", "langchain");
await mkdir(fixturesDir, { recursive: true });
const fixturePath = join(fixturesDir, "responses-v1-chatmodel.json");
await Bun.write(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);

console.log(fixturePath);
