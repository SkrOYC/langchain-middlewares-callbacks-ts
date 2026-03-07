# TechSpec.md

## 0. Scope, Audit, and Design Rationale

### Goal

Publish a TypeScript package that lets an existing LangChain `createAgent()` runtime expose a **spec-minimal / acceptance-suite-targeted MVP** Open Responses `POST /v1/responses` surface with minimal user code, truthful SSE semantics, and no rewrite of the agent loop.

### Compliance Posture

This implementation targets **MVP compliance** with the Open Responses specification. The request and response schemas represent a **deliberate subset** of the official Open Responses surface—not an exhaustive implementation.

**Design Decision:** We intentionally exclude certain reference fields to keep the MVP scoped to core agent interoperability. This is not a gap in coverage—it is an explicit trade-off made to prioritize the primary use case: exposing existing LangChain agents with minimal friction.

**Why deliberate over exhaustive:**
- The primary value proposition is "make my existing agent usable with Responses-compatible clients quickly"
- A narrower surface reduces implementation complexity and maintenance burden
- Full reference compliance can be added incrementally as future work

**Notably excluded from MVP** (by design, not omission):
- Advanced request fields: `include`, `stream_options`, `background`, `max_tool_calls`, `presence_penalty`, `frequency_penalty`, `safety_identifier`, `prompt_cache_key`, `instructions`, `store`, `service_tier`, `top_logprobs`, `truncation`
- Extended output item types: `Reasoning` item, full `FunctionCallOutput` with all content types
- Response metadata: `usage`, `incomplete_details`, `text`, `reasoning`, `top_p`, `temperature`, `max_output_tokens`, `max_tool_calls`, `store`, `background`, `service_tier`, `safety_identifier`, `prompt_cache_key`

This approach follows ADR-007: spec-over-reference compliance. When the official specification and reference conflict, we implement the stricter normative specification.

### Upstream Divergences Register

This implementation follows the normative Open Responses specification rather than the broader reference. The following divergences are intentional:

**1. Request Content-Type**

| Aspect | Specification | Reference | Implementation |
|--------|--------------|-----------|----------------|
| Request body | `application/json` only | `application/json` or `application/x-www-form-urlencoded` | `application/json` only |
| Behavior on other types | Not specified | Not specified | Returns `415 Unsupported Media Type` |

**2. Omitted Request Fields**

The reference defines many request parameters that this MVP does not implement:

| Field | Reference Status | MVP Status |
|-------|-----------------|------------|
| `include` | Optional | Not implemented |
| `stream_options` | Optional | Not implemented |
| `instructions` | Optional | Not implemented |
| `store` | Optional | Not implemented |
| `service_tier` | Optional | Not implemented |
| `truncation` | Optional | Not implemented |
| `parallel_tool_calls` | Optional | Implemented |
| `max_tool_calls` | Optional | Not implemented |
| `safety_identifier` | Optional | Not implemented |
| `prompt_cache_key` | Optional | Not implemented |
| `top_logprobs` | Optional | Not implemented |
| `presence_penalty` | Optional | Not implemented |
| `frequency_penalty` | Optional | Not implemented |

**3. Omitted Response Fields**

The reference marks the following response fields as `required`, but they are not included in this MVP:

| Field | Reference Status | MVP Status |
|-------|-----------------|------------|
| `incomplete_details` | Required | Not implemented |
| `instructions` | Required | Not implemented |
| `tools` | Required | Not implemented |
| `tool_choice` | Required | Not implemented |
| `truncation` | Required | Not implemented |
| `parallel_tool_calls` | Required | Not implemented |
| `text` | Required | Not implemented |
| `top_p` | Required | Not implemented |
| `presence_penalty` | Required | Not implemented |
| `frequency_penalty` | Required | Not implemented |
| `top_logprobs` | Required | Not implemented |
| `temperature` | Required | Not implemented |
| `reasoning` | Required | Not implemented |
| `usage` | Required | Not implemented |
| `max_output_tokens` | Required | Not implemented |
| `max_tool_calls` | Required | Not implemented |
| `store` | Required | Not implemented |
| `background` | Required | Not implemented |
| `service_tier` | Required | Not implemented |
| `metadata` | Required | Implemented |
| `safety_identifier` | Required | Not implemented |
| `prompt_cache_key` | Required | Not implemented |

**4. Error Type Ambiguity**

The specification itself has an internal inconsistency regarding error types (this is not a spec vs reference issue):

| Source | Error Type Shown |
|--------|-----------------|
| Specification (Errors section, example) | `invalid_request_error` |
| Specification (Error Types table) | `invalid_request` |

**Decision:** This implementation normalizes on `invalid_request_error` (with `_error` suffix) as shown in the specification's error example, since the specification is the normative source.

**5. `allowed_tools.mode` Requiredness**

The reference shows inconsistent requiredness between request and response contexts:

| Context | Field | Reference Status |
|---------|-------|-----------------|
| Request parameter (`AllowedToolsParam`) | `mode` | Optional |
| Response object (`AllowedToolChoice`) | `mode` | Required |

**Decision:** This implementation makes `mode` optional in the request schema (matching the parameter semantics), which aligns with the reference's request parameter definition. This is an intentional divergence from the response object's required `mode` field.

b0px-27↔### Design Rationale: Checkpointing Is Not the Canonical `previous_response_id` Contract

LangChain checkpointing alone is not physically sufficient for Open Responses continuation, and the Architecture correctly treats continuation as an explicit builder-controlled boundary.

Why this distinction matters:

1. LangGraph/LangChain checkpointing is thread-oriented and keyed by `thread_id`.
1. Open Responses continuation is response-oriented and keyed by `previous_response_id`.
1. The Open Responses server must be able to rehydrate the exact prior `input + output` resource shape, not merely restore graph execution state.

Therefore this package **shall not require a bundled durable datastore**, but it **must** define a builder-supplied `PreviousResponseStore` port. A builder may implement that port using LangGraph checkpoints, a database, object storage, or a hybrid adapter. But checkpointing alone is not the package contract.

### Format Adaptation

This TechSpec replaces:

- the relational ERD requirement with a **Persistence Port + Canonical Stored Record schema**
- the OpenAPI requirement with a **TypeScript-first protocol contract** using Zod-backed schemas and exported route types

-----

## 1. Stack Specification (Bill of Materials)

### 1.1 Language / Runtime

