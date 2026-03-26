#!/usr/bin/env bun

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  OPENRESPONSES_BASE_URL_SUFFIX,
  openResponsesSnapshotMetadata,
} from "../src/contract/snapshot.ts";
import { createOfficialComplianceFixtureAgent } from "./official-compliance-fixtures.ts";

declare const Bun: typeof import("bun");

const packageRoot = resolve(import.meta.dir, "..");
const officialCliEntrypoint = resolve(
  packageRoot,
  "contracts/openresponses/official/bin/compliance-test.ts"
);

interface CliOptions {
  filter?: string;
  jsonOut?: string;
  model?: string;
}

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];

    if ((arg === "--filter" || arg === "-f") && value) {
      options.filter = value;
      index++;
      continue;
    }

    if (arg === "--json-out" && value) {
      options.jsonOut = value;
      index++;
      continue;
    }

    if ((arg === "--model" || arg === "-m") && value) {
      options.model = value;
      index++;
    }
  }

  return options;
};

interface OfficialRunnerPayload {
  results: Array<{ id?: string; status?: string }>;
  summary: { passed: number; failed: number; total: number };
}

interface OfficialRunnerResult {
  exitCode: number;
  payload: OfficialRunnerPayload;
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

const startFixtureServer = async (): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> => {
  const builtServerModulePath = pathToFileURL(
    resolve(packageRoot, "dist/server.js")
  ).href;
  const { buildOpenResponsesApp } = (await import(
    builtServerModulePath
  )) as typeof import("../src/server/index.ts");
  const app = await buildOpenResponsesApp({
    agent: createOfficialComplianceFixtureAgent(),
  });

  const server = Bun.serve({
    fetch(request) {
      return app.fetch(request);
    },
    hostname: "127.0.0.1",
    port: 0,
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}${OPENRESPONSES_BASE_URL_SUFFIX}`,
    async stop() {
      await server.stop(true);
    },
  };
};

const summarizeScenarioResults = (parsed: {
  results: Array<{ id?: string; status?: string }>;
  summary: { passed: number; failed: number; total: number };
}): string => {
  const lines: string[] = [
    `Official runner baseline: ${openResponsesSnapshotMetadata.snapshotVersion}`,
  ];

  lines.push(
    `Summary: ${parsed.summary.passed} passed, ${parsed.summary.failed} failed, ${parsed.summary.total} total`
  );

  for (const result of parsed.results) {
    lines.push(`${result.id ?? "unknown"}: ${result.status ?? "unknown"}`);
  }

  return `${lines.join("\n")}\n`;
};

const runOfficialCli = async (params: {
  baseUrl: string;
  filter?: string;
  model: string;
}): Promise<OfficialRunnerResult> => {
  const cmd = [
    "bun",
    officialCliEntrypoint,
    "--base-url",
    params.baseUrl,
    "--api-key",
    "test-key",
    "--auth-header",
    "Authorization",
    "--model",
    params.model,
    "--json",
  ];

  if (params.filter) {
    cmd.push("--filter", params.filter);
  }

  const proc = Bun.spawn({
    cmd,
    cwd: packageRoot,
    stderr: "inherit",
    stdout: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  const payload = JSON.parse(stdout) as OfficialRunnerPayload;

  return {
    exitCode,
    payload,
  };
};

const options = parseArgs(process.argv.slice(2));
await buildPackage();
const server = await startFixtureServer();

try {
  const officialRunnerOptions: {
    baseUrl: string;
    filter?: string;
    model: string;
  } = {
    baseUrl: server.baseUrl,
    model: options.model ?? "gpt-4.1-mini",
  };

  if (options.filter) {
    officialRunnerOptions.filter = options.filter;
  }

  const result = await runOfficialCli(officialRunnerOptions);
  const { exitCode, payload } = result;

  if (options.jsonOut) {
    await Bun.write(
      resolve(packageRoot, options.jsonOut),
      JSON.stringify(payload, null, 2)
    );
  }

  process.stdout.write(summarizeScenarioResults(payload));
  process.exit(exitCode);
} finally {
  await server.stop();
}
