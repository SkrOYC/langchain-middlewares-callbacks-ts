# SPEC-- Reflective Memory Management (RMM) Middleware for LangChain

## 1. Background

### Context of Origin

This specification implements the **Reflective Memory Management (RMM)** framework from "In Prospect and Retrospect: Reflective Memory Management for Long-term Personalized Dialogue Agents" (Tan et al., ACL 2025, arXiv:2503.08026v2). The paper addresses a critical limitation in current LLM-based dialogue agents: their inability to retain and retrieve relevant information from long-term interactions across multiple sessions.

### Business Problem

Current memory management approaches suffer from two key failures:

1. **Fixed Granularity Problem**: Existing systems digest information at pre-defined boundaries (turn, session, time intervals) that don't align with natural semantic conversation structure. This leads to fragmented, incomplete memory representations.

2. **Static Retriever Problem**: Fixed retrieval mechanisms cannot adapt to diverse dialogue domains and user interaction patterns. They require expensive labeled data for fine-tuning and struggle with topic shifts.

### Proposed Solution

RMM introduces two complementary mechanisms:

- **Prospective Reflection (PR)**: Forward-looking summarization that dynamically decomposes dialogue history into topic-based memory representations, optimizing for future retrieval across utterance/turn/session granularities.

- **Retrospective Reflection (RR)**: Backward-looking retrieval refinement using online reinforcement learning (REINFORCE) based on LLM citation signals. The reranker adapts to user-specific patterns without labeled data.

### Algorithm Overview (Algorithm 1 from paper)

```
Input: query q, past messages S, memory bank B, retriever fθ, reranker gφ, LLM
Output: response a, updated S, gφ, B

1. Retrieve: MK ← fθ(q, B)
2. Rerank: MM ← gφ(q, MK)
3. Generate: a, RM ← LLM(q, S, MM)
4. gφ ← RL_Update(gφ, RM)  // Retrospective reflection
5. S.append((q, a))
6. if session ends:
7.   M ← ExtractMemory(S)   // Prospective reflection
8.   for m ∈ M: B ← UpdateMemory(B, m)
```

### Expected Outcomes

- 10%+ accuracy improvement over baseline without memory management (LongMemEval dataset)
- 5%+ improvement over strongest baseline across retrieval and response generation metrics
- 70.4% accuracy with Top-K=20, Top-M=5 configuration (GTE retriever)

### Implementation Constraints

- RL training is computationally expensive (paper used 16x NVIDIA A100 GPUs)
- Currently limited to textual data (no multi-modal support per paper limitations)
- Privacy considerations for personal conversation storage (encryption recommended)
- Requires TypeScript 5.0+ with strict mode

---

## 2. Requirements

### MoSCoW Prioritization

#### MUST (Non-negotiable for MVP)

| ID | Requirement | Justification |
|----|-------------|---------------|
| M1 | Implement **Prospective Reflection** middleware hook (`afterAgent`) that extracts topic-based memories from completed sessions using LLM summarization | Core paper contribution; enables forward-looking memory organization |
| M2 | Implement **Retrospective Reflection** with learnable reranker using REINFORCE algorithm (Equations 1-3) | Core paper contribution; enables adaptive retrieval without labeled data |
| M3 | Support **Top-K retrieval** (default: 20) and **Top-M reranking** (default: 5) configuration | Paper's optimal configuration achieving 70.4% accuracy |
| M4 | Implement **memory bank state schema** with Zod validation for persistence across agent invocations | Required for LangChain middleware state management |
| M5 | Provide **vector store integration interface** (pluggable, not vendor-locked) | Must work with any embedding-based retrieval (Pinecone, Weaviate, pgvector, etc.) |
| M6 | Implement **citation extraction** from LLM responses to generate reward signals (+1 cited, -1 not cited) | Required for RR online learning loop |
| M7 | TypeScript strict mode compliance with full type safety for all middleware hooks | Architectural mandate |
| M8 | Implement **Gumbel-Softmax sampling** with temperature parameter τ (default: 0.5) for stochastic reranking | Equation 2 from paper; enables differentiable sampling |

#### SHOULD (Important but not blocking)

| ID | Requirement | Justification |
|----|-------------|---------------|
| S1 | **Embedding adaptation** with residual connections (Equation 1): q' = q + Wq·q, m' = m + Wm·m | Improves retrieval quality; lightweight adaptation |
| S2 | **Memory merge vs. add** logic using LLM-based similarity detection | Prevents duplicate memories; consolidates topic evolution |
| S3 | **Session boundary detection** (automatic or explicit) | Trigger for Prospective Reflection memory extraction |
| S4 | **Baseline reward subtraction** (b = 0.5) for REINFORCE variance reduction | Equation 3 from paper; stabilizes learning |
| S5 | Learning rate configuration for reranker updates (η = 1×10⁻³ default) | Hyperparameter tuning for different domains |

#### COULD (Nice to have)

| ID | Requirement | Justification |
|----|-------------|---------------|
| C1 | **Offline pretraining** support for retriever using supervised contrastive learning | Section 8.6 shows consistent benefits |
| C2 | **Multi-user isolation** with per-user memory banks | Production deployment requirement |
| C3 | **Memory importance scoring** with decay mechanisms | Future enhancement beyond paper scope |
| C4 | **Streaming memory updates** during long sessions (not just at session end) | Real-time adaptation |

#### WON'T (Out of scope)

| ID | Requirement | Reason |
|----|-------------|--------|
| W1 | Multi-modal memory (images, audio, video) | Paper limitation; future work |
| W2 | Privacy-preserving techniques (differential privacy, federated learning) | Ethical consideration but requires separate architecture |
| W3 | Custom embedding model training | Assume pre-trained retrievers (GTE, Stella, Contriever) |
| W4 | Distributed/horizontal scaling of reranker training | Single-node RL training sufficient for MVP |

---

## 3. Method

### 3.1 Architecture Overview

**Scope Boundary**: RMM operates entirely within the LangChain **Middleware API** layer. It does not interact with streaming tokens or callback handlers—those are separate subsystems in LangChain.

The RMM middleware integrates with LangChain's `createAgent` via five lifecycle hooks:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RMM Middleware Architecture                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │
│  │ beforeAgent  │────▶│ beforeModel  │────▶│wrapModelCall │                │
│  └──────────────┘     └──────────────┘     └──────┬───────┘                │
│        │ Initialize           │ Retrieve Top-K     │                        │
│        │ reranker state       │ from memory bank   │ Rerank to Top-M        │
│        │                      │                    │ Inject to prompt       │
│        ▼                      ▼                    ▼                        │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │
│  │ Memory Bank  │     │   Vector     │     │     LLM      │                │
│  │  (State)     │◄────│    Store     │◄────│  (Citation)  │                │
│  └──────────────┘     └──────────────┘     └──────┬───────┘                │
│        ▲                                          │                         │
│        │ afterModel                              │                         │
│        │ Update reranker                         │                         │
│        │ via RL (REINFORCE)                      │                         │
│        │                                          │                         │
│        ▼                                          │                         │
│  ┌──────────────┐                                 │                         │
│  │ afterAgent   │◄────────────────────────────────┘                         │
│  └──────────────┘                                                          │
│        │ Extract & summarize                                                 │
│        │ (if session ends)                                                   │
│        ▼                                                                    │
│  ┌──────────────┐                                                          │
│  │ Update Memory│                                                          │
│  │    Bank      │                                                          │
│  └──────────────┘                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Models

