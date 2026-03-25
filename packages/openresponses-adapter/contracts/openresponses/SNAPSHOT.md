# OpenResponses Contract Snapshot

- Upstream repository: `https://github.com/openresponses/openresponses`
- Pinned commit: `0e3605e3618080ffc15b732d68dbe63fb3b1db73`
- OpenAPI source path: `public/openapi/openapi.json`
- OpenAPI `info.version`: `2.3.0`
- Snapshot fetched on: `2026-03-25`
- Local refresh command: `bun run contract:update`

This directory is the contract authority for Epic A.

The vendored `openapi.json` is the canonical schema snapshot that local docs,
tests, and automation must resolve through the package's snapshot metadata
module rather than ad hoc URLs or floating upstream branches.

`bun run contract:update` refreshes the pinned baseline set together:

- `contracts/openresponses/openapi.json`
- `src/contract/generated/kubb/zod/**`
- `contracts/openresponses/compliance-runner/**`
