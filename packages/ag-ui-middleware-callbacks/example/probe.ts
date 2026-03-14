#!/usr/bin/env bun

import { HumanMessage } from "@langchain/core/messages";
import { createExampleModel } from "./runtime";
import { envConfig, printVerificationResult, runExampleVerification } from "./verification";

type VerifyMode = "default" | "custom-host";

interface ContentBlockSummary {
  type: string;
  preview: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function summarizeContentBlock(block: unknown): ContentBlockSummary | null {
  if (!isRecord(block)) {
    return null;
  }

  const type = readString(block.type);
  if (!type) {
    return null;
  }

  const summaryEntries = Array.isArray(block.summary)
    ? block.summary
        .map((entry) => (typeof entry === "string" ? entry : ""))
        .filter((entry) => entry.length > 0)
    : [];
  const preview =
    readString(block.text) ??
    readString(block.reasoning) ??
    summaryEntries[0] ??
    "";

  return {
    type,
    preview,
  };
}

function printUsage(): void {
  console.log(`AG-UI live contentBlocks probe

Usage:
  bun run probe.ts [default|custom-host] [prompt]

Examples:
  bun run probe.ts default "Think carefully, then answer: what is 37 * 19?"
  bun run probe.ts custom-host "Reason briefly, then answer in one line."
`);
}

const modeArg = process.argv[2];
const promptArg = process.argv[3];

if (modeArg === "--help" || modeArg === "-h") {
  printUsage();
  process.exit(0);
}

const mode: VerifyMode = modeArg === "custom-host" ? "custom-host" : "default";
const prompt =
  promptArg ??
  "Think carefully, then answer: what is 37 * 19? Put the final answer on its own line.";

const config = envConfig();
const model = createExampleModel(config);
const stream = await model.stream([new HumanMessage(prompt)]);

let chunkIndex = 0;
let firstReasoningChunk = -1;
let firstTextChunk = -1;

console.log("Live LangChain chunk probe");
console.log(
  JSON.stringify(
    {
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      mode,
    },
    null,
    2
  )
);
console.log("");

for await (const chunk of stream) {
  const chunkRecord = isRecord(chunk) ? chunk : {};
  const token =
    readString(chunkRecord.content) ??
    (Array.isArray(chunkRecord.content) ? JSON.stringify(chunkRecord.content) : "");
  const blocks = Array.isArray(chunkRecord.contentBlocks)
    ? chunkRecord.contentBlocks
        .map(summarizeContentBlock)
        .filter((block): block is ContentBlockSummary => block !== null)
        .filter((block) => block.preview.length > 0 || block.type.length > 0)
    : [];

  if (blocks.length === 0 && token.length === 0) {
    chunkIndex += 1;
    continue;
  }

  if (firstReasoningChunk < 0 && blocks.some((block) => block.type === "reasoning")) {
    firstReasoningChunk = chunkIndex;
  }

  if (
    firstTextChunk < 0 &&
    blocks.some((block) => block.type === "text" && block.preview.length > 0)
  ) {
    firstTextChunk = chunkIndex;
  }

  console.log(
    JSON.stringify(
      {
        chunkIndex,
        token,
        contentBlocks: blocks,
      },
      null,
      2
    )
  );
  chunkIndex += 1;
}

console.log("");

if (firstReasoningChunk < 0) {
  throw new Error(
    "No standardized reasoning contentBlocks were observed. This model/provider path is not surfacing live reasoning through LangChain."
  );
}

if (firstTextChunk >= 0 && firstReasoningChunk > firstTextChunk) {
  throw new Error(
    `Reasoning contentBlocks started after text contentBlocks (${firstReasoningChunk} > ${firstTextChunk}).`
  );
}

console.log(
  `contentBlocks ordering OK: reasoning chunk ${firstReasoningChunk}, text chunk ${firstTextChunk}.`
);
console.log("");

const verification = await runExampleVerification({
  mode,
  prompt,
  config,
});
printVerificationResult(`AG-UI verifier (${mode})`, verification);
