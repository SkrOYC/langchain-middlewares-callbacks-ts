# Official Compliance Runner Baseline

- Upstream repository: `https://github.com/openresponses/openresponses`
- Pinned commit: `0e3605e3618080ffc15b732d68dbe63fb3b1db73`
- CLI entrypoint: `bin/compliance-test.ts`
- Upstream script: `bun run test:compliance`
- Expected base URL format: `http://127.0.0.1:<port>/v1`
- Effective request target used by the runner: `POST /responses`

Vendored baseline files in this repository:

- `contracts/openresponses/compliance-runner/compliance-test.ts`
- `contracts/openresponses/compliance-runner/compliance-tests.ts`
- `contracts/openresponses/compliance-runner/sse-parser.ts`
- `contracts/openresponses/compliance-runner/upstream-compliance-test.ts`
- `contracts/openresponses/compliance-runner/upstream-compliance-tests.ts`
- `contracts/openresponses/compliance-runner/upstream-sse-parser.ts`

Current upstream test IDs at the pinned commit:

- `basic-response`
- `streaming-response`
- `system-prompt`
- `tool-calling`
- `image-input`
- `multi-turn`

Local execution entrypoint:

```bash
bun run test:compliance:official
```

The local harness builds the package, serves the built adapter from a temporary
HTTP port, and runs the upstream CLI against that live endpoint so scenario
failures reflect public contract gaps rather than local test doubles.