#### 3.2.1 Memory Entry Schema

```typescript
// Core memory unit stored in memory bank
interface MemoryEntry {
  id: string;                    // UUID v4
  topicSummary: string;          // Extracted topic (e.g., "User enjoys hiking")
  rawDialogue: string;           // Original dialogue segments
  timestamp: number;             // Unix timestamp (ms)
  sessionId: string;             // Source session identifier
  embedding: number[];           // Dense vector (1536-dim for text-embedding-3)
  turnReferences: number[];      // Turn indices where info appeared
}

// Retrieved memory with scores
interface RetrievedMemory extends MemoryEntry {
  relevanceScore: number;        // Initial retrieval score (cosine similarity)
  rerankScore?: number;          // Post-adaptation score
}
```

#### 3.2.2 Reranker State Schema

```typescript
// Learnable reranker - EXTREMELY LIGHTWEIGHT
// NOT a neural network. NOT a transformer. Just two linear matrices.
// 
// Architecture: Equation 1 implements linear transformation + residual:
//   q' = q + W_q · q  (matrix multiply + add)
//   m' = m + W_m · m  (matrix multiply + add)
//
// That's it. No activations. No layers. Just matrix math.
// Training: REINFORCE updates W_q and W_m directly (no backprop through LLM).
//
// Memory: 2 × (1536 × 1536) floats ≈ 18MB total. Updates every turn in <1ms on CPU.
interface RerankerState {
  weights: {
    // Trainable linear transformation matrices (1536×1536)
    // These are the ONLY learnable parameters in the entire system
    // Per-element initialization: W_q[i][j] ~ N(0, 0.01), W_m[i][j] ~ N(0, 0.01)
    // Total: 2 × 1536 × 1536 ≈ 4.7M floats ≈ 18MB (32-bit)
    queryTransform: number[][];   // W_q in Equation 1
    memoryTransform: number[][];  // W_m in Equation 1
  };
  
  // Hyperparameters from paper Appendix A.1
  config: {
    topK: number;                 // Retrieved candidates (default: 20)
    topM: number;                 // Reranked candidates (default: 5)
    temperature: number;          // Gumbel τ for sampling (default: 0.5)
    learningRate: number;         // REINFORCE η (default: 1e-3)
    baseline: number;             // REINFORCE b (default: 0.5)
  };
}

// NOTE: For evaluation/benchmarking only
// Oracle retriever returns ground-truth turns (upper bound performance)
// Not for production use - reference only
interface OracleRetrieverConfig {
  enabled: boolean;  // false for production
  groundTruthData: Map<string, MemoryEntry[]>;
}
```

#### 3.2.3 Citation Record Schema

```typescript
// Evidence of memory utility for RL reward
interface CitationRecord {
  memoryId: string;              // Which memory was cited
  cited: boolean;                // True if LLM referenced this memory
  reward: number;                // +1 (useful) or -1 (not useful)
  turnIndex: number;             // When citation occurred
}
```

**Citation Output Formats** (per Appendix D.2):
- **Cited memories**: `[0, 2, 4]` - Indices of useful memories from Top-M set
- **No useful memories**: `[NO_CITE]` - All Top-M memories receive R = -1
- **Note**: Indices are 0-based relative to the M memories sent to LLM, not the full memory bank

#### 3.2.4 Storage Architecture: Three-Layer Design

**Critical Architectural Decision**: RMM uses a three-layer storage strategy optimized for different data lifecycles:

| Layer | Scope | System | Data Stored | Persistence |
|-------|-------|--------|-------------|-------------|
| **Conversation** | Thread | State (Checkpointer) | Session markers, turn counters, citations | LangGraph native |
| **Memory Content** | User | VectorStore | Memory documents + embeddings | Vector index + docstore |
| **RL State** | User | BaseStore | Reranker weights, metadata | Cross-thread durable |

**Layer 1: Conversation State (Thread-Scoped)**

LangGraph automatically checkpoints `state.messages` with `thread_id`. RMM adds minimal session semantics:
- `_sessionStartIndex`: Message index marking session start
- `_turnCountInSession`: Turns since session start
- `_citations`: Per-turn citation records (transient)
- `_retrievedMemories`: Current turn's Top-K (transient)

```
sessionHistory = state.messages.slice(state._sessionStartIndex)
// Leverages native checkpointing, zero duplication
```

**Layer 2: Memory Content (User-Scoped via VectorStore)**

Per LangChain patterns (FAISS, HNSWLib, Chroma), VectorStore maintains **internal dual storage**:
- **Vector Index**: Embeddings for similarity search
- **Docstore**: Full documents with metadata (synchronized via internal ID mapping)

```typescript
// VectorStore handles embedding + storage automatically
await vectorStore.addDocuments([
  new Document({ 
    pageContent: "User enjoys hiking", 
    metadata: { sessionId: "sess-1", turnRefs: [0, 2] }
  })
])
// Embeddings generated internally, stored in vector index
// Documents stored in internal docstore
```

**Layer 3: RL State (User-Scoped via BaseStore)**

BaseStore persists only lightweight RL-specific data:
```
Namespace: ["rmm", userId, dataType]

["rmm", "user-123", "weights"]     → { W_q, W_m, updatedAt }  
["rmm", "user-123", "metadata"]    → { version, configHash }
```

**Why Three Layers:**
- **Separation of concerns**: Conversation ≠ Memory Content ≠ RL State
- **VectorStore handles embeddings**: No manual embedding management
- **BaseStore for fast updates**: Weight matrices update frequently (every turn)
- **LangGraph native for messages**: No duplication, automatic checkpointing

### 3.3 Algorithm Specifications

#### 3.3.1 Embedding Adaptation (Equation 1)

**Purpose**: Refine query and memory embeddings before computing similarity scores.

**Mathematical Specification**:
```
q' = q + W_q · q    (Query transformation)
m' = m + W_m · m    (Memory transformation)
```

**Architectural Decisions**:
- **Linear + Residual**: Simple linear layer with skip connection prevents degradation of original embedding quality
- **Separate Matrices**: Query and memory use different transformation matrices (W_q ≠ W_m) to handle asymmetric relationships
- **Dimension Preservation**: Input and output dimensions identical (1536-dim for typical embeddings)
- **Initialization**: Small random values ~N(0, 0.01) for stable training start