- **Language:** TypeScript 5.9.x
- **JavaScript baseline:** ES2022
- **Runtime baseline:** Web-standards-compatible JavaScript runtime
- **Certified runtime matrix:** Node.js 24.x LTS and Bun current
- **LangChain minimum:** Node.js 20.x (per `@langchain/core` engines requirement), though certified CI runs on 20.x/22.x/24.x
- **Portable target:** Deno current on a best-effort basis, limited to paths where the consuming app can run LangChain, the selected model/tool integrations, and Hono transport cleanly

### 1.2 Primary Frameworks and Libraries

- **Agent runtime:** `langchain` 1.2.x
- **Core callback/types surface:** `@langchain/core` 1.1.x
- **Optional direct graph/checkpoint integration:** `@langchain/langgraph` 1.2.x
- **HTTP framework:** `hono` 4.12.x
- **Node adapter for examples/tests:** `@hono/node-server` 1.19.x
- **Validation / schema inference:** `zod` 4.3.x
- **Test runner:** `bun:test` via `bun test`
- **Formatting / linting:** `@biomejs/biome` 2.4.x
- **Bundler:** `tsup` 8.5.x
- **Bun runtime typing:** `@types/bun` 1.3.x

### 1.3 Packaging and Module System

- **Distribution:** dual package via `tsup`
- **Outputs:** ESM + CJS + `.d.ts`
- **Exports map:** required
- **Side effects:** `false`
- **Target style:** source code must avoid Node-only built-ins in `core`, `adapter`, `callbacks`, `state`, and `serializer`
- **Node-only code location:** runtime-specific server bootstraps, test harness helpers, and optional examples
- **Monorepo package shape:** one publishable package per workspace, with package-local `README.md`, `src/`, `tests/`, and `examples/`

### 1.4 Infrastructure

- **Monorepo toolchain:** Bun Workspaces
- **Package manager:** Bun
- **Install command:** `bun install`
- **Workspace scripts:** `bun run build`, `bun test`, `bun run lint`, `bun run typecheck`
- **CI:** GitHub Actions or equivalent
- **Release gate:** unit tests + golden stream tests + Open Responses compliance suite + Node 24 and Bun release jobs

### 1.5 Physical Standards

- Use only Web Platform primitives in runtime-neutral modules:
  - `Request`
  - `Response`
  - `Headers`
  - `ReadableStream`
  - `AbortSignal`
  - `crypto.randomUUID()`
- Do not use:
  - `fs`
  - `net`
  - `stream.Readable`
  - `EventEmitter`
  - Node-specific timers in shared modules

### 1.6 Dependencies Explicitly Rejected

- No ORM
- No Redis / RabbitMQ / Kafka for MVP
- No DI container framework
- No OpenAPI generator as a required runtime dependency
- No provider-specific SDK coupling inside core protocol modules

-----

## 2. Architecture Decision Records (ADRs)

### ADR-001 — Package Shape: Modular Monolith Library

**Context**  
The product is a library-shaped adapter, not a distributed application. The builder is a solo developer mounting one package into an existing agent host.

**Decision**  
Implement as a modular monolith with explicit bounded modules: `core`, `adapter`, `callbacks`, `state`, `serializer`, `server`, and `testing`.

**Consequences**

- Pros: lower operational complexity, easier local reasoning, no distributed tracing burden, simpler testability
- Cons: one process owns all semantics; no horizontal decoupling of transport vs accumulation
- Trade-off accepted because there is no justified independent scaling boundary

### ADR-002 — Semantics Derive from Callbacks, Not Middleware

**Context**  
LangChain middleware is designed for execution control. Callback handlers expose lifecycle events with `runId` correlation and token/tool signals.

**Decision**  
Use middleware only for policy and runtime steering. Use callback handlers as the canonical semantic observation boundary.

**Consequences**

- Pros: faithful runtime observation, cleaner mapping to item/content-part deltas, less protocol leakage into agent control plane
- Cons: provider differences in callback granularity must be tolerated
- Mitigation: accumulator tolerates reduced fidelity and closes items conservatively

### ADR-003 — Single Writer for All Public Output

**Context**  
Streaming order corruption is the easiest way to become non-compliant.

**Decision**  
All JSON materialization and SSE writes go through one response-scoped serializer pipeline and one transport writer.

**Consequences**

- Pros: deterministic order, one monotonic sequence counter, easier golden testing, prevents callback-to-socket races
- Cons: introduces internal queueing and one more stateful component
- Trade-off accepted; correctness matters more than micro-optimizing intra-process latency

### ADR-004 — TypeScript-First Public Contract

**Context**  
This package lives inside a TypeScript monorepo and primarily serves TS consumers. OpenAPI would be documentation, not the source of truth.

**Decision**  
The canonical public contract shall be exported TypeScript types and Zod schemas. Hono route types shall also be exported for client inference.

**Consequences**

- Pros: one source of truth for runtime validation and compile-time inference, less schema drift, better monorepo ergonomics
- Cons: non-TypeScript consumers get a weaker first-class experience
- Mitigation: OpenAPI generation may be added later as a derived artifact, not the contract authority

### ADR-005 — Persistence Is a Builder Port, Not a Bundled Product Feature

**Context**  
Open Responses continuation requires explicit replay by `previous_response_id`. LangGraph checkpointing is valuable but thread-centric.

**Decision**  
Ship a required interface boundary for continuation lookup and persistence, plus an in-memory dev implementation. Do not ship a mandatory durable store. Do not make LangGraph checkpointing the canonical package contract.

**Consequences**

- Pros: preserves package scope, avoids fake portability promises, lets builders integrate their own persistence strategy
- Cons: builders who want durable continuation must supply one adapter
- Trade-off accepted because the package is tooling, not a hosted product

### ADR-006 — Dual ESM + CJS Publishing via tsup

**Context**  
The monorepo standard is dual output. Some downstream environments still require `require()` while the modern ecosystem prefers ESM.

**Decision**  
Publish ESM and CJS artifacts from the same source with explicit exports and type declarations.

**Consequences**

- Pros: broad adoption, smoother integration with mixed monorepos
- Cons: slightly larger build/test surface, need to validate exports discipline
- Mitigation: keep source ESM-native and let `tsup` emit both formats

### ADR-007 — Spec Precedence Rule

**Context**  
The Open Responses reference and specification are not perfectly aligned on content types.

