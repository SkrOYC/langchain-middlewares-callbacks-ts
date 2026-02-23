import { describe, expect, test } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import type { Runtime } from "langchain";
import { createEvalProbeMiddleware } from "@/evaluation/eval-probe-middleware";
import type { RmmRuntimeContext } from "@/schemas";

describe("createEvalProbeMiddleware", () => {
  test("captures unique retrieved session IDs", async () => {
    const middleware = createEvalProbeMiddleware();
    const beforeModel = middleware.beforeModel;

    expect(beforeModel).toBeDefined();
    if (!beforeModel) {
      throw new Error("beforeModel hook missing");
    }

    const state = {
      messages: [],
      _retrievedMemories: [
        { sessionId: "session-1" },
        { sessionId: "session-1" },
        { sessionId: "session-2" },
      ],
    };

    const runtime = { context: {} } as Runtime<RmmRuntimeContext>;
    const result =
      typeof beforeModel === "function"
        ? await beforeModel(state, runtime)
        : await beforeModel.hook(state, runtime);

    expect(result?._evalRetrievedSessionIds).toEqual([
      "session-1",
      "session-2",
    ]);
  });

  test("returns empty list when no retrieved memories", async () => {
    const middleware = createEvalProbeMiddleware();
    const beforeModel = middleware.beforeModel;

    expect(beforeModel).toBeDefined();
    if (!beforeModel) {
      throw new Error("beforeModel hook missing");
    }

    const state = {
      messages: [],
      _retrievedMemories: [],
    };

    const runtime = { context: {} } as Runtime<RmmRuntimeContext>;
    const result =
      typeof beforeModel === "function"
        ? await beforeModel(state, runtime)
        : await beforeModel.hook(state, runtime);

    expect(result?._evalRetrievedSessionIds).toEqual([]);
  });

  test("emits verbose trace events for model request/response", async () => {
    const events: Array<{ event?: string }> = [];
    const middleware = createEvalProbeMiddleware({
      method: "rmm",
      questionId: "q1",
      onEvent: (event) => {
        events.push(event);
      },
    });
    const wrapModelCall = middleware.wrapModelCall;
    expect(wrapModelCall).toBeDefined();
    if (!wrapModelCall) {
      throw new Error("wrapModelCall hook missing");
    }

    const request = {
      messages: [new HumanMessage("Where do I live?")],
      state: {},
      runtime: { context: {} },
    };
    const handler = async () => ({
      content: "You live in Lisbon. [0]",
    });

    await wrapModelCall(request as never, handler as never);

    expect(events.some((event) => event.event === "model_request")).toBe(true);
    expect(events.some((event) => event.event === "model_response")).toBe(true);
  });
});