**What the Reranker IS:**
- Two matrices: W_q (1536×1536) and W_m (1536×1536)
- Forward pass: matrix multiply + addition (Equation 1)
- Scoring: dot product q'^T · m'_i
- Selection: Gumbel-softmax sampling (Equation 2)
- Training: REINFORCE policy gradient (Equation 3)

**What the Reranker is NOT:**
- ❌ Neural network (no layers, no activations)
- ❌ Transformer (no attention, no feedforward blocks)
- ❌ Deep learning model (just matrix math)
- ❌ Trained via backpropagation (uses REINFORCE, no gradients through LLM)

**Training**: Matrices updated via REINFORCE (Section 3.3.3), not backpropagation through LLM.

**Why So Simple?**
The paper explicitly designed this to be "lightweight" (Section 6.1). The retriever (GTE, Stella, Contriever) does the heavy lifting. The reranker just "nudges" embeddings to better align with user-specific patterns via these two small matrices.

#### 3.3.2 Gumbel-Softmax Sampling (Equation 2)

**Purpose**: Stochastic selection of Top-M memories while maintaining differentiability for RL.

**Mathematical Specification**:
```
g_i = -log(-log(u_i)),  u_i ~ Uniform(0,1)    (Gumbel noise)
s̃_i = s_i + g_i                                (Perturbed score)
p_i = exp(s̃_i/τ) / Σ_j exp(s̃_j/τ)            (Selection probability)
```

**Hyperparameters**:
- **τ (temperature)**: 0.5 (paper default)
  - Lower τ → more deterministic (exploitation)
  - Higher τ → more stochastic (exploration)

**Why Gumbel?**: Enables gradient flow through discrete sampling decisions for policy gradient methods.

#### 3.3.3 REINFORCE Update (Equation 3)

**Purpose**: Update reranker weights based on LLM citation feedback without labeled data.

**Mathematical Specification**:
```
Δφ = η · (R - b) · ∇_φ log P(M_M | q, M_K; φ)
```

**Reward Assignment** (per Section 6.2):
- **R = +1**: Memory cited in LLM response as [i] (Useful)
- **R = -1**: Memory not cited or [NO_CITE] returned (Not Useful)
- **Binary attribution**: Simple useful/not-useful classification enables unsupervised learning
- **Variance Reduction**: Baseline b = 0.5 reduces gradient variance in REINFORCE update

**Hyperparameters** (from paper Appendix A.1):
- **η (learning rate)**: 1×10⁻³
- **b (baseline)**: 0.5 (variance reduction)
- **Batch size**: 4

**Architecture Note**: Simplified gradient update without autograd framework. Production implementations may use TensorFlow.js or ONNX for GPU acceleration.

#### 3.3.4 Memory Extraction (Prospective Reflection)

**Trigger**: End of session (explicit signal)

**Input**: Complete session dialogue (user + assistant turns)

**Process**:
1. **LLM Prompt** (Appendix D.1.1): Extract personal summaries with turn references
2. **Output Format**:
   ```json
   {
     "extracted_memories": [
       {
         "summary": "User enjoys hiking on weekends",
         "reference": [0, 2]
       }
     ]
   }
   ```
3. **No Memories**: Returns "NO_TRAIT" string

**Output**: Array of MemoryEntry objects with embeddings generated via embedding model.

#### 3.3.5 Memory Update (Merge vs Add)

**Purpose**: Integrate new memories without duplicating existing topics.

**Decision Process**:
1. For each extracted memory, find Top-K similar existing memories (cosine similarity)
2. Use LLM prompt (Appendix D.1.2) to determine merge eligibility
3. Execute action:
   - **Add()**: New topic → append to memory bank
   - **Merge(index, merged_summary)**: Existing topic → update in place

**Action Format**:
```
Single: Merge(0, "Updated summary...")
Multiple: Merge(0, "...")
Add()
```

**Architectural Decision**: Merge prevents memory bank fragmentation and maintains coherent topic representations across sessions.

### 3.4 Middleware Hook Implementations

#### 3.4.1 beforeAgent: Initialize State and Load Weights

**Responsibility:** Initialize transient session state and load reranker weights from BaseStore.

**Architectural Specification:**
- **Trigger:** Called once per agent invocation before any model interaction
- **BaseStore Operations:**
  - Query BaseStore namespace `["rmm", userId, "weights"]` for existing reranker weights
  - If found: Load stored W_q and W_m matrices into transient state
  - If not found: Initialize with small random values ~N(0, 0.01)
- **State Operations:**
  - Reset `_sessionMessages`, `_citations`, `_retrievedMemories` to empty
  - Set `_turnCount = 0`
  - Validate `userId` exists in runtime context (mandatory)

**Storage Architecture Note:**
Reranker weights persist in BaseStore (cross-thread), not in checkpoint state. This ensures:
- RL training progress survives agent restarts
- Multi-turn conversations resume with learned weights
- No checkpoint bloat from 18MB weight matrices

**Output State Delta:** Transient state fields only; no checkpoint-persisted data modified

#### 3.4.2 beforeModel: Retrieve Memories

**Responsibility:** Execute Step 1 of Algorithm 1 (Retrieve Top-K from memory bank).

**Architectural Specification:**
- **Input:** Current conversation state with message history, vector store reference
- **Query Extraction:** Identify last human message from `state.messages` array
- **Retrieval Logic:**
  - Skip retrieval if: (a) no human query exists, or (b) memory bank is empty
  - Execute `vectorStore.similaritySearch(query, topK=20)` per Section 7.1 defaults
- **Cold Start Behavior:**
  - First session: VectorStore is empty → retrieval returns [] → agent runs without context
  - After session ends: Prospective Reflection extracts memories → VectorStore populated
  - Subsequent sessions: Retrieval finds memories → RMM activates
- **Output Format:** Array of `RetrievedMemory` objects with metadata and relevance scores

**Note:** Top-K (retrieved) ≥ Top-M (reranked). Defaults: K=20, M=5. If retrieval returns < M memories, use all available (Gumbel sampling adjusts automatically).

**State Updates:**
- `_retrievedMemories`: Populated with Top-K results
- `_turnCount`: Incremented (used for session boundary detection)

#### 3.4.3 wrapModelCall: Rerank and Inject

**Responsibility:** Execute Steps 2-3 of Algorithm 1 (Rerank and Generate, with citation extraction from LLM response).

**Architectural Specification:**

**Step 2: Embedding Adaptation** (Equation 1)
- Get query embedding from user's `embeddings.embedQuery(query)`
- Transform query embedding: **q' = q + W_q · q** (element-wise: q'[i] = q[i] + Σ_j W_q[i][j]·q[j])
- For each of Top-K memory embeddings: **m'_i = m_i + W_m · m_i**
- Compute relevance scores via dot product: **s_i = q'^T · m'_i = Σ_j q'[j]·m'_i[j]**