**Decision**  
When specification and reference conflict, implement the stricter normative specification. For v1, accept `application/json` only.

**Consequences**

- Pros: clearer compliance posture, smaller validation surface, fewer ambiguous edge cases
- Cons: some clients expecting form-encoded compatibility will be rejected with `415`
- Trade-off accepted because protocol truth beats convenience

-----

## 3. Runtime Compatibility Standard

### 3.1 Certified vs Portable

This package shall distinguish between **certified support** and **portable design**.

#### Certified support

- Node.js 24.x LTS
- Bun current

#### Portable design target

The following modules must remain runtime-portable because they only use Web APIs and pure TypeScript:

- `core/*`
- `adapter/*`
- `callbacks/*`
- `state/*`
- `serializer/*`

#### Best-effort runtime target

- Deno current, via Web-standard transport and package-local example entrypoints

#### Runtime-specific entrypoints

- `server/hono.ts` — shared Hono app factory
- `examples/node.ts` — Node bootstrap
- `examples/bun.ts` — Bun bootstrap
- `examples/deno.ts` — Deno bootstrap

### 3.2 Hard Constraint

The package may be authored for runtime portability, but it shall only claim certified support for environments exercised in CI and release verification. Deno remains best-effort until the full LangChain integration path used by the package is continuously exercised there.

### 3.3 Build Output

`tsup.config.ts` shall emit:

- `dist/index.js` (ESM)
- `dist/index.cjs` (CJS)
- `dist/index.d.ts`
- optional subpath exports for `./server`, `./testing`, `./zod`

### 3.4 `package.json` Contract

```json
{
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./server": {
      "types": "./dist/server.d.ts",
      "import": "./dist/server.js",
      "require": "./dist/server.cjs"
    },
    "./testing": {
      "types": "./dist/testing.d.ts",
      "import": "./dist/testing.js",
      "require": "./dist/testing.cjs"
    }
  }
}
```

-----

## 4. Public TypeScript Protocol Contract

## 4.1 Core Request/Response Types

```ts
import { z } from "zod";

export const MetadataSchema = z.record(z.string(), z.string()).superRefine((value, ctx) => {
  const keys = Object.keys(value);
  if (keys.length > 16) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "metadata supports at most 16 pairs" });
  }
  for (const key of keys) {
    if (key.length > 64) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `metadata key too long: ${key}` });
    }
    if ((value[key] ?? "").length > 512) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `metadata value too long: ${key}` });
    }
  }
});

export const InputTextPartSchema = z.object({
  type: z.literal("input_text"),
  text: z.string().min(1),
});

export const InputImagePartSchema = z.object({
  type: z.literal("input_image"),
  image_url: z.string(),
  detail: z.enum(["low", "high", "auto"]).default("auto"),
});

export const InputFilePartSchema = z.object({
  type: z.literal("input_file"),
  filename: z.string().optional(),
  file_data: z.string().optional(),
  file_url: z.string().optional(),
});

export const InputContentPartSchema = z.union([
  InputTextPartSchema,
  InputImagePartSchema,
  InputFilePartSchema,
]);

export const OutputTextPartSchema = z.object({
  type: z.literal("output_text"),
  text: z.string(),
  annotations: z.array(z.record(z.string(), z.unknown())).default([]),
});

export const RefusalContentSchema = z.object({
  type: z.literal("refusal"),
  refusal: z.string(),
});

// Role-specific message schemas per Open Responses reference
// System and Developer: text-only content
export const SystemMessageItemSchema = z.object({
  type: z.literal("message"),
  role: z.literal("system"),
  content: z.union([
    z.string(),
    z.array(InputTextPartSchema),
  ]),
});

export const DeveloperMessageItemSchema = z.object({
  type: z.literal("message"),
  role: z.literal("developer"),
  content: z.union([
    z.string(),
    z.array(InputTextPartSchema),
  ]),
});

// User: supports text, image, and file content
export const UserMessageItemSchema = z.object({
  type: z.literal("message"),
  role: z.literal("user"),
  content: z.union([
    z.string(),
    z.array(z.union([InputTextPartSchema, InputImagePartSchema, InputFilePartSchema])),
  ]),
});

// Assistant: supports output_text and refusal content
export const AssistantMessageItemSchema = z.object({
  type: z.literal("message"),
  role: z.literal("assistant"),
  content: z.union([
    z.string(),
    z.array(z.union([OutputTextPartSchema, RefusalContentSchema])),
  ]),
});

// Union of all message item types
export const MessageItemSchema = z.union([
  SystemMessageItemSchema,
  DeveloperMessageItemSchema,
  UserMessageItemSchema,
  AssistantMessageItemSchema,
]);

export const FunctionCallInputItemSchema = z.object({
  type: z.literal("function_call"),
  call_id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string(),
  status: z.enum(["in_progress", "completed", "incomplete"]).optional(),
});

export const FunctionCallOutputInputItemSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string().min(1),
  output: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
  status: z.enum(["in_progress", "completed", "incomplete"]).optional(),
});

export const InputItemSchema = z.union([
  MessageItemSchema,
  FunctionCallInputItemSchema,
  FunctionCallOutputInputItemSchema,
]);

export const FunctionToolSchema = z.object({
  type: z.literal("function"),
  name: z.string().min(1).max(64),
  description: z.string().min(1), // Required per Open Responses spec
  parameters: z.record(z.string(), z.unknown()), // Required per Open Responses spec
  // Response schema marks strict as required with default true; request parameter allows omission (defaults to true)
  strict: z.boolean().default(true),
});

export const AllowedToolsChoiceSchema = z.object({
  type: z.literal("allowed_tools"),
  tools: z.array(z.object({ type: z.literal("function"), name: z.string().min(1) })).min(1),
  mode: z.enum(["auto", "none", "required"]).optional(),
});

export const ToolChoiceSchema = z.union([
  z.literal("auto"),
  z.literal("none"),
  z.literal("required"),
  z.object({ type: z.literal("function"), name: z.string().min(1) }),
  AllowedToolsChoiceSchema,
]);

export const OpenResponsesRequestSchema = z.object({
  model: z.string().min(1),
  input: z.union([
    z.string().min(1),
    z.array(InputItemSchema),
  ]),
  previous_response_id: z.string().min(1).optional(),
  tools: z.array(FunctionToolSchema).default([]),
  tool_choice: ToolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().default(true),
  stream: z.boolean().default(false),
  metadata: MetadataSchema.default({}),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_output_tokens: z.number().int().positive().optional(),
  text: z.record(z.string(), z.unknown()).optional(),
  reasoning: z.record(z.string(), z.unknown()).optional(),
});

export type OpenResponsesRequest = z.infer<typeof OpenResponsesRequestSchema>;
```

