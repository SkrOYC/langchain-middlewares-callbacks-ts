# @skroyc/rmm-middleware

Reflective Memory Management (RMM) middleware for LangChain.js with learnable reranking.

## Overview

This package implements the RMM framework from ["In Prospect and Retrospect: Reflective Memory Management for Long-term Personalized Dialogue Agents"](https://arxiv.org/abs/2503.08026v2) (Tan et al., ACL 2025).

RMM addresses critical limitations in current LLM memory systems through:

- **Prospective Reflection**: Dynamic decomposition of dialogue into topic-based memory representations
- **Retrospective Reflection**: Online reinforcement learning for retrieval adaptation using LLM citation signals

## Installation

```bash
bun add @skroyc/rmm-middleware
```

## Requirements

- Node.js >= 20.0.0
- Peer dependencies: `langchain ^1.2.0`, `@langchain/core ^1.0.0`, `@langchain/langgraph ^1.0.0`, `zod ^4.0.0`

## Key Features

- Learnable reranker with lightweight 1536×1536 transformation matrices (~18MB)
- Online RL training via REINFORCE (no labeled data required)
- 10%+ accuracy improvement over baseline memory systems
- 70.4% accuracy with Top-K=20, Top-M=5 configuration

## Documentation

See [SPEC.md](./SPEC.md) for detailed implementation specification, algorithm details, and API reference.

## Official LongMemEval Benchmark

This package includes a ready-to-run benchmark flow against the official
LongMemEval cleaned dataset.

### 1) Install dependencies

```bash
bun install
```

### 2) Configure provider keys/models

```bash
export ANTHROPIC_API_KEY="..."
export ANTHROPIC_API_URL="https://your-anthropic-compatible-endpoint" # optional
export VOYAGEAI_API_KEY="..."

export EVAL_MODEL="your-provider-model-id"
export EVAL_JUDGE_MODEL="your-judge-model-id" # optional, defaults to EVAL_MODEL
export EVAL_EMBEDDINGS_MODEL="voyage-4-lite"
export EVAL_EMBEDDING_DIMENSION="1024"
```

Notes:
- `EVAL_EMBEDDING_DIMENSION` must match your embeddings model output dimension.
  For `voyage-4-lite`, use `1024` (or `256`, `512`, `2048` if you configure those).
- `ANTHROPIC_API_URL` is optional and only needed for Anthropic-compatible endpoints.

### 3) Download official datasets

```bash
bun run download:longmemeval
```

This downloads:
- `data/longmemeval/longmemeval_s_cleaned.json`
- `data/longmemeval/longmemeval_m_cleaned.json`
- `data/longmemeval/longmemeval_oracle.json`

### 4) Run benchmark

LongMemEval-S (recommended first run):

```bash
bun run eval:longmemeval:official:s
```

LongMemEval-M:

```bash
bun run eval:longmemeval:official:m
```

Oracle file:

```bash
bun run eval:longmemeval:official:oracle
```

Outputs are written under `artifacts/` as:
- `summary.json`
- `records.jsonl`
- `progress.json` (updated during execution)
- `run.log` (verbose JSONL trace: prebuild progress, model request/response payloads, per-record metrics)

Runs are resumable by default. If a run is interrupted, re-running the same
command continues from existing `records.jsonl` (already processed
`method + question_id` pairs are skipped).

Embedding calls are cached locally by default to avoid re-paying for repeated
session/query embeddings across reruns. Cache files are stored at:

- `data/longmemeval/cache/embeddings.bin`
- `data/longmemeval/cache/embeddings.index.jsonl`

You can control this behavior with CLI flags:

```bash
bun scripts/run-agent-longmemeval.ts \
  --embedding-cache=true \
  --embedding-cache-path ./data/longmemeval/cache/embeddings \
  --embedding-cache-namespace "voyage-4-lite|dim=1024" \
  --resume=true
```

Topic-memory-bank prebuild (Prospective Reflection) is enabled by default for `rmm`.
You can tune it with:

```bash
bun scripts/run-agent-longmemeval.ts \
  --prebuild-topic-bank=true \
  --prebuild-methods rmm \
  --prebuild-all-before-evaluation=true \
  --reflection-model-adapter ./scripts/adapters/anthropic-model-adapter.ts \
  --reflection-cache=true \
  --reflection-cache-path ./data/longmemeval/cache/reflection-cache.jsonl \
  --prebuild-speaker2=true \
  --prebuild-max-sessions 50
```

Notes:
- For paper alignment, keep `--prebuild-topic-bank=true`.
- `--prebuild-all-before-evaluation=true` enforces a strict two-phase run:
  build topic/summary memory banks for all pending questions first, then run
  answer generation + judging.
- Reflection model calls used for extraction/update are cached locally in
  `reflection-cache.jsonl` and appended as they complete, so interrupted runs
  can resume without repeating paid reflection calls.
- `--prebuild-max-sessions` is optional; omit it for full-dataset runs.
- Set `--log-file <path>` if you want logs outside the output directory.

### Embedding Call Map (Cost Audit)

Use this map when auditing Voyage/embedding usage during prebuild/eval runs.

```text
Legend:
  [E#] = embeddings API call-site
  ──►  = function call
  (N)  = multiplicative loop / repetition

RUNNER: scripts/run-agent-longmemeval.ts
  └─ CachedEmbeddings wrapper
      ├─ cache hit  -> no provider call
      └─ cache miss -> provider embed* call

A) PREBUILD PATH (mode=prebuild or mode=all, method=rmm)
for each question (parallel up to prebuildConcurrency)
  └─ for each session (sequential)
      └─ extractMemories(...)
          └─ [E1] embeddings.embedDocuments(summaries_batch)

      └─ for each extracted memory
          └─ processMemoryUpdate(...)
              ├─ findSimilarMemories(...)
              │   └─ vectorStore.similaritySearch(...)
              │       └─ [E2] embeddings.embedQuery(new_memory_summary)
              └─ addMemory / mergeMemory
                  └─ vectorStore.addDocuments([doc])
                      └─ [E3] embeddings.embedDocuments([summary_or_merged_summary])

B) EVAL PATH (mode=eval/all, method=rmm)
agent.invoke(...)
  ├─ beforeModel hook
  │   ├─ vectorStore.similaritySearch(user_question)
  │   │   └─ [E4] embeddings.embedQuery(user_question)
  │   └─ populateMemoryEmbeddings(topK_memories)
  │       └─ [E5] embeddings.embedDocuments(topK_topic_summaries)
  └─ wrapModelCall hook
      └─ [E6] embeddings.embedQuery(user_question)

  one-time per middleware instance:
    └─ [E7] embeddings.embedQuery("Dimension validation test")

C) EVAL PATH (method=rag) ⚠ potentially expensive
if no persisted rag store exists for question:
  └─ buildRawSessionDocuments(all haystack sessions)
      └─ vectorStore.addDocuments(docs)
          └─ [E8] embeddings.embedDocuments(raw_session_texts_batch)

and per question retrieval:
  └─ vectorStore.similaritySearch(question)
      └─ [E9] embeddings.embedQuery(question)

D) METHOD=oracle
No embeddings calls (oracle retriever uses labeled sessions directly).
```

Interpretation:
- Large embedding bills usually come from high-volume prebuild loops (`E1/E2/E3`)
  and, if enabled without persisted cache, raw-session indexing in RAG (`E8`).
- Strict paper runs should keep `--allow-raw-fallback=false` and persist vector
  stores to avoid accidental raw-session embedding churn.

## License

MIT
