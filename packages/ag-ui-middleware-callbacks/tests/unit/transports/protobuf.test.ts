import { test, expect, describe } from "bun:test";
import {
  encodeEventWithFraming,
  decodeEventWithFraming,
  AGUI_MEDIA_TYPE,
} from "../../../src/transports/createProtobufTransport";
import type { AGUIEvent } from "../../../src/events";
import { EventType } from "../../../src/events";

describe("Protobuf Transport", () => {
  describe("AGUI_MEDIA_TYPE", () => {
    test("exports correct media type constant", () => {
      expect(AGUI_MEDIA_TYPE).toBe("application/vnd.ag-ui.event+proto");
    });
  });

  describe("encodeEventWithFraming", () => {
    test("encodes RUN_STARTED event", () => {
      const event: AGUIEvent = {
        type: EventType.RUN_STARTED,
        threadId: "thread-123",
        runId: "run-456",
        timestamp: Date.now(),
      };
      
      const encoded = encodeEventWithFraming(event);
      
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(4); // At least length prefix
    });

    test("encodes TEXT_MESSAGE_CONTENT event", () => {
      const event: AGUIEvent = {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "msg-1",
        delta: "Hello world!",
        timestamp: Date.now(),
      };
      
      const encoded = encodeEventWithFraming(event);
      
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(4);
    });

    test("encodes TOOL_CALL_START event", () => {
      const event: AGUIEvent = {
        type: EventType.TOOL_CALL_START,
        toolCallId: "tool-1",
        toolCallName: "calculator",
        timestamp: Date.now(),
      };
      
      const encoded = encodeEventWithFraming(event);
      
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(4);
    });

    test("includes 4-byte Big-Endian length prefix", () => {
      const event: AGUIEvent = {
        type: EventType.RUN_STARTED,
        threadId: "thread-123",
        runId: "run-456",
      };
      
      const encoded = encodeEventWithFraming(event);
      
      // Extract length from first 4 bytes (Big-Endian)
      const lengthPrefix = new DataView(encoded.buffer, encoded.byteOffset).getUint32(0, false);
      
      // Length should match payload size
      expect(lengthPrefix).toBe(encoded.length - 4);
    });
  });

  describe("decodeEventWithFraming", () => {
    test("decodes RUN_STARTED event round-trip", () => {
      const original: AGUIEvent = {
        type: EventType.RUN_STARTED,
        threadId: "thread-123",
        runId: "run-456",
      };
      
      const encoded = encodeEventWithFraming(original);
      const decoded = decodeEventWithFraming(encoded);
      
      expect(decoded.type).toBe(EventType.RUN_STARTED);
      expect((decoded as any).threadId).toBe("thread-123");
      expect((decoded as any).runId).toBe("run-456");
    });

    test("decodes TEXT_MESSAGE_CONTENT event round-trip", () => {
      const original: AGUIEvent = {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "msg-1",
        delta: "Hello world!",
      };
      
      const encoded = encodeEventWithFraming(original);
      const decoded = decodeEventWithFraming(encoded);
      
      expect(decoded.type).toBe(EventType.TEXT_MESSAGE_CONTENT);
      expect((decoded as any).messageId).toBe("msg-1");
      expect((decoded as any).delta).toBe("Hello world!");
    });

    // Note: TOOL_CALL_RESULT is not currently supported by @ag-ui/proto
    // See: https://github.com/ag-ui-protocol/ag-ui/issues
    test.skip("decodes TOOL_CALL_RESULT event round-trip (not supported by @ag-ui/proto)", () => {
      const original: AGUIEvent = {
        type: EventType.TOOL_CALL_RESULT,
        messageId: "msg-1",
        toolCallId: "tool-1",
        content: '{"result": 42}',
        role: "tool",
      };
      
      const encoded = encodeEventWithFraming(original);
      const decoded = decodeEventWithFraming(encoded);
      
      expect(decoded.type).toBe(EventType.TOOL_CALL_RESULT);
      expect((decoded as any).toolCallId).toBe("tool-1");
      expect((decoded as any).content).toBe('{"result": 42}');
    });

    test("throws on insufficient data for length prefix", () => {
      const shortData = new Uint8Array([0, 0, 0]); // Only 3 bytes
      
      expect(() => decodeEventWithFraming(shortData)).toThrow(
        "Invalid protobuf frame: insufficient data for length prefix"
      );
    });

    test("throws on insufficient data for payload", () => {
      // Length prefix says 100 bytes, but only 4+10 bytes provided
      const data = new Uint8Array(14);
      const view = new DataView(data.buffer);
      view.setUint32(0, 100, false); // Big-Endian length = 100
      
      expect(() => decodeEventWithFraming(data)).toThrow(
        "Invalid protobuf frame: insufficient data for payload"
      );
    });
  });

  describe("Complex Events", () => {
    test("encodes and decodes STATE_SNAPSHOT event", () => {
      const original: AGUIEvent = {
        type: EventType.STATE_SNAPSHOT,
        snapshot: {
          counter: 42,
          messages: [],
          settings: { theme: "dark" },
        },
      };
      
      const encoded = encodeEventWithFraming(original);
      const decoded = decodeEventWithFraming(encoded);
      
      expect(decoded.type).toBe(EventType.STATE_SNAPSHOT);
      expect((decoded as any).snapshot).toBeDefined();
    });

    // Note: ACTIVITY_SNAPSHOT is not currently supported by @ag-ui/proto
    // See: https://github.com/ag-ui-protocol/ag-ui/issues
    test.skip("encodes and decodes ACTIVITY_SNAPSHOT event (not supported by @ag-ui/proto)", () => {
      const original: AGUIEvent = {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: "activity-1",
        activityType: "AGENT_STEP",
        content: {
          status: "processing",
          stepName: "model_call",
        },
        replace: true,
      };
      
      const encoded = encodeEventWithFraming(original);
      const decoded = decodeEventWithFraming(encoded);
      
      expect(decoded.type).toBe(EventType.ACTIVITY_SNAPSHOT);
      expect((decoded as any).activityType).toBe("AGENT_STEP");
    });

    test("encodes and decodes CUSTOM event", () => {
      const original: AGUIEvent = {
        type: EventType.CUSTOM,
        name: "user_feedback",
        value: { rating: 5, comment: "Great!" },
      };
      
      const encoded = encodeEventWithFraming(original);
      const decoded = decodeEventWithFraming(encoded);
      
      expect(decoded.type).toBe(EventType.CUSTOM);
      expect((decoded as any).name).toBe("user_feedback");
    });
  });
});
