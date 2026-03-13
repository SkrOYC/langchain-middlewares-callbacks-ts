import { describe, expect, test } from "bun:test";
import { type BaseEvent, EventType } from "@ag-ui/core";
import {
  createSSEResponse,
  SSE_HEADERS,
  serializeEventAsSSE,
} from "../../../src/transports/sse";

describe("SSE transport", () => {
  test("serializes one event per SSE frame", () => {
    const encoded = serializeEventAsSSE({
      type: EventType.RUN_STARTED,
      threadId: "thread-1",
      runId: "run-1",
    } as BaseEvent);
    const decoded = new TextDecoder().decode(encoded);

    expect(decoded).toBe(
      'data: {"type":"RUN_STARTED","threadId":"thread-1","runId":"run-1"}\n\n'
    );
  });

  test("creates responses with SSE headers", () => {
    const response = createSSEResponse(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      })
    );

    expect(response.headers.get("Content-Type")).toBe(
      SSE_HEADERS["Content-Type"]
    );
    expect(response.headers.get("Cache-Control")).toBe(
      SSE_HEADERS["Cache-Control"]
    );
    expect(response.headers.get("Connection")).toBe(SSE_HEADERS.Connection);
  });
});