## 4.2 Output Item Types

```ts
export const OutputTextPartSchema = z.object({
  type: z.literal("output_text"),
  text: z.string(),
  annotations: z.array(z.record(z.string(), z.unknown())).default([]),
});

export const FunctionCallItemSchema = z.object({
  id: z.string().min(1),
  type: z.literal("function_call"),
  status: z.enum(["in_progress", "incomplete", "completed"]),
  name: z.string().min(1),
  call_id: z.string().min(1),
  arguments: z.string(),
});

export const MessageOutputItemSchema = z.object({
  id: z.string().min(1),
  type: z.literal("message"),
  role: z.literal("assistant"),
  status: z.enum(["in_progress", "incomplete", "completed"]),
  content: z.array(OutputTextPartSchema),
});

export const OutputItemSchema = z.union([
  MessageOutputItemSchema,
  FunctionCallItemSchema,
]);

export const ErrorObjectSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  param: z.string().nullable().optional(),
  type: z.enum([
    "server_error",
    "invalid_request_error",
    "not_found",
    "model_error",
    "too_many_requests",
  ]),
});

/**
 * Error schema aligned with official Open Responses specification.
 * Note: The spec uses "invalid_request_error" (with _error suffix), while the reference
 * documentation shows a simpler error shape. We follow the spec for compliance.
 */

export const OpenResponsesResponseSchema = z.object({
  id: z.string().min(1),
  object: z.literal("response"),
  created_at: z.number().int().nonnegative(),
  completed_at: z.number().int().nonnegative().nullable(),
  status: z.enum(["queued", "in_progress", "completed", "failed", "incomplete"]),
  model: z.string().min(1),
  previous_response_id: z.string().nullable(),
  output: z.array(OutputItemSchema),
  error: ErrorObjectSchema.nullable(),
  metadata: MetadataSchema.default({}),
});

export type OpenResponsesResponse = z.infer<typeof OpenResponsesResponseSchema>;
```

## 4.3 Streaming Event Types

```ts
export const ResponseInProgressEventSchema = z.object({
  type: z.literal("response.in_progress"),
  sequence_number: z.number().int().positive(),
  response: z.object({
    id: z.string(),
    object: z.literal("response"),
    status: z.literal("in_progress"),
  }),
});

export const OutputItemAddedEventSchema = z.object({
  type: z.literal("response.output_item.added"),
  sequence_number: z.number().int().positive(),
  output_index: z.number().int().nonnegative(),
  item: OutputItemSchema,
});

export const ContentPartAddedEventSchema = z.object({
  type: z.literal("response.content_part.added"),
  sequence_number: z.number().int().positive(),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  part: OutputTextPartSchema,
});

export const OutputTextDeltaEventSchema = z.object({
  type: z.literal("response.output_text.delta"),
  sequence_number: z.number().int().positive(),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  delta: z.string(),
});

export const OutputTextDoneEventSchema = z.object({
  type: z.literal("response.output_text.done"),
  sequence_number: z.number().int().positive(),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  text: z.string(),
});

export const ContentPartDoneEventSchema = z.object({
  type: z.literal("response.content_part.done"),
  sequence_number: z.number().int().positive(),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  part: OutputTextPartSchema,
});

export const OutputItemDoneEventSchema = z.object({
  type: z.literal("response.output_item.done"),
  sequence_number: z.number().int().positive(),
  output_index: z.number().int().nonnegative(),
  item: OutputItemSchema,
});

export const FunctionCallArgumentsDeltaEventSchema = z.object({
  type: z.literal("response.function_call_arguments.delta"),
  sequence_number: z.number().int().positive(),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  delta: z.string(),
});

export const FunctionCallArgumentsDoneEventSchema = z.object({
  type: z.literal("response.function_call_arguments.done"),
  sequence_number: z.number().int().positive(),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  arguments: z.string(),
});

export const ResponseCompletedEventSchema = z.object({
  type: z.literal("response.completed"),
  sequence_number: z.number().int().positive(),
  response: z.object({
    id: z.string(),
    object: z.literal("response"),
    status: z.literal("completed"),
  }),
});

export const ResponseFailedEventSchema = z.object({
  type: z.literal("response.failed"),
  sequence_number: z.number().int().positive(),
  response: z.object({
    id: z.string(),
    object: z.literal("response"),
    status: z.literal("failed"),
  }),
  error: ErrorObjectSchema,
});

export const OpenResponsesEventSchema = z.union([
  ResponseInProgressEventSchema,
  OutputItemAddedEventSchema,
  ContentPartAddedEventSchema,
  OutputTextDeltaEventSchema,
  OutputTextDoneEventSchema,
  ContentPartDoneEventSchema,
  OutputItemDoneEventSchema,
  FunctionCallArgumentsDeltaEventSchema,
  FunctionCallArgumentsDoneEventSchema,
  ResponseCompletedEventSchema,
  ResponseFailedEventSchema,
]);

export type OpenResponsesEvent = z.infer<typeof OpenResponsesEventSchema>;
export type OpenResponsesStreamChunk = OpenResponsesEvent | "[DONE]";
```

## 4.4 Public Factory Signatures

