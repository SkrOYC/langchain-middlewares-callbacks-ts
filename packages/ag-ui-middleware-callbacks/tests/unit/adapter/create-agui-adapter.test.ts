import { describe, expect, test } from "bun:test";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { createAgent } from "langchain";
import { createAGUIAdapter } from "../../../src/adapter";
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

async function collectEvents(
  stream: AsyncIterable<BaseEvent>
): Promise<BaseEvent[]> {
  const events: BaseEvent[] = [];

  for await (const event of stream) {
    events.push(event);
  }

  return events;
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

describe("createAGUIAdapter", () => {
  test("returns canonical lifecycle events without HTTP concerns", async () => {
    const adapter = createAGUIAdapter({
      agentFactory: ({ middleware }) =>
        createAgent({
          model: createTextModel(["Hello from adapter"]),
          tools: [],
          middleware: [middleware],
        }),
    });

    const stream = await adapter.stream(createRunInput());
    const events = await collectEvents(stream);
    const types = events.map((event) => event.type);

    expect(types).toContain("RUN_STARTED");
    expect(types).toContain("RUN_FINISHED");
    expect(types.at(0)).toBe("RUN_STARTED");
    expect(types.at(-1)).toBe("RUN_FINISHED");
  });

  test("passes run state into the agent input", async () => {
    let receivedInput: Record<string, unknown> | undefined;

    const adapter = createAGUIAdapter({
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

    const stream = await adapter.stream(
      createRunInput({
        state: {
          sessionMode: "planner",
          count: 3,
        },
      })
    );

    await collectEvents(stream);

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

  test("emits RUN_ERROR for post-start execution failures", async () => {
    const adapter = createAGUIAdapter({
      agentFactory: ({ middleware }) =>
        createAgent({
          model: new FailingStreamingModel(),
          tools: [],
          middleware: [middleware],
        }),
    });

    const stream = await adapter.stream(createRunInput());
    const events = await collectEvents(stream);
    const types = events.map((event) => event.type);

    expect(types).toContain("RUN_STARTED");
    expect(types).toContain("RUN_ERROR");
    expect(types.at(-1)).toBe("RUN_ERROR");
  });

  test("propagates aborts and closes without inventing RUN_ERROR", async () => {
    let receivedSignal: AbortSignal | undefined;

    const adapter = createAGUIAdapter({
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
    const stream = await adapter.stream(createRunInput(), {
      signal: abortController.signal,
    });

    abortController.abort();

    const events = await collectEvents(stream);

    expect(receivedSignal).toBe(abortController.signal);
    expect(events).toHaveLength(0);
  });

  test("matches backend canonical event types for equivalent runs", async () => {
    const config = {
      agentFactory: ({ middleware }: { middleware: any }) =>
        createAgent({
          model: createTextModel(["Parity check"]),
          tools: [],
          middleware: [middleware],
        }),
    };

    const adapter = createAGUIAdapter(config);
    const backend = createAGUIBackend(config);
    const input = createRunInput();

    const adapterEvents = await collectEvents(await adapter.stream(input));
    const backendEvents = await readSSEEvents(
      await backend.handle(
        new Request("https://example.test/agui", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
        })
      )
    );

    expect(adapterEvents.map((event) => event.type)).toEqual(
      backendEvents.map((event) => event.type)
    );
  });
});