**Important:** Reranker uses the same embeddings as the VectorStore (already compatible). No separate embedding call needed for memories—they're retrieved with their embeddings from the VectorStore.

**Step 3: Gumbel-Softmax Sampling** (Equation 2)
- Add Gumbel noise: **g_i = -log(-log(u_i))** where **u_i ~ Uniform(0,1)**
- Compute perturbed scores: **ṡ_i = s_i + g_i**
- Apply softmax with temperature τ=0.5: **p_i = exp(ṡ_i/τ) / Σ_j exp(ṡ_j/τ)**
- Stochastically select Top-M=5 memories based on probabilities

**Ephemeral Context Injection (KV Cache Optimized):**
- Format selected memories as `<memories>` block using format from Appendix D.2
- Append as **ephemeral HumanMessage** using LangChain message class
- **Critical**: This message is seen by model but NOT persisted to `state.messages`
- System prompt contains citation instructions (per Appendix D.2) and remains **static** enabling KV cache prefix optimization

**Pattern:**
```typescript
const ephemeralMessage = new HumanMessage({
  content: `<memories>\n${formatMemories(selectedMemories)}\n</memories>`
});

return handler({
  ...request,
  messages: [...request.messages, ephemeralMessage]
});
```

**Why This Pattern:**
- System message unchanged → KV cache prefix preserved
- User query untouched → Intent preserved exactly
- Context isolated → No checkpoint bloat
- Only AIMessage response persists → Clean state history
- Model sees context + query together → Per paper's architecture

**Single LLM Call Architecture** (Paper Section 6.2)
- The LLM generates **both response AND citations in a single call**, reducing computational overhead
- Citation instructions are embedded in the prompt (Appendix D.2), not added as separate messages
- This design ensures citations are generated conditioned on the response (more effective than prior/post-hoc citations)

**Citation Extraction (Post-Generation)**
- Parse complete LLM response for citation markers per Appendix D.2:
  - `[i, j, k]` format: Memories at indices i, j, k were cited as useful
  - `[NO_CITE]`: No useful memories found (all Top-M receive R = -1)
- **Note**: `wrapModelCall` receives full `AIMessage` response (not streaming chunks), so citation parsing operates on complete text
- Map citations to Top-M selected memory indices (0-indexed from the M memories sent to LLM)
- Compute binary rewards: **R = +1** (cited) or **R = -1** (not cited)
- Store `_citations` in transient state for Step 4 (REINFORCE update in `afterModel`)

#### 3.4.4 afterModel: Update Reranker and Persist Weights

**Responsibility:** Execute Steps 4-5 of Algorithm 1 (REINFORCE weight update and weight persistence).

**Architectural Specification:**

**Session Progress Tracking:**
- Increment `_turnCountInSession` counter
- LangGraph's native `state.messages` already contains full conversation (checkpointed)
- No manual accumulation needed - RMM only tracks session metadata

**REINFORCE Update** (Equation 3):
- **Δφ = η · (R - b) · ∇_φ log P(M_M | q, M_K; φ)**
- Hyperparameters from Appendix A.1:
  - Learning rate **η = 1 × 10^-3**
  - Baseline **b = 0.5**
  - Batch size = 4 (gradient accumulation across turns)

**Gradient Accumulation Pattern:**
1. Each turn computes gradients for the selected Top-M memories
2. Accumulate gradients in transient state: `_gradientAccumulator.push(Δφ)`
3. When accumulator reaches batch size (4 turns):
   - Apply accumulated gradient update to W_q and W_m
   - Clear accumulator
   - Persist updated weights to BaseStore
4. If session ends with partial batch (< 4 turns), apply partial update (online learning)

**Policy Gradient Computation:**
- Compute log-probability of selected Top-M memories under current policy (Gumbel-softmax probabilities)
- Scale by advantage (R - b) for each selected memory
- **Gradient components:**
  - `∇_Wq` (1536×1536): Gradient w.r.t. query transformation matrix
  - `∇_Wm` (1536×1536): Gradient w.r.t. memory transformation matrix
- **Update per turn:** ΔW_q = η·(R-b)·∇_Wq, ΔW_m = η·(R-b)·∇_Wm
- Accumulate across 4 turns, then apply: W_q += ΣΔW_q, W_m += ΣΔW_m

**BaseStore Persistence (Critical):**
After each gradient update (or batch accumulation), persist updated weights to BaseStore:
- Namespace: `["rmm", userId, "weights"]`
- Key: `"reranker"`
- Value: `{ queryTransform: W_q, memoryTransform: W_m, updatedAt: timestamp }`

**Why Immediate Persistence:**
- Ensures RL progress survives crashes or unexpected agent termination
- Enables weight recovery on checkpoint restore (weights are transient in state)
- Supports multi-thread sharing (same userId sees same weights across threads)

**State Updates:**
- `_turnCountInSession`: Incremented
- `_citations`: Cleared for next turn

#### 3.4.5 afterAgent: Prospective Reflection and Memory Persistence

**Responsibility:** Execute Steps 7-8 of Algorithm 1 (Extract and Update Memory Bank) when session ends.

**Architectural Specification:**

**Session End Detection:**
- **Explicit Signal:** Caller sets `isSessionEnd: true` in runtime context
- **Minimum Threshold:** `_turnCountInSession >= 1` to qualify for extraction

**Leveraging Native Checkpointed Messages:**
Session history is extracted from LangGraph's native `state.messages`:
```
sessionHistory = state.messages.slice(state._sessionStartIndex)
```

This approach:
- Uses existing checkpointed data (no duplication)
- Naturally handles thread interruption/resume
- Supports sessions spanning multiple agent invocations

**Step 7: Memory Extraction** (Appendix D.1.1)
- **Input:** `state.messages.slice(_sessionStartIndex)` - native checkpointed conversation
- **LLM Prompt:** Topic-based extraction with JSON output schema
  - **Note:** Paper provides two separate prompts (SPEAKER_1 and SPEAKER_2 versions) for multi-party dialogue
  - For single-user agents, use SPEAKER_1 prompt template with user marked as the target speaker
- **Output Format:** Array of memory entries with topicSummary, rawDialogue, turn references
- **No Memories Case:** Returns `"NO_TRAIT"` string when no personal information can be extracted

**Step 8: Memory Bank Update** (Appendix D.1.2)
- For each extracted memory:
  1. Query BaseStore namespace `["rmm", userId, "memories"]` for similar existing entries
  2. LLM decides: **Add** (new topic) or **Merge** (update existing)
  3. Execute: `store.put(["rmm", userId, "memories"], memoryId, memoryData)`

**Storage Architecture Clarification:**

Per LangChain patterns (FAISS, HNSWLib implementations), **VectorStore already maintains dual storage internally**:
- **Vector Index**: Stores embeddings for similarity search
- **Docstore**: Stores full documents with metadata (synchronized via ID mapping)

