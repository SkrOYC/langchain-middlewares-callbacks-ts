export const OPENRESPONSES_UPSTREAM_REPOSITORY =
  "https://github.com/openresponses/openresponses" as const;

export const OPENRESPONSES_SNAPSHOT_COMMIT =
  "0e3605e3618080ffc15b732d68dbe63fb3b1db73" as const;

export const OPENRESPONSES_OPENAPI_VERSION = "2.3.0" as const;

export const OPENRESPONSES_OPENAPI_PATH =
  "public/openapi/openapi.json" as const;

export const OPENRESPONSES_COMPLIANCE_RUNNER_ENTRYPOINT =
  "bin/compliance-test.ts" as const;

export const OPENRESPONSES_COMPLIANCE_TEST_IDS = [
  "basic-response",
  "streaming-response",
  "system-prompt",
  "tool-calling",
  "image-input",
  "multi-turn",
] as const;

export const OPENRESPONSES_BASE_URL_SUFFIX = "/v1" as const;

export const contractSnapshotVersion =
  `${OPENRESPONSES_OPENAPI_VERSION}+${OPENRESPONSES_SNAPSHOT_COMMIT.slice(
    0,
    12
  )}` as const;

export const openResponsesSnapshotMetadata = {
  baseUrlSuffix: OPENRESPONSES_BASE_URL_SUFFIX,
  commit: OPENRESPONSES_SNAPSHOT_COMMIT,
  complianceRunnerEntrypoint: OPENRESPONSES_COMPLIANCE_RUNNER_ENTRYPOINT,
  complianceTestIds: OPENRESPONSES_COMPLIANCE_TEST_IDS,
  openapiPath: OPENRESPONSES_OPENAPI_PATH,
  openapiVersion: OPENRESPONSES_OPENAPI_VERSION,
  repository: OPENRESPONSES_UPSTREAM_REPOSITORY,
  snapshotVersion: contractSnapshotVersion,
} as const;

export type OpenResponsesComplianceTestId =
  (typeof OPENRESPONSES_COMPLIANCE_TEST_IDS)[number];
