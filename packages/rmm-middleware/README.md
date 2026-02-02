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

## License

MIT