**RMM Storage Strategy:**
1. **VectorStore**: Primary storage for memory entries (content + embeddings)
   - Uses `vectorStore.addDocuments()` which internally embeds and stores
   - Similarity search returns Document objects with metadata
   - ID mapping handled internally by VectorStore

2. **BaseStore**: Stores RL-specific data only
   - Namespace `["rmm", userId, "weights"]`: Reranker matrices (W_q, W_m)
   - Namespace `["rmm", userId, "metadata"]`: Session counters, version info
   - **Not** for memory content (that's in VectorStore's docstore)

**Memory Update Flow:**
```
ExtractMemory(S) → LLM generates summaries
                    ↓
            Create Document objects
         {pageContent: summary, metadata: {...}}
                    ↓
    vectorStore.addDocuments(docs)  
    ├─ Embeddings generated via embeddings.embedDocuments()
    ├─ Vectors stored in vector index
    └─ Documents stored in internal docstore
```

**Why This Pattern:**
- VectorStore handles embedding generation and storage automatically
- No manual synchronization needed between vectors and documents
- BaseStore only for RL state (lightweight, fast updates)
- Consistent with LangChain community patterns (FAISS, HNSWLib, Chroma)

**Session State Reset:**
- Update `_sessionStartIndex = state.messages.length` (mark start of next session)
- Reset `_turnCountInSession = 0`
- Thread continues with full message history intact (LangGraph checkpoint)

---

## 4. Implementation

### 4.1 Package Structure

```
packages/
└── rmm-middleware/
    ├── src/
    │   ├── middleware/
    │   │   ├── createRMMMiddleware.ts    # Main factory function
    │   │   ├── hooks/
    │   │   │   ├── beforeAgent.ts
    │   │   │   ├── beforeModel.ts
    │   │   │   ├── wrapModelCall.ts
    │   │   │   ├── afterModel.ts
    │   │   │   └── afterAgent.ts
    │   │   └── prompts/                  # BUILT-IN prompts (paper Appendix D)
    │   │       ├── extractSpeaker1.ts    # Appendix D.1.1 - SPEAKER_1 extraction
    │   │       ├── extractSpeaker2.ts    # Appendix D.1.1 - SPEAKER_2 extraction
    │   │       ├── updateMemory.ts       # Appendix D.1.2 - Add/Merge decisions
    │   │       └── generateWithCitations.ts  # Appendix D.2 - Response + citations
    │   │
    │   │   **NOTE:** Prompts are BUILT-IN and not user-configurable.
    │   │   User provides LLM instance; RMM provides prompt templates.
    │   │   This ensures paper-faithful implementation.
    │   │   └── types.ts
    │   ├── algorithms/
    │   │   ├── embeddingAdaptation.ts    # Equation 1
    │   │   ├── gumbelSampling.ts         # Equation 2
    │   │   ├── reinforceUpdate.ts        # Equation 3
    │   │   ├── memoryExtraction.ts       # Prospective Reflection
    │   │   └── memoryUpdate.ts           # Merge/Add logic
    │   ├── storage/
    │   │   ├── weightStorage.ts          # External weight persistence
    │   │   └── memoryBankStorage.ts      # Optional: external memory storage
    │   ├── utils/
    │   │   ├── cosineSimilarity.ts
    │   │   ├── citationExtractor.ts
    │   │   └── promptBuilders.ts
    │   └── index.ts
    ├── tests/
    │   ├── unit/
    │   │   ├── algorithms.test.ts
    │   │   └── hooks.test.ts
    │   └── integration/
    │       └── rmmWorkflow.test.ts
    └── package.json
```

### 4.2 Interface Definitions

#### Required Interfaces

**Mandatory Dependencies:**

| Interface | Source | Purpose |
|-----------|--------|---------|
| `vectorStore` | `@langchain/core/vectorstores` | Similarity search for Algorithm 1 Step 1 |
| `embeddings` | `@langchain/core/embeddings` | Query encoding for reranker (must match vector store dimensions) |
| `store` | `@langchain/langgraph-checkpoint` | Long-term persistence via BaseStore |
| `summarizationModel` | `@langchain/core/language_models` | LLM for memory extraction and merge decisions |
| `userId` | Application-provided | Namespace isolation for multi-tenant deployments |

**Critical Integration Requirements:**

1. **Embeddings Compatibility:** The `embeddings` instance for query encoding must produce vectors compatible with the `vectorStore` embedding space. Dimension mismatch (e.g., 1536-dim queries vs 768-dim memories) will cause retrieval failures.

2. **BaseStore Namespace Isolation:** All storage operations use hierarchical namespaces: `["rmm", userId, dataType]`. The `userId` parameter is **mandatory**, not optional.

3. **Dual Storage Pattern:**
   - **VectorStore**: Enables similarity search for retrieval (Algorithm 1 Step 1)
   - **BaseStore**: Provides durable, namespaced storage for memory bank and weights
   - Both must be synchronized on memory updates

4. **Context Schema:** Runtime context must include:
   - `userId`: For namespace isolation
   - `isSessionEnd`: Boolean signal for Prospective Reflection trigger
   - `store`: BaseStore instance for persistence operations

#### Hook Return Types

All state-modifying hooks return `MiddlewareResult<T>`:

```typescript
type MiddlewareResult<T> = 
  | (Partial<T> & { jumpTo?: JumpToTarget })  // State updates + optional jump
  | void                                      // No changes
  | undefined;                                // No changes

// Valid returns:
beforeModel: async (state, runtime) => {
  // Return partial state updates
  return { _turnCount: state._turnCount + 1 };
  
  // Or return void for no changes
  return;
  
  // Or return undefined (implicit)
  // (no return statement)
  
  // Or trigger execution jump
  return { jumpTo: "end" };  // Requires canJumpTo: ["end"] in hook config
}
```

### 4.3 Dependencies

```json
{
  "peerDependencies": {
    "langchain": "^1.2.0",
    "@langchain/core": "^0.3.0",
    "@langchain/langgraph": "^0.2.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  }
}
```

**Note on `@langchain/langgraph`**: Required for `StateSchema`, `ReducedValue`, and `UntrackedValue` types used in the middleware state definition.

### 4.4 Build Configuration

**Build System:** tsup with ESM-only output

**Key Configuration Requirements:**
- **Format:** ESM only (no CommonJS)
- **Target:** ES2022 for modern JavaScript features
- **Platform:** Neutral (browser/Node.js compatible)
- **Externals:** langchain, @langchain/core, @langchain/langgraph, zod (peer dependencies)
- **Outputs:** 
  - Compiled JavaScript (dist/index.js)
  - TypeScript declarations (dist/index.d.ts)
  - Source maps for debugging

**Rationale for Peer Dependencies:**
The middleware integrates with LangChain's `createAgent` at runtime. Bundling these dependencies would create version conflicts when users have different LangChain versions.

### 4.5 Integration Architecture

**Middleware Instantiation Pattern:**

