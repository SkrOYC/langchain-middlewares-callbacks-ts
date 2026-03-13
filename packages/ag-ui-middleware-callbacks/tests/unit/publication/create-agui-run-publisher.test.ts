import { describe, expect, mock, test } from "bun:test";
import { type BaseEvent, EventType } from "@ag-ui/core";
import { createAGUIRunPublisher } from "../../../src/publication";

function collectEvents() {
  const events: BaseEvent[] = [];
  const publisher = createAGUIRunPublisher();
  publisher.subscribe((event) => {
    events.push(event);
  });

  return { events, publisher };
}

describe("createAGUIRunPublisher", () => {
  test("toReadableStream serializes events as SSE frames", async () => {
    const publisher = createAGUIRunPublisher();
    const stream = publisher.toReadableStream();
    const reader = stream.getReader();
    const encoder = new TextDecoder();

    publisher.publish({
      type: EventType.RUN_STARTED,
      threadId: "thread-1",
      runId: "run-1",
    } as BaseEvent);
    publisher.complete({ ok: true });

    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      chunks.push(encoder.decode(value));
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('"type":"RUN_STARTED"');
    expect(chunks[0].startsWith("data: ")).toBe(true);
    expect(chunks[1]).toContain('"type":"RUN_FINISHED"');
  });

  test("buffers observation events until RUN_STARTED arrives", () => {
    const { events, publisher } = collectEvents();

    publisher.publish({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-1",
      role: "assistant",
    } as BaseEvent);
    publisher.publish({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg-1",
      delta: "hello",
    } as BaseEvent);
    publisher.publish({
      type: EventType.RUN_STARTED,
      threadId: "thread-1",
      runId: "run-1",
    } as BaseEvent);

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
    ]);
  });

  test("finalizes open streams before RUN_FINISHED and ignores post-terminal events", () => {
    const { events, publisher } = collectEvents();

    publisher.publish({
      type: EventType.RUN_STARTED,
      threadId: "thread-1",
      runId: "run-1",
    } as BaseEvent);
    publisher.publish({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-1",
      role: "assistant",
    } as BaseEvent);
    publisher.publish({
      type: EventType.TOOL_CALL_START,
      toolCallId: "tool-1",
      toolCallName: "lookup",
      parentMessageId: "msg-1",
    } as BaseEvent);

    publisher.complete({ ok: true });
    publisher.complete({ ignored: true });
    publisher.publish({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg-1",
      delta: "ignored",
    } as BaseEvent);

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TOOL_CALL_START,
      EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_END,
      EventType.RUN_FINISHED,
    ]);

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: EventType.RUN_FINISHED,
        runId: "run-1",
        threadId: "thread-1",
        result: { ok: true },
      })
    );
  });

  test("allows final-only tool results without inventing tool lifecycle events", () => {
    const { events, publisher } = collectEvents();

    publisher.publish({
      type: EventType.RUN_STARTED,
      threadId: "thread-1",
      runId: "run-1",
    } as BaseEvent);
    publisher.publish({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: "tool-1",
      delta: '{"city":"scl"}',
    } as BaseEvent);
    publisher.publish({
      type: EventType.TOOL_CALL_RESULT,
      messageId: "tool-msg-1",
      toolCallId: "tool-1",
      content: '{"temp":72}',
      role: "tool",
    } as BaseEvent);
    publisher.publish({
      type: EventType.RUN_FINISHED,
      threadId: "thread-1",
      runId: "run-1",
    } as BaseEvent);

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_RESULT,
      EventType.RUN_FINISHED,
    ]);
  });

  test("validates events in strict mode", () => {
    const publisher = createAGUIRunPublisher({ validateEvents: "strict" });

    expect(() =>
      publisher.publish({
        type: EventType.RUN_STARTED,
        runId: "run-1",
      } as BaseEvent)
    ).toThrow("Invalid AG-UI event");
  });

  test("warn mode logs invalid events but still emits them", () => {
    const events: BaseEvent[] = [];
    const publisher = createAGUIRunPublisher({ validateEvents: true });
    const warn = mock(() => undefined);
    const originalWarn = console.warn;
    console.warn = warn;

    publisher.subscribe((event) => {
      events.push(event);
    });

    try {
      publisher.publish({
        type: EventType.RUN_STARTED,
        runId: "run-1",
      } as BaseEvent);
    } finally {
      console.warn = originalWarn;
    }

    expect(warn).toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: EventType.RUN_STARTED,
        runId: "run-1",
      })
    );
  });

  test("isolates terminal state across concurrent publishers", () => {
    const runA = collectEvents();
    const runB = collectEvents();

    runA.publisher.publish({
      type: EventType.RUN_STARTED,
      threadId: "thread-a",
      runId: "run-a",
    } as BaseEvent);
    runB.publisher.publish({
      type: EventType.RUN_STARTED,
      threadId: "thread-b",
      runId: "run-b",
    } as BaseEvent);

    runA.publisher.publish({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-a",
      role: "assistant",
    } as BaseEvent);
    runB.publisher.publish({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-b",
      role: "assistant",
    } as BaseEvent);

    runA.publisher.complete();

    runB.publisher.publish({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg-b",
      delta: "still-open",
    } as BaseEvent);
    runB.publisher.complete();

    expect(runA.events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);

    expect(runB.events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
  });

  test("close terminates transport without inventing terminal events", async () => {
    const publisher = createAGUIRunPublisher();
    const stream = publisher.toReadableStream();
    const reader = stream.getReader();

    publisher.close();

    const result = await reader.read();
    expect(result.done).toBe(true);
  });
});
