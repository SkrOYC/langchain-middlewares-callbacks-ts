import { test, expect, mock } from "bun:test";
import { createSSETransport } from "../../../src/transports/createSSETransport";

test("SSE transport sets correct headers", async () => {
  const mockReq = {
    on: mock(() => {}),
  };
  const mockRes = {
    setHeader: mock(() => mockRes),
  };

  createSSETransport(mockReq, mockRes);

  expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
  expect(mockRes.setHeader).toHaveBeenCalledWith("Cache-Control", "no-cache");
});

test("SSE transport emits events as SSE data", async () => {
  const mockReq = {
    on: mock(() => {}),
  };
  const mockRes = {
    setHeader: mock(() => mockRes),
    write: mock(() => {}),
  };

  const transport = createSSETransport(mockReq, mockRes);

  const event = {
    type: "TEXT_MESSAGE_START",
    messageId: "msg-123",
    role: "assistant"
  };

  transport.emit(event);
  expect(mockRes.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
});

test("SSE transport creates abort signal on client disconnect", async () => {
  let closeCallback: (() => void) | null = null;

  const mockReq = {
    on: mock((event: string, callback: () => void) => {
      if (event === "close") {
        closeCallback = callback;
      }
    }),
  };
  const mockRes = {
    setHeader: mock(() => mockRes),
    write: mock(() => {}),
  };

  const transport = createSSETransport(mockReq, mockRes);

  expect(transport.signal).toBeDefined();
  expect(transport.signal.aborted).toBe(false);

  // Simulate client disconnect
  if (closeCallback) {
    closeCallback();
  }

  expect(transport.signal.aborted).toBe(true);
});

test("SSE transport handles backpressure with queue", async () => {
  const mockReq = {
    on: mock(() => {}),
  };
  const mockRes = {
    setHeader: mock(() => mockRes),
    write: mock(() => true),
    writable: true,
  };

  const transport = createSSETransport(mockReq, mockRes);

  // Emit multiple events rapidly
  for (let i = 0; i < 10; i++) {
    transport.emit({ type: "EVENT", data: i });
  }

  expect(mockRes.write).toHaveBeenCalledTimes(10);
});

test("SSE transport disconnect method closes response", async () => {
  const mockReq = {
    on: mock(() => {}),
  };
  const mockRes = {
    setHeader: mock(() => mockRes),
    write: mock(() => {}),
    end: mock(() => {}),
  };

  const transport = createSSETransport(mockReq, mockRes);

  transport.disconnect?.();
  expect(mockRes.end).toHaveBeenCalled();
});