**Constructor Dependencies:**
1. **vectorStore** - Any `VectorStoreInterface` implementation (Chroma, Pinecone, Weaviate, etc.)
2. **embeddings** - Query encoder (must match vector store embedding dimensions)
3. **store** - BaseStore instance for durable persistence (memory bank, weights)
4. **summarizationModel** - LLM for memory extraction and merge/add decisions
5. **rerankerConfig** - Hyperparameters from Appendix A.1 (topK=20, topM=5, τ=0.5, η=1e-3)

**Runtime Context Requirements:**
- **userId** (mandatory): Namespace isolation for multi-tenant deployments
- **isSessionEnd** (optional): Boolean signal to trigger Prospective Reflection
- **store**: BaseStore instance (passed via runtime context or constructor)

**Multi-Turn Session Architecture:**

RMM leverages LangGraph's native checkpointed `state.messages` for conversation history:

```
Turn 1: thread_id="user-123", messages=[user: "Hello"]
  → beforeAgent: Load weights, _sessionStartIndex=0
  → afterModel: _turnCountInSession=1
  → Checkpoint saves: messages + RMM state

Turn 2: thread_id="user-123", messages=[user: "How are you?"]
  → LangGraph merges: messages=[Hello, Hi, How are you?, ...]
  → beforeAgent: Loads checkpoint (_sessionStartIndex=0 preserved)
  → afterModel: _turnCountInSession=2

[Session ends, isSessionEnd=true]
  → afterAgent: Extract from messages.slice(0)
  → Reset: _sessionStartIndex=4, _turnCountInSession=0

Turn 3: New session begins
  → _sessionStartIndex=4 marks new session boundary
  → Full history retained, PR extracts from index 4 onwards
```

**Dual Storage Architecture:**
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  LangGraph      │     │   VectorStore   │     │    BaseStore    │
│  State          │     │  (Retrieval)    │     │ (Persistence)   │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ messages[]      │     │ Similarity      │     │ Namespace:      │
│ (checkpointed)  │     │ Search          │     │ ["rmm", userId] │
│ _sessionStart   │     │ (Algorithm 1)   │     │                 │
│ _turnCount      │     │ Step 1          │     ├─────────────────┤
└─────────────────┘     └─────────────────┘     │ /memories       │
                                                │ /weights        │
                                                └─────────────────┘
```

**Execution Flow with Storage:**
```
Agent Invocation
    ↓
beforeAgent()
  ├─ Load weights from BaseStore ["rmm", userId, "weights"]
  └─ Initialize transient state
    ↓
beforeModel()
  ├─ Query VectorStore for Top-K similar memories
  └─ Store candidates in transient state
    ↓
wrapModelCall()
  ├─ Rerank via learned weights (transient state)
  ├─ Inject Top-M into system prompt
  └─ Extract citations from LLM response
    ↓
afterModel()
  ├─ REINFORCE update on weight matrices
  ├─ Persist updated weights to BaseStore
  └─ Increment _turnCountInSession
    ↓
afterAgent() [if isSessionEnd=true]
  ├─ Extract from state.messages.slice(_sessionStartIndex)
  ├─ Merge/Add to BaseStore ["rmm", userId, "memories"]
  └─ Sync to VectorStore for retrieval
```

**Namespace Isolation:**
- All BaseStore operations use path: `["rmm", userId, dataType]`
- Prevents cross-user data leakage in multi-tenant deployments
- Enables per-user RL training (reranker adapts to individual patterns)

---

## 5. Milestones

### Milestone 1: Foundation (Week 1)
- [ ] Project scaffolding with TypeScript strict mode
- [ ] Zod schemas for all data models
- [ ] Vector store interface definition
- [ ] Unit tests for cosine similarity and basic utilities

### Milestone 2: Prospective Reflection (Week 2)
- [ ] Memory extraction prompt implementation (Appendix D.1.1)
- [ ] Memory update logic with merge/add detection (Appendix D.1.2)
- [ ] `afterAgent` hook implementation
- [ ] Integration tests for session memory extraction

### Milestone 3: Retrospective Reflection - Retrieval (Week 3)
- [ ] `beforeModel` hook with Top-K retrieval
- [ ] `wrapModelCall` hook for memory injection
- [ ] Embedding adaptation with residual connections (Equation 1)
- [ ] End-to-end retrieval flow tests

### Milestone 4: Retrospective Reflection - Learning (Week 4)
- [ ] Gumbel-Softmax sampling implementation (Equation 2)
- [ ] Citation extraction from LLM responses
- [ ] REINFORCE weight updates (Equation 3)
- [ ] `afterModel` hook with reranker updates
- [ ] Full workflow integration tests

### Milestone 5: Production Hardening (Week 5)
- [ ] Error handling and edge cases
- [ ] Performance optimization (batch operations, caching)
- [ ] Documentation and usage examples
- [ ] Benchmark evaluation on sample dataset

---

## 6. Gathering Results

### 6.1 Key Performance Indicators

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Recall@5 | ≥60% | Retrieved relevant memories / Total relevant |
| Accuracy (LongMemEval) | ≥65% | LLM-as-judge evaluation |
| Memory extraction precision | ≥85% | Manual evaluation on sample sessions |
| RL convergence | ≤1000 steps | Usefulness score >0.4 (Figure 6) |
| Latency overhead | <200ms | Per-turn middleware execution time |

### 6.2 Success Criteria

**Minimum Viable:**
- Prospective Reflection extracts and stores memories without errors
- Retrospective Reflection retrieves and reranks memories
- Citation-based rewards update reranker weights
- Type safety maintained throughout

**Production Ready:**
- Matches paper's reported accuracy on LongMemEval (70.4% with GTE)
- Handles 100+ session history without degradation
- <100ms latency overhead per turn
- Memory bank operations are idempotent

### 6.3 Post-Production Validation

1. **A/B Testing**: Compare RMM-enabled agents vs. baseline on:
   - User satisfaction scores
   - Conversation coherence ratings
   - Memory recall accuracy in multi-session scenarios

2. **Monitoring Dashboards**:
   - Reranker weight convergence over time
   - Memory bank growth rate
   - Citation rate (useful vs. non-useful memories)
   - Error rates by component

3. **Continuous Improvement**:
   - Log successful/failed retrievals for offline analysis
   - Collect user feedback on memory relevance
   - Periodic re-training of retriever embeddings

---

## Appendix E: Reference Equations from Paper

### Equation 1: Embedding Adaptation
```
q' = q + W_q · q
m'_i = m_i + W_m · m_i
```

### Equation 2: Gumbel-Softmax Sampling
```
g_i = -log(-log(u_i)),  u_i ~ Uniform(0,1)
s̃_i = s_i + g_i
p_i = exp(s̃_i/τ) / Σ_j exp(s̃_j/τ)
```

### Equation 3: REINFORCE Update
```
Δφ = η · (R - b) · ∇_φ log P(M_M | q, M_K; φ)
```

---

## Appendix F: Known Limitations & Future Work

### F.1 Streaming Mode Compatibility

**Status**: ✅ **NOT A LIMITATION**

The LangChain Middleware API's `wrapModelCall` hook always receives the **complete `AIMessage` response**, not streaming chunks. Per the librarian investigation:

```typescript
// Handler type signature confirms full response
wrapModelCall: (
  request: ModelRequest,
  handler: WrapModelCallHandler
) => PromiseOrValue<AIMessage>  // Complete message, not stream
```

Streaming tokens are handled through the **callback system** (`handleLLMNewToken` in `BaseCallbackHandler`), which operates independently of middleware hooks. Since RMM citation extraction happens in `wrapModelCall`, it always has access to the full response text including citation markers `[i,j,k]` or `[NO_CITE]`.

**RMM Scope**: Middleware layer only. No callback handler implementation required. No streaming token handling needed.

**No buffering required. No streaming conflict.**

### F.2 GPU/ML Framework Integration

**Issue**: The paper's Python implementation uses PyTorch for efficient matrix operations. TypeScript/JavaScript lacks native GPU acceleration for the 1536×1536 matrix operations.

**Impact**: 
- Pure CPU implementation is ~10-100× slower
- May not meet latency requirements for real-time applications

**Mitigation Strategies**:
1. Use WebGL/TensorFlow.js for GPU acceleration (limited compatibility)
2. Offload reranker training to Python microservice via HTTP
3. Accept higher latency for offline/batch processing scenarios

### F.3 Session Boundary Detection

**Issue**: The paper assumes explicit session boundaries. Automatic detection is not implemented.

**Options**:
1. **Explicit API**: Caller sets `isSessionEnd: true` in runtime context
2. **Timeout-based**: Application-layer inactivity > N minutes
3. **Message-count**: Extract after every N turns

**Recommended**: Explicit context signal for production; timeout as enhancement.

### F.4 Multi-Turn Session Edge Cases

**Leveraging LangGraph's Native Checkpointing**

RMM uses LangGraph's checkpointed `state.messages` rather than duplicating conversation history. This creates specific edge case behaviors:

**Edge Case 1: Thread Interruption and Resume**
```
Turn 3: Thread interrupted (crash, timeout, etc.)
  → Checkpoint contains: messages[0-6], _sessionStartIndex=0, _turnCountInSession=3
  