```ts
import type { Context, Env } from "hono";
import type { CallbackHandlerMethods } from "@langchain/core/callbacks/base";

export interface PreviousResponseStore {
  load(responseId: string, signal?: AbortSignal): Promise<StoredResponseRecord | null>;
  save(record: StoredResponseRecord, signal?: AbortSignal): Promise<void>;
}

export interface OpenResponsesHandlerOptions {
  agent: OpenResponsesCompatibleAgent;
  callbacks?: CallbackHandlerMethods[];
  middleware?: unknown[];
  previousResponseStore?: PreviousResponseStore;
  onError?: (error: unknown) => ErrorObject;
  clock?: () => number;
  generateId?: () => string;
}
/**
 * Agent interface contract for Open Responses adapter.
 *
 * The agent MUST support both invoke() for non-streaming responses and stream()
 * for streaming responses with truthful live SSE semantics.
 *
 * - invoke(): Returns final response synchronously (no chunk-level streaming)
 * - stream(): Returns AsyncIterable for actual token-by-token streaming
 *
 * The adapter uses stream() when the client requests streaming (Accept: text/event-stream).
 * Callback handlers can be used with both methods, but actual streaming requires stream().
 */
export interface OpenResponsesCompatibleAgent {
  invoke(input: { messages: LangChainMessageLike[] }, config?: Record<string, unknown>): Promise<unknown>;
  stream(input: { messages: LangChainMessageLike[] }, config?: Record<string, unknown>): AsyncIterable<unknown>;
}

export declare function createOpenResponsesHandler<E extends Env = Env>(
  options: OpenResponsesHandlerOptions,
): (c: Context<E>) => Promise<Response>;

export declare function createOpenResponsesAdapter(
  options: OpenResponsesHandlerOptions,
): {
  invoke(request: OpenResponsesRequest, signal?: AbortSignal): Promise<OpenResponsesResponse>;
  stream(request: OpenResponsesRequest, signal?: AbortSignal): AsyncIterable<OpenResponsesStreamChunk>;
};
```

## 4.5 Hono Route Type Export

```ts
import { Hono } from "hono";

export function buildOpenResponsesApp(options: OpenResponsesHandlerOptions) {
  const app = new Hono();
  app.post("/v1/responses", createOpenResponsesHandler(options));
  return app;
}

export type OpenResponsesApp = ReturnType<typeof buildOpenResponsesApp>;
```

-----

## 5. HTTP and Transport Specification

### 5.1 Endpoint

- **Method:** `POST`
- **Path:** `/v1/responses`

### 5.2 Accepted Content Type

- `application/json` only

### 5.3 Response Content Types

- non-streaming: `application/json`
- streaming: `text/event-stream`

### 5.4 Status Codes

- `200` — successful non-streaming response
- `200` — successful streaming response start
- `400` — invalid request shape or incompatible field combination
- `401` — unauthenticated, if host auth middleware rejects before handler
- `404` — `previous_response_id` not found in builder-supplied store
- `409` — logical conflict, such as malformed or unusable stored prior record
- `415` — unsupported request content type
- `500` — unexpected internal error before streaming starts

### 5.5 SSE Framing Rules

For streaming requests:

- every event must be written through `stream.writeSSE()` or equivalent
- `event` must equal JSON payload `type`
- `id` must not be used
- `sequence_number` must be response-scoped and strictly increasing by 1
  - **Implementation note:** The Open Responses spec states "monotonically increasing" which permits gaps. This implementation chooses the stricter "strictly +1" interpretation for determinism. This is a valid implementation of the spec but not the only valid approach.
- terminal payload must be literal `[DONE]`

### 5.6 Error Rules

#### Before stream starts

Return standard JSON error envelope with appropriate HTTP status.

#### After stream starts

The handler can no longer replace the response. Therefore:

1. serialize `response.failed`
1. flush if possible
1. write `[DONE]`
1. close stream

### 5.7 Abort/Timeout Rules

- streaming routes shall not rely on generic Hono timeout middleware
- request-scoped `AbortController` required
- separate timeout budgets:
  - request validation: 1s
  - previous response store read: 2s default, builder-overridable
  - agent execution: builder-controlled, default 60s
  - previous response store write after completion: 2s default, non-fatal for already-produced successful JSON only if configured; fatal before finalization in strict mode

### 5.8 Authentication Boundary

Authentication is host-owned. This package shall:

- assume auth has already run
- read opaque request metadata from `c.var` or equivalent host context
- never serialize principal internals unless explicitly configured

-----

## 6. Continuation Persistence Port and Canonical Record Schema

## 6.1 Canonical Stored Record

This is the package’s persistence schema. It is not a database table; it is the required logical record shape.

```ts
export interface StoredResponseRecord {
  response_id: string;
  created_at: number;
  completed_at: number | null;
  model: string;
  request: {
    model: string;
    input: OpenResponsesRequest["input"];
    metadata: Record<string, string>;
    tools: Array<z.infer<typeof FunctionToolSchema>>;
    tool_choice?: z.infer<typeof ToolChoiceSchema>;
    parallel_tool_calls: boolean;
  };
  response: OpenResponsesResponse;
  status: "completed" | "failed" | "incomplete";
  error: ErrorObject | null;
}
```

**Invariant:** Top-level fields (`response_id`, `status`, `model`, `error`, `created_at`, `completed_at`) are convenience projections from the nested `response` object and must always agree with it. The `response` field is authoritative; top-level fields exist for query ergonomics and must be kept in sync at write time.

## 6.2 Required Port

```ts
export interface PreviousResponseStore {
  load(responseId: string, signal?: AbortSignal): Promise<StoredResponseRecord | null>;
  save(record: StoredResponseRecord, signal?: AbortSignal): Promise<void>;
}
```

## 6.3 Required Semantics

- `load()` must be strongly consistent for a just-written completed response within the builder’s expected conversation path
- `save()` must persist the normalized request and canonical final response
- partial callback traces are not persisted through this port
- the stored resource must be sufficient to reconstruct:
  - prior request input
  - prior output items
  - prior model identifier
  - prior response status

## 6.4 In-Memory Dev Store

The package shall ship:

- `InMemoryPreviousResponseStore`

The package shall not ship:

- mandatory SQL schema
- mandatory Postgres/SQLite/Redis adapter

## 6.5 Checkpoint Adapter Policy

A future optional adapter may bridge LangGraph checkpointing into `PreviousResponseStore`. But it must satisfy response-ID lookup and exact `input + output` rehydration. Direct reliance on `thread_id`-only checkpoint loading is insufficient.

-----

## 7. Execution and Semantic State Machines

## 7.1 Response Lifecycle

```text
queued -> in_progress -> completed
                     -> failed
                     -> incomplete
```

## 7.2 Item Lifecycle

```text
in_progress -> completed
           -> incomplete
```

## 7.3 Content-Part Lifecycle

```text
created -> delta* -> done -> closed
```

## 7.4 Ordering Invariants

For each output item with streamable text content, the following order is mandatory:

1. `response.output_item.added`
1. `response.content_part.added`
1. `response.output_text.delta` (0..n)
1. `response.output_text.done`
1. `response.content_part.done`
1. `response.output_item.done`

For each function-call output item with streamable arguments, the following order is mandatory:

