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

test("SSE transport isConnected reflects connection state", async () => {
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
    write: mock(() => true),
  };

  const transport = createSSETransport(mockReq, mockRes);

  // Initially connected
  expect(transport.isConnected()).toBe(true);

  // Simulate client disconnect
  closeCallback?.();

  // Should be disconnected
  expect(transport.isConnected()).toBe(false);
});

test("SSE transport disconnect is undefined when res.end not provided", async () => {
  const mockReq = {
    on: mock(() => {}),
  };
  const mockRes = {
    setHeader: mock(() => mockRes),
    write: mock(() => true), // No .end method
  };

  const transport = createSSETransport(mockReq, mockRes);

  // disconnect should be undefined when res.end is not available
  expect(transport.disconnect).toBeUndefined();
});

test("SSE transport handles write errors in drain gracefully", async () => {
  const mockReq = {
    on: mock(() => {}),
  };
  const mockRes = {
    setHeader: mock(() => mockRes),
    write: mock(() => {
      throw new Error("Client disconnected");
    }),
  };

  const transport = createSSETransport(mockReq, mockRes);

  // Should not throw despite write error in drain()
  expect(() => {
    transport.emit({ type: "RUN_STARTED", threadId: "test", runId: "run-1" });
  }).not.toThrow();

  // Write was attempted but error caught
  expect(mockRes.write).toHaveBeenCalled();
});