Resume: Thread loads from checkpoint
  → state.messages restored with full history
  → _sessionStartIndex=0, _turnCountInSession=3 preserved
  → Reranker weights loaded from BaseStore
  
Turn 4: Continue seamlessly
  → No data loss, RL training continues
```

**Edge Case 2: Session Spanning Multiple Invocations**
```
// Session spans 3 agent.invoke() calls
Turn 1-2: agent.invoke() → _turnCountInSession=2
Turn 3-4: agent.invoke() → _turnCountInSession=4  
Turn 5: agent.invoke() with isSessionEnd=true
  → afterAgent extracts from messages.slice(0) → all 5 turns
  → Resets _sessionStartIndex=5, _turnCountInSession=0
```

**Edge Case 3: Checkpoint Without Session End Signal**
```
Turn 10: Checkpoint saved (normal operation)
  → No Prospective Reflection triggered
  → Session continues on resume
  
Risk: If application never sends isSessionEnd, session never extracts memories
Mitigation: Application should timeout sessions or explicitly end them
```

**Edge Case 4: Partial RL Batch at Interruption**
```
Turn 3: Accumulated gradients for batch (1 of 4)
  → Thread interrupted
  → Gradients are transient (in memory only)
  
Resume: Turn 4 begins
  → RL starts fresh gradient accumulation
  → Loss: 3 turns of gradient signal
  
Mitigation: Acceptable loss; RL is online learning, not batch training
```

**Edge Case 5: Concurrent Tool Execution**
```
Model calls tool → tool executes → model calls again (same superstep)
  → beforeModel runs twice in one "turn"
  → _turnCountInSession increments twice
  
Impact: Turn count may not match human perception of "turns"
Mitigation: Document that _turnCountInSession counts model calls, not exchanges
```

**Edge Case 6: JumpTo Control Flow**
```
beforeModel returns { jumpTo: "end" } (e.g., empty memory bank)
  → Skips wrapModelCall and afterModel
  → afterAgent still executes
  