1. `response.output_item.added`
1. `response.function_call_arguments.delta` (0..n)
1. `response.function_call_arguments.done`
1. `response.output_item.done`

Response envelope order is mandatory:

1. `response.in_progress`
1. zero or more item/content events
1. terminal response event: `response.completed` or `response.failed`
1. `[DONE]`

## 7.5 Duplicate-Finalizer Rule

Neither items nor content parts may emit more than one terminal event. This is enforced in `ItemAccumulator` with closed-state guards.

-----

## 8. Internal Module Specification

## 8.1 `src/core`

### Responsibility

Own provider-agnostic contracts, errors, and semantic event types.

### Files

- `types.ts`
- `schemas.ts`
- `events.ts`
- `errors.ts`

### Required exports

- `OpenResponsesRequestSchema`
- `OpenResponsesResponseSchema`
- `OpenResponsesEventSchema`
- `InputItemSchema`
- `AllowedToolsChoiceSchema`
- `FunctionCallArgumentsDoneEventSchema`
- `ErrorObjectSchema`
- `InternalSemanticEvent`

### Error taxonomy

This adapter uses internal error codes for classification, which are mapped to spec-compliant public error types when emitted on the wire.

**Internal error codes** (adapter-specific classification):
```ts
export type InternalErrorCode =
  | "invalid_request"
  | "unsupported_media_type"
  | "previous_response_not_found"
  | "previous_response_unusable"
  | "agent_execution_failed"
  | "stream_transport_failed"
  | "internal_error";
```

**Public error types** (per Open Responses spec - emitted on wire):
```ts
export type SpecErrorType =
  | "server_error"           // 500: unexpected condition
  | "invalid_request_error" // 400: malformed request
  | "not_found"              // 404: resource not found
  | "model_error"            // 500: model execution error
  | "too_many_requests";     // 429: rate limited
```

The adapter's `onError` handler maps internal codes to spec-compliant error types for external communication.

## 8.2 `src/adapter`

### Responsibility

Translate between Open Responses inputs/outputs and LangChain runtime structures.

### Files

- `normalize-input.ts`
- `materialize-output.ts`
- `previous-response.ts`
- `tools.ts`
- `invoke-config.ts`

### Concrete rules

- string `input` becomes one user message
- array `input` is normalized item-by-item
- `message.content` string is converted to a single `input_text` semantic part internally
- `input_image` passes through as opaque normalized metadata plus any message-compatible representation required by the selected model integration
- `previous_response_id` concatenation order is exact:
  `prior request input + prior response output + new request input`
- tool mapping runs once, before invocation

### Critical function signatures

```ts
export interface NormalizedRequest {
  messages: LangChainMessageLike[];
  original: OpenResponsesRequest;
  toolPolicy: NormalizedToolPolicy;
}

export declare function normalizeRequest(
  request: OpenResponsesRequest,
  deps: { previousResponseStore?: PreviousResponseStore; signal?: AbortSignal },
): Promise<NormalizedRequest>;

export declare function materializeFinalResponse(params: {
  responseId: string;
  request: OpenResponsesRequest;
  state: CanonicalResponseState;
  model: string;
  createdAt: number;
  completedAt: number | null;
}): OpenResponsesResponse;
```

## 8.3 `src/callbacks`

### Responsibility

Bridge LangChain runtime lifecycle into internal semantic events.

### Files

- `openresponses-callback-bridge.ts`

### Required callback coverage

- `handleChatModelStart`
- `handleLLMNewToken`
- `handleLLMEnd`
- `handleLLMError`
- `handleToolStart`
- `handleToolEnd`
- `handleToolError`
- `handleAgentAction`
- `handleAgentEnd`
- `handleChainError`

### Internal event model

```ts
export type InternalSemanticEvent =
  | { type: "run.started"; runId: string; parentRunId?: string }
  | { type: "message.started"; itemId: string; runId: string }
  | { type: "text.delta"; itemId: string; delta: string }
  | { type: "text.completed"; itemId: string }
  | { type: "function_call.started"; itemId: string; name: string; callId: string }
  | { type: "function_call_arguments.delta"; itemId: string; delta: string }
  | { type: "function_call.completed"; itemId: string }
  | { type: "tool.started"; runId: string; toolName: string; input: string }
  | { type: "tool.completed"; runId: string; output: unknown }
  | { type: "run.completed"; runId: string }
  | { type: "run.failed"; runId: string; error: unknown };
```

### Hard rule

Callbacks must **never** write directly to the HTTP response or Hono stream.

## 8.4 `src/state`

### Responsibility

Maintain canonical response truth.

### Files

- `item-accumulator.ts`
- `response-lifecycle.ts`
- `async-event-queue.ts`

### `ItemAccumulator` contract

```ts
export interface CanonicalItemAccumulator {
  startMessageItem(): CanonicalMessageItem;
  startFunctionCallItem(input: { name: string; callId: string }): CanonicalFunctionCallItem;
  startOutputTextPart(itemId: string): CanonicalOutputTextPart;
  appendOutputTextDelta(itemId: string, contentIndex: number, delta: string): void;
  appendFunctionCallArgumentsDelta(itemId: string, delta: string): void;
  finalizeOutputTextPart(itemId: string, contentIndex: number): CanonicalOutputTextPart;
  finalizeItem(itemId: string, status: "completed" | "incomplete"): CanonicalOutputItem;
  snapshot(): CanonicalOutputItem[];
}
```

### `ResponseLifecycle` contract

```ts
export interface ResponseLifecycle {
  readonly responseId: string;
  readonly createdAt: number;
  getStatus(): "queued" | "in_progress" | "completed" | "failed" | "incomplete";
  start(): void;
  complete(): void;
  fail(error: ErrorObject): void;
  incomplete(error?: ErrorObject): void;
  getError(): ErrorObject | null;
  getCompletedAt(): number | null;
}
```

### Queue design

Use an in-process async queue implemented with promises/iterators. Do not pull in an event bus.

## 8.5 `src/serializer`

### Responsibility

Convert canonical state changes into protocol events and transport output.

### Files

- `event-serializer.ts`
- `sse-response.ts`
- `json-response.ts`

### Required serializer behavior

- owns the monotonic `sequence_number`
- validates every outgoing event against `OpenResponsesEventSchema` in non-production/test modes
- closes text parts before closing items
- emits terminal response event exactly once

### Required signatures

