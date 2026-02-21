import { describe, expect, test } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import type { Runtime } from "langchain";
import { createRetrospectiveAfterModel } from "@/middleware/hooks/after-model";
import type { RmmRuntimeContext } from "@/schemas";
import { createMockBaseStore } from "@/tests/fixtures/mock-base-store";

function createState() {
  return {
    messages: [new HumanMessage("hello")],
    _rerankerWeights: {
      weights: {
        queryTransform: [
          [0.1, 0],
          [0, 0.1],
        ],
        memoryTransform: [
          [0.1, 0],
          [0, 0.1],
        ],
      },
      config: {
        topK: 2,
        topM: 1,
        temperature: 0.5,
        learningRate: 0.001,
        baseline: 0.5,
      },
    },
    _turnCountInSession: 2,
  };
}

describe("afterModel hook", () => {
  test("skips update when there are no citations", async () => {
    const hook = createRetrospectiveAfterModel({ batchSize: 2 });
    const result = await hook(createState(), {
      context: { _citations: [] },
    } as Runtime<RmmRuntimeContext>);

    expect(result._turnCountInSession).toBe(2);
  });

  test("skips update when userId or store are missing", async () => {
    const hook = createRetrospectiveAfterModel({ batchSize: 2 });
    const result = await hook(createState(), {
      context: {
        _citations: [{ memoryId: "m1", cited: true, reward: 1, turnIndex: 0 }],
        _originalQuery: [0.2, 0.3],
        _adaptedQuery: [0.21, 0.31],
        _originalMemoryEmbeddings: [[0.2, 0.3]],
        _adaptedMemoryEmbeddings: [[0.21, 0.31]],
        _samplingProbabilities: [1],
        _selectedIndices: [0],
      },
    } as Runtime<RmmRuntimeContext>);

    expect(result._turnCountInSession).toBe(2);
  });

  test("applies update and returns new state when citations exist", async () => {
    const hook = createRetrospectiveAfterModel({ batchSize: 1 });

    const runtime = {
      context: {
        userId: "u1",
        isSessionEnd: true,
        _citations: [{ memoryId: "m1", cited: true, reward: 1, turnIndex: 0 }],
        _originalQuery: [0.2, 0.3],
        _adaptedQuery: [0.21, 0.31],
        _originalMemoryEmbeddings: [[0.2, 0.3]],
        _adaptedMemoryEmbeddings: [[0.21, 0.31]],
        _samplingProbabilities: [1],
        _selectedIndices: [0],
      },
      store: createMockBaseStore(),
    } as Runtime<RmmRuntimeContext>;

    const result = await hook(createState(), runtime);

    expect(result._rerankerWeights).toBeDefined();
    expect(result._gradientAccumulator).toBeDefined();
    expect(result._citations).toEqual([]);
  });

  test("clears runtime context after successful update", async () => {
    const hook = createRetrospectiveAfterModel({ batchSize: 1 });

    const runtime = {
      context: {
        userId: "u1",
        isSessionEnd: true,
        _citations: [{ memoryId: "m1", cited: true, reward: 1, turnIndex: 0 }],
        _originalQuery: [0.2, 0.3],
        _adaptedQuery: [0.21, 0.31],
        _originalMemoryEmbeddings: [[0.2, 0.3]],
        _adaptedMemoryEmbeddings: [[0.21, 0.31]],
        _samplingProbabilities: [1],
        _selectedIndices: [0],
      },
      store: createMockBaseStore(),
    } as Runtime<RmmRuntimeContext>;

    await hook(createState(), runtime);

    expect(runtime.context._citations).toEqual([]);
    expect(runtime.context._originalQuery).toBeUndefined();
    expect(runtime.context._adaptedQuery).toBeUndefined();
    expect(runtime.context._samplingProbabilities).toBeUndefined();
  });
});