Impact: Session may end without model response
Mitigation: afterAgent checks if any turns occurred before extraction
```

### F.5 Concurrent Session Handling

**Issue**: Same `userId` with multiple concurrent sessions can cause race conditions on:
- Memory bank updates
- Vector store writes  
- Weight storage

**Mitigation**:
- Use per-session locks (Redis distributed locks)
- Queue memory updates per user
- Accept eventual consistency for weight updates

### F.6 Storage Architecture Edge Cases

**Issue**: VectorStore + BaseStore coordination requires validation.

**Edge Case - Embedding Dimension Mismatch:**
Query embeddings (from `embeddings` parameter) must match VectorStore embedding space. Dimension mismatch causes similarity search to fail.

**Validation Required:**
- Constructor validates `embeddings` produces same dimensions as `vectorStore.embeddings`
- Throw configuration error on mismatch during initialization

### F.7 Error Handling & Resilience

**Design Principle: Fail-Safe Degradation**

If RMM encounters any error, it must **completely abort** and allow the agent to continue without memory management. No partial state changes.

**Error Scenarios:**

| Failure Point | Behavior | State Impact |
|---------------|----------|--------------|
| **VectorStore query fails** | Skip retrieval, proceed with empty context | No state changes |
| **Reranker computation fails** | Skip reranking, use raw Top-K | No weight updates |
| **Citation parsing fails** | Treat as malformed → ignore RMM | No RL update |
| **BaseStore unavailable** | Continue with in-memory weights only | No persistence |
| **Memory extraction fails** | Skip Prospective Reflection | No memory updates |
| **Any hook throws** | Abort RMM, return empty state delta | Zero side effects |

**Malformed Citation Handling:**
If LLM response contains invalid citation markers:
- Invalid index references (e.g., `[5]` when only 3 memories sent)
- Malformed syntax (e.g., `[0,`, `[abc]`, missing brackets)
- Missing citation section entirely
- Citation markers in wrong format (e.g., parentheses instead of brackets)

**Parsing Strategy:**
1. Use regex to find citation block: `/\[([\d,\s]+|NO_CITE)\]/`
2. If no match found → treat as malformed
3. If match found but indices invalid → treat as malformed
4. If `[NO_CITE]` → all memories get R = -1

**Action**: Treat as **RMM failure** — abort Retrospective Reflection, no REINFORCE update, no weight changes. Log warning for monitoring.

**Implementation Pattern:**
```typescript
// Each hook wrapped in try-catch
try {
  // RMM logic
} catch (error) {
  // Log error for observability
  console.error(`RMM ${hookName} failed:`, error);
  // Return empty delta — no state changes
  return {};
}
```

**Why This Approach:**
- Paper doesn't specify error handling (assumes perfect execution)
- Production requires graceful degradation
- Partial RMM state = corrupted memory bank
- Full abort maintains consistency

**Edge Case - BaseStore Unavailability:**
If BaseStore is unavailable (network partition, etc.), reranker weights cannot persist.

**Fallback Strategy:**
- Continue with in-memory weights (transient state)
- Log warning about data loss risk
- On recovery, resume with last persisted weights or re-initialize

### F.8 Ephemeral Context Injection Pattern

**Issue**: How to inject retrieved memories without breaking KV cache optimization or bloating checkpoint state.

**Anti-Patterns:**

1. **Modifying System Prompt** (breaks KV cache):
   ```typescript
   // WRONG: Invalidates prefix cache
   systemMessage: request.systemMessage.concat(memories)
   ```

2. **Persisting Context to State** (checkpoint bloat):
   ```typescript
   // WRONG: Context bloats checkpoint forever
   beforeModel: (state) => ({ messages: [...state.messages, contextMessage] })
   ```

**Correct Pattern** (Ephemeral Message in wrapModelCall):

```typescript
wrapModelCall: async (request, handler) => {
  const contextMessage = new HumanMessage({
    content: `<memories>\n${formatMemories(selectedMemories)}\n</memories>`
  });
  
  // Model sees ephemeral message, but it's NOT persisted to state
  return handler({
    ...request,
    messages: [...request.messages, contextMessage]
  });
}
```

**Benefits:**
- ✅ System prompt unchanged (KV cache prefix preserved)
- ✅ User query untouched (intent preserved)
- ✅ Context isolated in ephemeral message
- ✅ NOT persisted to checkpoint (no bloat)
- ✅ Model sees context at inference time
- ✅ Per paper's architecture (context with query)

**Format from Appendix D.2:**
```
<memories>
- Memory [0]: User enjoys hiking
  Original: "I love hiking on weekends"
- Memory [1]: User is vegetarian
  Original: "I don't eat meat"
</memories>

Please consider the above context when answering.
```

## Appendix C: Paper-to-SPEC Traceability Matrix

| Paper Section | SPEC Section | Implementation Notes |
|---------------|--------------|---------------------|
| **Algorithm 1** | 1. Background, 3.3, 3.4 | Full 8-step algorithm mapped to 5 middleware hooks |
| **Section 5: Prospective Reflection** | 3.3.4, 3.3.5, 3.4.5 | Topic-based extraction + Add/Merge logic |
| **Section 6.1: Reranker Design** | 3.3.1, 3.3.2, 3.2.2 | Embedding adaptation + Gumbel sampling |
| **Section 6.2: LLM Attribution** | 3.4.3, 3.2.3 | Single-call response+citation generation |
| **Section 6.3: Reranker Update** | 3.4.4, 3.3.3 | REINFORCE with gradient accumulation |
| **Equation 1** | Appendix E | q' = q + W_q·q implementation spec |
| **Equation 2** | Appendix E | Gumbel trick with τ=0.5 |
| **Equation 3** | Appendix E | REINFORCE: Δφ = η·(R-b)·∇_φ log P |
| **Appendix A.1: Parameters** | 3.2.2, 3.3.3 | All hyperparameters documented (Top-K=20, Top-M=5, η=1e-3, b=0.5) |
| **Appendix D.1.1: Extraction** | 3.3.4, 4.1 | SPEAKER_1 and SPEAKER_2 prompt variants |
| **Appendix D.1.2: Update** | 3.3.5, 4.1 | Add() vs Merge(index, summary) actions |
| **Appendix D.2: Attribution** | 3.4.3, Appendix F.8 | [i,j,k] and [NO_CITE] formats |
| **Table 1: Results** | 1. Background | 70.4% accuracy target cited |

## Appendix D: TypeScript API Reference

### createRMMMiddleware(options)

Creates RMM middleware instance for use with `createAgent`.

**Required Parameters:**
- `vectorStore: VectorStoreInterface` - For similarity search retrieval
- `embeddings: EmbeddingsInterface` - For query encoding (must match vectorStore dimensions)
- `store: BaseStore` - For durable persistence of memories and weights
- `summarizationModel: BaseChatModel` - For memory extraction and merge decisions
- `userId: string` - **Mandatory** namespace isolation identifier

**Optional Parameters:**
- `rerankerConfig?: RerankerConfig` - Override defaults (topK, topM, temperature, learningRate, baseline)
- `enableProspectiveReflection?: boolean` - Enable PR (default: true)
- `enableRetrospectiveReflection?: boolean` - Enable RR (default: true)

**Runtime Context Requirements:**
- `userId: string` - Must match constructor userId
- `isSessionEnd?: boolean` - Signal to trigger Prospective Reflection
- `store?: BaseStore` - Can override constructor store instance

**Returns:** `AgentMiddleware<RMMState, RMMContext>`

### Key Architectural Patterns

See Section 3.2 for storage architecture:
- State (checkpointer): Thread-scoped ephemeral data
- BaseStore: Cross-thread persistent storage with namespace isolation
- VectorStore: Retrieval index synchronized with BaseStore

### Separation of Concerns

**Package Responsibility (RMM Middleware):**
| Concern | Implementation |
|---------|----------------|
| Reranker Math | Equations 1-3 (matrix ops, Gumbel sampling, REINFORCE) |
| Prompt Templates | Appendix D prompts built-in (extraction, merge, attribution) |
| Hook Sequencing | Algorithm 1 mapped to 5 lifecycle hooks |
| Citation Parsing | Extract [i,j,k] / [NO_CITE] from LLM responses |
| RL State Management | W_q, W_m persistence via BaseStore |
| Session Tracking | _sessionStartIndex, _turnCountInSession logic |
| Error Handling | Fail-safe degradation (abort RMM on any error) |

**User/Developer Responsibility:**
| Concern | Requirement |
|---------|-------------|
| VectorStore | Provide `VectorStoreInterface` (Chroma, Pinecone, FAISS, etc.) |
| Embeddings | Provide `EmbeddingsInterface` compatible with VectorStore |
| BaseStore | Provide `BaseStore` for RL weights persistence |
| Summarization LLM | Provide `BaseChatModel` for memory extraction/merge |
| User Identity | Provide `userId` for namespace isolation |
| Session Boundaries | Signal `isSessionEnd: true` when sessions complete |
| Prompt Content | **Note:** RMM uses paper's prompts; user only provides LLM instance |
| Infrastructure | Host VectorStore, BaseStore, manage API keys |

**Critical Distinction:**
The user provides the **infrastructure** (stores, models) but not the **logic**. RMM implements all paper-specific algorithms, prompts, and orchestration. The user just wires it into their LangChain agent.

---

*Document Version: 1.0*
*Last Updated: 2026-02-01*
*Based on: arXiv:2503.08026v2 (ACL 2025)*
