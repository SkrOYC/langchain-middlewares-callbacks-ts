#!/usr/bin/env bun

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { $ } from "bun";
import {
  OPENRESPONSES_COMPLIANCE_RUNNER_ENTRYPOINT,
  OPENRESPONSES_OPENAPI_PATH,
  OPENRESPONSES_SNAPSHOT_COMMIT,
  OPENRESPONSES_UPSTREAM_REPOSITORY,
} from "../src/contract/snapshot.ts";

declare const Bun: typeof import("bun");

const packageRoot = resolve(import.meta.dir, "..");
const temporaryCloneDir = join("/tmp", "openresponses-contract-refresh");
const openapiPath = resolve(
  packageRoot,
  "contracts/openresponses/openapi.json"
);
const generatedTargetDir = resolve(
  packageRoot,
  "src/contract/generated/kubb/zod"
);
const runnerTargetDir = resolve(
  packageRoot,
  "contracts/openresponses/compliance-runner"
);
const officialRunnerTargetDir = resolve(
  packageRoot,
  "contracts/openresponses/official"
);

const copyIntoRepo = async (params: {
  from: string;
  to: string;
}): Promise<void> => {
  await rm(params.to, { force: true, recursive: true });
  await mkdir(resolve(params.to, ".."), { recursive: true });
  await $`cp -R ${params.from} ${params.to}`.quiet();
};

await rm(temporaryCloneDir, { force: true, recursive: true });
await $`git clone --depth 1 ${OPENRESPONSES_UPSTREAM_REPOSITORY} ${temporaryCloneDir}`.quiet();

const head = (
  await $`git -C ${temporaryCloneDir} rev-parse HEAD`.text()
).trim();
if (head !== OPENRESPONSES_SNAPSHOT_COMMIT) {
  await $`git -C ${temporaryCloneDir} fetch --depth 1 origin ${OPENRESPONSES_SNAPSHOT_COMMIT}`.quiet();
  await $`git -C ${temporaryCloneDir} checkout ${OPENRESPONSES_SNAPSHOT_COMMIT}`.quiet();
}

const openapiSource = resolve(temporaryCloneDir, OPENRESPONSES_OPENAPI_PATH);
const openapi = await Bun.file(openapiSource).text();
await writeFile(openapiPath, openapi, "utf8");

await copyIntoRepo({
  from: resolve(temporaryCloneDir, "src/generated/kubb/zod"),
  to: generatedTargetDir,
});

await copyIntoRepo({
  from: resolve(temporaryCloneDir, "bin/compliance-test.ts"),
  to: resolve(runnerTargetDir, "upstream-compliance-test.ts"),
});

await copyIntoRepo({
  from: resolve(temporaryCloneDir, "src/lib/compliance-tests.ts"),
  to: resolve(runnerTargetDir, "upstream-compliance-tests.ts"),
});

await copyIntoRepo({
  from: resolve(temporaryCloneDir, "src/lib/sse-parser.ts"),
  to: resolve(runnerTargetDir, "upstream-sse-parser.ts"),
});

await copyIntoRepo({
  from: resolve(temporaryCloneDir, "bin"),
  to: resolve(officialRunnerTargetDir, "bin"),
});

await copyIntoRepo({
  from: resolve(temporaryCloneDir, "src/lib"),
  to: resolve(officialRunnerTargetDir, "src/lib"),
});

await copyIntoRepo({
  from: resolve(temporaryCloneDir, "src/generated"),
  to: resolve(officialRunnerTargetDir, "src/generated"),
});

await copyIntoRepo({
  from: resolve(temporaryCloneDir, "public/openapi"),
  to: resolve(officialRunnerTargetDir, "public/openapi"),
});

await rm(temporaryCloneDir, { force: true, recursive: true });

process.stdout.write(
  `Updated vendored OpenResponses snapshot, generated contract facade, and compliance baseline from ${OPENRESPONSES_SNAPSHOT_COMMIT} (${OPENRESPONSES_COMPLIANCE_RUNNER_ENTRYPOINT})\n`
);
