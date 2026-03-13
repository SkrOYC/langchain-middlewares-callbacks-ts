import { describe, expect, test } from "bun:test";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { createAgent } from "langchain";
import { createAGUIBackend } from "../../../src/backend";
import { createTextModel } from "../../helpers/test-utils";

class FailingStreamingModel extends BaseChatModel {
  constructor() {
    super({
      temperature: 0,
      callbacks: undefined,
      tags: undefined,
      metadata: undefined,
    });
  }

  protected _generate() {
    return Promise.resolve({
      generations: [
        {
          text: "unreachable",
          message: new AIMessage({
            content: "unreachable",
          }),
          generationInfo: {},
        },
      ],
      llmOutput: {},
    });
  }

  override async *_streamResponseChunks() {
    await Promise.resolve();

    yield {
      message: new AIMessageChunk({
        content: "x",
      }),
      generationInfo: {},
    };

    throw new Error("Model stream failed");
  }

  _llmType(): string {
    return "failing_stream_model";
  }

  _call(): Promise<string> {
    return Promise.reject(new Error("Model stream failed"));
  }
}

function createRunInput(overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [
      {
        id: "msg-user-1",
        role: "user",
        content: "Hello",
      },
    ],
    tools: [],
    context: [],
    forwardedProps: {},
    ...overrides,
  };
}

async function readSSEEvents(response: Response): Promise<BaseEvent[]> {
  const body = response.body;
  if (!body) {
    return [];
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: BaseEvent[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let delimiterIndex = buffer.indexOf("\n\n");
    while (delimiterIndex >= 0) {
      const frame = buffer.slice(0, delimiterIndex);
      buffer = buffer.slice(delimiterIndex + 2);

      if (frame.startsWith("data: ")) {
        events.push(JSON.parse(frame.slice(6)) as BaseEvent);
      }

      delimiterIndex = buffer.indexOf("\n\n");
    }
  }

  return events;
}

async function readSSEFrames(response: Response): Promise<string[]> {
  const body = response.body;
  if (!body) {
    return [];
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let delimiterIndex = buffer.indexOf("\n\n");
    while (delimiterIndex >= 0) {
      frames.push(buffer.slice(0, delimiterIndex));
      buffer = buffer.slice(delimiterIndex + 2);
      delimiterIndex = buffer.indexOf("\n\n");
    }
  }

  return frames;
}

describe("createAGUIBackend", () => {
  test("returns SSE response with canonical lifecycle events", async () => {
    const backend = createAGUIBackend({
      agentFactory: ({ middleware }) =>
        createAgent({
          model: createTextModel(["Hello from backend"]),
          tools: [],
          middleware: [middleware],
        }),
    });

    const response = await backend.handle(
      new Request("https://example.test/agui", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createRunInput()),
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const events = await readSSEEvents(response);
    const types = events.map((event) => event.type);

    expect(types).toContain("RUN_STARTED");
    expect(types).toContain("RUN_FINISHED");
    expect(types.at(0)).toBe("RUN_STARTED");
    expect(types.at(-1)).toBe("RUN_FINISHED");
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "RUN_FINISHED",
        result: expect.any(Object),
      })
    );
  });

  test("rejects non-POST requests", async () => {
    const backend = createAGUIBackend({
      agentFactory: () => {
        throw new Error("should not be called");
      },
    });

    const response = await backend.handle(
      new Request("https://example.test/agui", { method: "GET" })
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  test("rejects non-JSON requests before streaming", async () => {
    const backend = createAGUIBackend({
      agentFactory: () => {
        throw new Error("should not be called");
      },
    });

    const response = await backend.handle(
      new Request("https://example.test/agui", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: "{}",
      })
    );

    expect(response.status).toBe(415);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported Media Type",
    });
  });

  test("rejects invalid request payloads before streaming", async () => {
    const backend = createAGUIBackend({
      agentFactory: () => {
        throw new Error("should not be called");
      },
    });

    const response = await backend.handle(
      new Request("https://example.test/agui", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: [] }),
      })
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  test("emits RUN_ERROR for post-start execution failures", async () => {
    const backend = createAGUIBackend({
      agentFactory: ({ middleware }) =>
        createAgent({
          model: new FailingStreamingModel(),
          tools: [],
          middleware: [middleware],
        }),
    });

    const response = await backend.handle(
      new Request("https://example.test/agui", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createRunInput()),
      })
    );

    const events = await readSSEEvents(response);
    const types = events.map((event) => event.type);

    expect(types).toContain("RUN_STARTED");
    expect(types).toContain("RUN_ERROR");
    expect(types.at(-1)).toBe("RUN_ERROR");
  });

  test("serializes one AG-UI event per SSE frame", async () => {
    const backend = createAGUIBackend({
      agentFactory: ({ middleware }) =>
        createAgent({
          model: createTextModel(["Hello from backend"]),
          tools: [],
          middleware: [middleware],
        }),
    });

    const response = await backend.handle(
      new Request("https://example.test/agui", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createRunInput()),
      })
    );

    const frames = await readSSEFrames(response);
    const events = frames.map((frame) => JSON.parse(frame.slice(6)) as BaseEvent);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((frame) => frame.startsWith("data: "))).toBe(true);
    expect(events).toHaveLength(frames.length);
    expect(events[0]).toEqual(
      expect.objectContaining({ type: "RUN_STARTED" })
    );
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ type: "RUN_FINISHED" })
    );
  });

  test("passes request state into agent execution input", async () => {
    let receivedInput: Record<string, unknown> | undefined;

    const backend = createAGUIBackend({
      agentFactory: () => ({
        stream(input) {
          receivedInput = input;

          return Promise.resolve(
            (async function* () {
              await Promise.resolve();
              yield {
                ok: true,
              };
            })()
          );
        },
      }),
    });

    const response = await backend.handle(
      new Request("https://example.test/agui", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          createRunInput({
            state: {
              sessionMode: "planner",
              count: 3,
            },
          })
        ),
      })
    );

    await readSSEEvents(response);

    expect(receivedInput).toEqual({
      sessionMode: "planner",
      count: 3,
      messages: [
        {
          id: "msg-user-1",
          role: "user",
          content: "Hello",
        },
      ],
    });
  });

  test("propagates abort signal and closes without inventing RUN_ERROR", async () => {
    let receivedSignal: AbortSignal | undefined;

    const backend = createAGUIBackend({
      agentFactory: () => ({
        stream(_input, options) {
          receivedSignal = options?.signal;

          return Promise.resolve(
            (async function* () {
              await new Promise<void>((resolve, reject) => {
                const signal = options?.signal;
                if (!signal) {
                  resolve();
                  return;
                }

                if (signal.aborted) {
                  reject(new DOMException("Aborted", "AbortError"));
                  return;
                }

                const onAbort = () => {
                  signal.removeEventListener("abort", onAbort);
                  reject(new DOMException("Aborted", "AbortError"));
                };

                signal.addEventListener("abort", onAbort, { once: true });
              });
            })()
          );
        },
      }),
    });

    const abortController = new AbortController();
    const response = await backend.handle(
      new Request("https://example.test/agui", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createRunInput()),
        signal: abortController.signal,
      })
    );

    abortController.abort();

    const events = await readSSEEvents(response);

    expect(receivedSignal).toBe(abortController.signal);
    expect(events).toHaveLength(0);
  });
});
