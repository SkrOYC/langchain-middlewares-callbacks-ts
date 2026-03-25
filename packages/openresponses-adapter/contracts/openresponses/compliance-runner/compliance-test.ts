#!/usr/bin/env bun

import {
  runAllTests,
  testTemplates,
  type TestConfig,
  type TestResult,
} from "./compliance-tests.ts";

const colors = {
  gray: (value: string) => `\x1b[90m${value}\x1b[0m`,
  green: (value: string) => `\x1b[32m${value}\x1b[0m`,
  red: (value: string) => `\x1b[31m${value}\x1b[0m`,
  yellow: (value: string) => `\x1b[33m${value}\x1b[0m`,
};

interface CliArgs {
  apiKey?: string;
  authHeader?: string;
  baseUrl?: string;
  filter?: string[];
  help?: boolean;
  json?: boolean;
  model?: string;
  noBearer?: boolean;
  verbose?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  let index = 0;

  while (index < argv.length) {
    const arg = argv[index];
    const nextArg = argv[index + 1];

    switch (arg) {
      case "--base-url":
      case "-u":
        if (nextArg !== undefined) {
          args.baseUrl = nextArg;
          index += 2;
          break;
        }
        index += 1;
        break;
      case "--api-key":
      case "-k":
        if (nextArg !== undefined) {
          args.apiKey = nextArg;
          index += 2;
          break;
        }
        index += 1;
        break;
      case "--model":
      case "-m":
        if (nextArg !== undefined) {
          args.model = nextArg;
          index += 2;
          break;
        }
        index += 1;
        break;
      case "--auth-header":
        if (nextArg !== undefined) {
          args.authHeader = nextArg;
          index += 2;
          break;
        }
        index += 1;
        break;
      case "--no-bearer":
        args.noBearer = true;
        index += 1;
        break;
      case "--filter":
      case "-f":
        if (nextArg !== undefined) {
          args.filter = nextArg.split(",").map((value) => value.trim());
          index += 2;
          break;
        }
        index += 1;
        break;
      case "--verbose":
      case "-v":
        args.verbose = true;
        index += 1;
        break;
      case "--json":
        args.json = true;
        index += 1;
        break;
      case "--help":
      case "-h":
        args.help = true;
        index += 1;
        break;
      default:
        index += 1;
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
Usage: bun contracts/openresponses/compliance-runner/compliance-test.ts [options]

Options:
  -u, --base-url <url>        API base URL (required)
  -k, --api-key <key>         API key (required, or set OPENRESPONSES_API_KEY env var)
  -m, --model <model>         Model name (default: gpt-4o-mini)
      --auth-header <name>    Auth header name (default: Authorization)
      --no-bearer             Disable Bearer prefix in auth header
  -f, --filter <ids>          Filter tests by ID (comma-separated)
  -v, --verbose               Verbose output with request/response details
      --json                  Output results as JSON
  -h, --help                  Show this help message
`);
}

function getStatusIcon(status: TestResult["status"]): string {
  switch (status) {
    case "passed":
      return colors.green("✓");
    case "failed":
      return colors.red("✗");
    case "running":
      return colors.yellow("◉");
    case "pending":
      return colors.gray("○");
    default:
      return colors.gray("?");
  }
}

function printResult(result: TestResult, verbose: boolean): void {
  const icon = getStatusIcon(result.status);
  const duration = result.duration ? ` (${result.duration}ms)` : "";
  const events =
    result.streamEvents !== undefined ? ` [${result.streamEvents} events]` : "";
  const name =
    result.status === "failed" ? colors.red(result.name) : result.name;

  console.log(`${icon} ${name}${duration}${events}`);

  if (result.status === "failed" && result.errors?.length) {
    for (const error of result.errors) {
      console.log(`  ${colors.red("✗")} ${error}`);
    }

    if (verbose) {
      if (result.request) {
        console.log("\n  Request:");
        console.log(
          `  ${JSON.stringify(result.request, null, 2).split("\n").join("\n  ")}`
        );
      }

      if (result.response) {
        console.log("\n  Response:");
        const responseText =
          typeof result.response === "string"
            ? result.response
            : JSON.stringify(result.response, null, 2);
        console.log(`  ${responseText.split("\n").join("\n  ")}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const baseUrl = args.baseUrl;
  if (!baseUrl) {
    console.error(`${colors.red("Error:")} --base-url is required`);
    process.exit(1);
  }

  const apiKey = args.apiKey || process.env.OPENRESPONSES_API_KEY;
  if (!apiKey) {
    console.error(
      `${colors.red("Error:")} --api-key is required or set OPENRESPONSES_API_KEY`
    );
    process.exit(1);
  }

  const config: TestConfig = {
    apiKey,
    authHeaderName: args.authHeader || "Authorization",
    baseUrl,
    model: args.model || "gpt-4o-mini",
    useBearerPrefix: !args.noBearer,
  };

  if (args.filter?.length) {
    const availableIds = testTemplates.map((template) => template.id);
    const invalidFilters = args.filter.filter(
      (id) => !availableIds.includes(id)
    );

    if (invalidFilters.length > 0) {
      console.error(
        `${colors.red("Error:")} Invalid test IDs: ${invalidFilters.join(", ")}`
      );
      console.error(`Available test IDs: ${availableIds.join(", ")}`);
      process.exit(1);
    }
  }

  const allUpdates: TestResult[] = [];

  const onProgress = (result: TestResult) => {
    if (args.filter && !args.filter.includes(result.id)) {
      return;
    }

    allUpdates.push(result);
    if (!args.json) {
      printResult(result, args.verbose || false);
    }
  };

  await runAllTests(config, onProgress);

  const finalResults = allUpdates.filter(
    (result) => result.status === "passed" || result.status === "failed"
  );
  const passed = finalResults.filter(
    (result) => result.status === "passed"
  ).length;
  const failed = finalResults.filter(
    (result) => result.status === "failed"
  ).length;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          results: finalResults,
          summary: { failed, passed, total: finalResults.length },
        },
        null,
        2
      )
    );
    process.exit(failed > 0 ? 1 : 0);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(
    `Results: ${colors.green(`${passed} passed`)}, ${colors.red(`${failed} failed`)}, ${finalResults.length} total`
  );

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const result of finalResults) {
      if (result.status !== "failed") {
        continue;
      }

      console.log(`\n${result.name}:`);
      for (const error of result.errors || []) {
        console.log(`  - ${error}`);
      }
    }
  } else {
    console.log(`\n${colors.green("✓ All tests passed!")}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

await main();