```ts
export interface EventSerializer {
  next(event: InternalOrCanonicalEvent): OpenResponsesEvent[];
  finalizeCompleted(response: OpenResponsesResponse): OpenResponsesEvent;
  finalizeFailed(error: ErrorObject, responseId: string): OpenResponsesEvent;
}

export declare function toSSEFrame(event: OpenResponsesEvent): {
  event: OpenResponsesEvent["type"];
  data: string;
};
```

## 8.6 `src/server`

### Responsibility

Own the Hono route boundary.

### Files

- `hono.ts`
- `errors.ts`
- `context.ts`

### Route algorithm

1. Verify `Content-Type`
1. Parse JSON
1. Validate request with Zod
1. Create response lifecycle
1. Normalize input and resolve continuation
1. Branch on `stream`
1. Invoke agent with callback bridge
1. Serialize JSON or SSE
1. Persist final canonical record
1. Return/close response

### Hard rules

- no business logic in Hono handler beyond orchestration
- no callback logic in transport module
- no store-specific logic in server module

## 8.7 `src/testing`

### Responsibility

Prove compliance and determinism.

### Files

- `fake-model.spec.ts`
- `event-order.spec.ts`
- `tool-calling.spec.ts`
- `previous-response.spec.ts`
- `image-input.spec.ts`
- `compliance.spec.ts`

### Required test doubles

- `FakeListChatModel`
- in-memory previous response store
- deterministic clock
- deterministic ID generator

-----

## 9. Tool Policy and Mapping

## 9.1 Canonical Policy Shape

```ts
export interface NormalizedToolPolicy {
  tools: Array<z.infer<typeof FunctionToolSchema>>;
  /** Derived from `tool_choice` when it is the `allowed_tools` variant; otherwise defaults to all tool names from `tools`. */
  allowedToolNames: Set<string>;
  toolChoice: z.infer<typeof ToolChoiceSchema>;
  parallelToolCalls: boolean;
}
```

## 9.2 Enforcement Rules

- unknown tool names in `tool_choice` => `400`
- unknown tool names in `tool_choice.tools` when `type` is `allowed_tools` => `400`
- duplicate tool names in `tools` => `400`
- `tool_choice: none` means middleware must reject all tool executions
- when `tool_choice` is the `allowed_tools` variant, `allowedToolNames` is derived from its `tools` array; only those tools are executable
- `tool_choice: required` means final assistant completion without at least one tool call is invalid unless the upstream runtime makes that impossible to enforce cleanly; in that case document degraded behavior and fail closed where feasible
- `parallel_tool_calls: false` means middleware or runtime config must serialize tool execution decisions

## 9.3 Responsibility Split

- parse/validate: adapter
- translate to runtime config: tool mapping adapter
- enforce during execution: middleware
- observe resulting behavior: callback bridge
- serialize function-call deltas/results: serializer

-----

## 10. Streaming Truthfulness Standard

### Required rule

Streaming events must come from live runtime observations, not from replaying the final answer as synthetic deltas.

### Implementation standard

- attach callback bridge during actual invocation
- produce deltas as callbacks arrive
- accumulate canonical text state in parallel
- close parts/items only after runtime completion signals or safe inference at terminal boundaries

### Disallowed behavior

- emitting one whole message as a fake single `response.output_text.delta` after the model already completed
- synthesizing `function_call_arguments.delta` events from final JSON unless upstream callback granularity makes this impossible; in that case emit only semantically truthful lifecycle events and document degraded fidelity

-----

## 11. Minimum Image Input Specification

### Scope

This package is text-first. It supports only the minimum input-image behavior required for Open Responses compliance testing.

### Rules

- accept `input_image` parts in request validation
- preserve image-bearing parts through normalization and continuation replay
- pass them through to the underlying runtime/model integration without inventing cross-provider image abstractions beyond what is necessary
- do not promise multimodal output generation in v1
- do not attempt image transformation, storage, or fetch proxying

-----

## 12. Error Mapping Specification

## 12.1 Internal Error Representation

> **Note:** This is the internal TypeScript interface. The wire format follows the Open Responses spec: errors are returned in an `error` object within the response, with `type` set to one of the spec's error types (e.g., `invalid_request_error`). There is no `type: "error"` wrapper—see `ErrorObjectSchema` in Section 4.2 for the Zod schema.

```ts
export interface ErrorObject {
  code: string;
  message: string;
  param?: string | null;
  type: "server_error" | "invalid_request_error" | "not_found" | "model_error" | "too_many_requests";
}
```

## 12.2 Mapping Table

|Source failure                                       |HTTP status            |`code`                       |Stream behavior                          |
|-----------------------------------------------------|----------------------:|-----------------------------|-----------------------------------------|
|invalid JSON body                                    |400                    |`invalid_request`            |no stream                                |
|schema validation failure                            |400                    |`invalid_request`            |no stream                                |
|unsupported content type                             |415                    |`unsupported_media_type`     |no stream                                |
|unknown `previous_response_id`                       |404                    |`previous_response_not_found`|no stream                                |
|malformed stored prior record                        |409                    |`previous_response_unusable` |no stream                                |
|agent/model/tool runtime failure before stream       |500                    |`agent_execution_failed`     |no stream                                |
|agent/model/tool runtime failure after stream started|200 stream already open|`agent_execution_failed`     |emit `response.failed`, then `[DONE]`    |
|serializer failure after stream started              |200 stream already open|`stream_transport_failed`    |best effort `response.failed`, then close|
|unexpected internal failure                          |500                    |`internal_error`             |no stream unless already started         |

-----

## 13. Project Structure and Clean Architecture Layout

### 13.1 Monorepo Shape

```text
/
  package.json
  bun.lock
  tsconfig.json
  biome.json
  packages/
    openresponses-langchain/
      src/
        core/
          errors.ts
          events.ts
          schemas.ts
          types.ts
        adapter/
          invoke-config.ts
          materialize-output.ts
          normalize-input.ts
          previous-response.ts
          tools.ts
        callbacks/
          openresponses-callback-bridge.ts
        state/
          async-event-queue.ts
          item-accumulator.ts
          response-lifecycle.ts
        serializer/
          event-serializer.ts
          json-response.ts
          sse-response.ts
        server/
          context.ts
          errors.ts
          hono.ts
        testing/
          deterministic.ts
          fakes.ts
        index.ts
        server.ts
        testing.ts
      tests/
        compliance.spec.ts
        event-order.spec.ts
        fake-model.spec.ts
        image-input.spec.ts
        previous-response.spec.ts
        tool-calling.spec.ts
      examples/
        node.ts
        bun.ts
        deno.ts
      package.json
      tsconfig.json
      tsup.config.ts
      README.md
```

