#!/usr/bin/env bun

import {
  assertVerificationResult,
  envConfig,
  printVerificationResult,
  runExampleVerification,
  type VerifyMode,
} from "./verification";

function printUsage(): void {
  console.log(`AG-UI example verifier

Usage:
  bun run verify.ts [default|custom-host] [prompt]

Examples:
  bun run verify.ts default "Calculate 2 + 2"
  bun run verify.ts custom-host "Calculate 2 + 2"

Env overrides:
  EXAMPLE_PROVIDER=mock|openai-compatible
  EXAMPLE_BASE_URL=https://api.openai.com/v1
  EXAMPLE_API_KEY=...
  EXAMPLE_MODEL=gpt-4.1-mini
  EXAMPLE_AUTH_TOKEN=demo-secret
`);
}
async function run(mode: VerifyMode, prompt: string): Promise<void> {
  const result = await runExampleVerification({
    mode,
    prompt,
    config: envConfig(),
  });

  printVerificationResult(`Mode: ${mode}\nPrompt: ${prompt}`, result);
  assertVerificationResult(result, {
    allowEmptyAssistantMessages: true,
  });

  if (result.events.at(-1)?.type === "RUN_ERROR") {
    throw new Error("Verifier received RUN_ERROR.");
  }

  console.log("Verifier passed.");
}

const modeArg = process.argv[2];
const prompt = process.argv[3] ?? "Calculate 2 + 2";

if (modeArg === "--help" || modeArg === "-h") {
  printUsage();
  process.exit(0);
}

const mode: VerifyMode =
  modeArg === "custom-host" ? "custom-host" : "default";

run(mode, prompt).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