### 13.2 Package-local standards

- `src/` contains all publishable code
- `tests/` contains package-local tests executed by `bun test`
- `examples/` contains runtime bootstrap references and smoke fixtures
- every publishable workspace package follows the same skeleton so maintenance stays uniform across the monorepo

### 13.3 Dependency direction

- `server` depends on `adapter`, `callbacks`, `state`, `serializer`, `core`
- `serializer` depends on `state` and `core`
- `state` depends on `core`
- `callbacks` depends on `core` and `state`
- `adapter` depends on `core`
- `core` depends on nothing project-local

### 13.4 Clean Architecture rule

## Business semantics of response lifecycle and item/content state must live in `state` and `core`, never in Hono handlers.

## 14. Coding Standards

### 14.1 General

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `verbatimModuleSyntax: true`
- no `any` in exported surfaces
- no default exports except runtime examples if desired
- Biome is the canonical formatter/linter; do not add ESLint + Prettier duplication

### 14.2 Domain placement

- canonical item state logic lives only in `src/state`
- request validation logic lives only in `src/core/schemas.ts`
- transport framing logic lives only in `src/serializer` and `src/server`
- host/runtime auth integration stays outside package internals

### 14.3 Testing discipline

- tests use `bun:test` and run through `bun test`
- every emitted event order is covered by golden tests
- every event union branch has at least one unit test
- every terminal state path has a test
- deterministic tests must inject clock and ID generator

### 14.4 Performance constraints

- no deep cloning of the entire response state on each token
- append deltas into mutable response-scoped buffers, but expose immutable snapshots at serializer boundaries
- validation of outgoing events may be disabled in production builds, but must stay enabled in tests

### 14.5 Logging discipline

- structured logs only
- no token content in logs by default
- request ID and response ID in every log line
- tool input/output logging opt-in and redaction-aware

-----

## 15. CI, Quality Gates, and Release Criteria

## 15.1 Required CI Jobs

- `install` via `bun install --frozen-lockfile`
- `typecheck` via `bun run typecheck`
- `lint` via `bunx @biomejs/biome ci .`
- `unit` via `bun test`
- `golden-stream` via `bun test tests/event-order.spec.ts tests/fake-model.spec.ts`
- `compliance`
- `build` via `bun run build`
- `node-24-smoke`
- `bun-smoke`
- optional `deno-smoke`

## 15.2 Release blockers

The package shall not be released as production-ready unless all of the following pass:

- Open Responses basic text response
- streaming response
- system/developer message handling
- tool calling
- image input minimum path
- multi-turn conversation with `previous_response_id` (field defined in Reference, provides explicit replay semantics)
- event order regression suite
- dual-package import smoke (`import` + `require`)

> **Note:** The compliance page tests multi-turn via "Send assistant + user messages as conversation history." Our implementation uses `previous_response_id` because it is the field explicitly defined in the official Open Responses Reference, which provides the required replay semantics (`prior input + prior output + new input`).

## 15.3 Versioning

- SemVer
- any change to event shape, exported Zod schema, or handler signature is at least minor and possibly major depending on breakage

-----

## 17. Final Technical Standard

This package shall obey four physical laws:

1. **LangChain remains the execution engine.**
1. **Callbacks derive protocol semantics.**
1. **One serializer/writer guarantees public compliance.**
1. **Continuation is builder-owned, but response-ID replay remains a required explicit port.**

Anything that violates one of those four rules is rejected.

-----

## References

### Normative Sources (Product/Framework)

1. LangChain Agents docs — `createAgent()` as production-ready agent runtime: https://docs.langchain.com/oss/javascript/langchain/agents
1. LangChain custom middleware docs — middleware hooks are for execution control: https://docs.langchain.com/oss/javascript/langchain/middleware/custom
1. LangChain callback reference — lifecycle callback surface and `runId` correlation: https://reference.langchain.com/javascript/interfaces/_langchain_core.callbacks_base.CallbackHandlerMethods.html
1. LangChain install / migration docs — Node.js 20+ baseline for current JS packages: https://docs.langchain.com/oss/javascript/langchain/install and https://docs.langchain.com/oss/javascript/migrate/langchain-v1
1. LangGraph persistence docs — checkpointing uses `thread_id`: https://docs.langchain.com/oss/javascript/langgraph/persistence
1. Hono docs — multi-runtime posture: https://hono.dev/docs/
1. Hono streaming helper docs — stream-started errors cannot be replaced by `onError`: https://hono.dev/docs/helpers/streaming
1. Hono RPC docs — typed route export pattern: https://hono.dev/docs/guides/rpc
1. Open Responses specification — semantic events, SSE framing, `[DONE]`, lifecycle rules: https://www.openresponses.org/specification
1. Open Responses reference — request fields and `/v1/responses`: https://www.openresponses.org/reference
1. Node.js release schedule — Node 24 is Active LTS: https://nodejs.org/en/about/previous-releases
1. Bun test docs — built-in `bun test` runner and `bun:test` module: https://bun.sh/docs/test and https://bun.sh/docs/test/writing-tests
1. Biome docs — formatter/linter and CI command surface: https://biomejs.dev/formatter/ and https://biomejs.dev/reference/cli/

### Advisory Sources (Design Literature)

1. Repository pattern reference — Bun workspace root plus package-local `src/`, `tests/`, `examples/`, `README.md`, and `tsup.config.ts`: https://github.com/SkrOYC/langchain-middlewares-callbacks-ts

### Package Ecosystem (Version State)

These are not normative sources but reflect current ecosystem state at the time of specification:

- LangChain: https://www.npmjs.com/package/langchain
- `@langchain/core`: https://www.npmjs.com/package/%40langchain/core
- Hono: https://www.npmjs.com/package/hono
- `@hono/node-server`: https://www.npmjs.com/package/%40hono/node-server
- Zod: https://www.npmjs.com/package/zod
- `@biomejs/biome`: https://www.npmjs.com/package/%40biomejs/biome
- `tsup`: https://www.npmjs.com/package/tsup
- `@types/bun`: https://www.npmjs.com/package/%40types/bun

