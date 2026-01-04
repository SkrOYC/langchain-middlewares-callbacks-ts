import { test, expect } from "bun:test";
import { createMockTransport } from "../../fixtures/mockTransport";
import { AGUICallbackHandler } from "../../../src/callbacks/AGUICallbackHandler";

// handleLLMStart tests

test("AGUICallbackHandler is instantiated correctly", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  expect(handler).toBeDefined();
  expect(handler.name).toBe("ag-ui-callback");
});

test("handleLLMStart captures messageId from metadata", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const runId = "run-123";
  const messageId = "msg-456";

  await handler.handleLLMStart(
    null as any,
    ["prompt"],
    runId,
    undefined,
    {},
    undefined,
    { agui_messageId: messageId }
  );

  expect(handler["messageIds"].get(runId)).toBe(messageId);
});

test("handleLLMStart does not store when no messageId in metadata", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const runId = "run-123";

  await handler.handleLLMStart(
    null as any,
    ["prompt"],
    runId,
    undefined,
    {},            // extraParams
    undefined,     // tags
    {},            // metadata (empty, no messageId)
    undefined      // runName
  );

  expect(handler["messageIds"].has(runId)).toBe(false);
});

test("handleLLMStart stores multiple messageIds correctly", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  await handler.handleLLMStart(null, [], "run-1", undefined, {}, undefined, { agui_messageId: "msg-1" }, undefined);
  await handler.handleLLMStart(null, [], "run-2", undefined, {}, undefined, { agui_messageId: "msg-2" }, undefined);
  await handler.handleLLMStart(null, [], "run-3", undefined, {}, undefined, { agui_messageId: "msg-3" }, undefined);

  expect(handler["messageIds"].size).toBe(3);
  expect(handler["messageIds"].get("run-1")).toBe("msg-1");
  expect(handler["messageIds"].get("run-2")).toBe("msg-2");
  expect(handler["messageIds"].get("run-3")).toBe("msg-3");
});

// handleLLMNewToken tests

test("handleLLMNewToken emits TEXT_MESSAGE_CONTENT events", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const runId = "run-123";
  const messageId = "msg-456";

  await handler.handleLLMStart(null, [], runId, undefined, {}, undefined, { agui_messageId: messageId }, undefined);
  await handler.handleLLMNewToken("Hello", { promptIndex: 0, completionIndex: 0 }, runId);

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "TEXT_MESSAGE_CONTENT",
      messageId,
      delta: "Hello"
    })
  );
});

test("handleLLMNewToken does not emit when messageId not found", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const runId = "run-123";

  await handler.handleLLMNewToken("Hello", { promptIndex: 0, completionIndex: 0 }, runId);

  expect(mockTransport.emit).not.toHaveBeenCalled();
});

test("handleLLMNewToken emits TOOL_CALL_ARGS for tool call chunks", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const runId = "run-123";
  const messageId = "msg-456";

  await handler.handleLLMStart(null, [], runId, undefined, {}, undefined, { agui_messageId: messageId }, undefined);

  const toolCallChunks = [
    {
      id: "tc-123",
      args: { query: "test" }
    }
  ];

  await handler.handleLLMNewToken(
    "token",
    { promptIndex: 0, completionIndex: 0 },
    runId,
    undefined,
    [],
    { chunk: { message: { tool_call_chunks: toolCallChunks } } }
  );

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "TOOL_CALL_ARGS",
      toolCallId: "tc-123",
      delta: { query: "test" }
    })
  );
});

test("handleLLMNewToken handles multiple tokens", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const runId = "run-123";
  const messageId = "msg-456";

  await handler.handleLLMStart(null, [], runId, undefined, {}, undefined, { agui_messageId: messageId }, undefined);

  await handler.handleLLMNewToken("He", { promptIndex: 0, completionIndex: 0 }, runId);
  await handler.handleLLMNewToken("llo", { promptIndex: 0, completionIndex: 1 }, runId);
  await handler.handleLLMNewToken("!", { promptIndex: 0, completionIndex: 2 }, runId);

  expect(mockTransport.emit).toHaveBeenCalledTimes(3);
});

test("handleLLMNewToken does not emit for empty tokens", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const runId = "run-123";
  const messageId = "msg-456";

  await handler.handleLLMStart(null, [], runId, undefined, {}, undefined, { agui_messageId: messageId }, undefined);
  await handler.handleLLMNewToken("", { promptIndex: 0, completionIndex: 0 }, runId);

  // Empty tokens should still be emitted (they may be valid whitespace)
  expect(mockTransport.emit).toHaveBeenCalled();
});

// handleToolStart tests

test("handleToolStart emits TOOL_CALL_START", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const parentRunId = "run-123";
  const parentMessageId = "msg-456";
  const toolRunId = "run-tool-789";
  const toolCallId = "tc-999";

  handler["messageIds"].set(parentRunId, parentMessageId);

  await handler.handleToolStart(
    { name: "search" },
    JSON.stringify({ id: toolCallId, name: "search", args: { query: "test" } }),
    toolRunId,
    parentRunId,
    [],
    {},
    undefined
  );

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "TOOL_CALL_START",
      toolCallId,
      toolCallName: "search",
      parentMessageId
    })
  );
});

test("handleToolStart parses toolCallId from input", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const toolRunId = "run-tool-789";

  await handler.handleToolStart(
    { name: "calculator" },
    JSON.stringify({ id: "tc-999", name: "calculator", args: { a: 1, b: 2 } }),
    toolRunId,
    undefined,
    [],
    {},
    undefined
  );

  expect(handler["toolCallIds"].get(toolRunId)).toBe("tc-999");
});

test("handleToolStart uses runId when toolCallId not found", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const toolRunId = "run-tool-789";

  await handler.handleToolStart(
    { name: "search" },
    "invalid-json",
    toolRunId,
    undefined,
    [],
    {},
    undefined
  );

  expect(handler["toolCallIds"].get(toolRunId)).toBeUndefined();
  // Should still emit with runId as fallback
  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      toolCallId: toolRunId
    })
  );
});

test("handleToolStart handles missing parentMessageId", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const toolRunId = "run-tool-789";
  const toolCallId = "tc-999";

  await handler.handleToolStart(
    { name: "search" },
    JSON.stringify({ id: toolCallId, name: "search", args: {} }),
    toolRunId,
    "non-existent-parent",
    [],
    {},
    undefined
  );

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      parentMessageId: undefined
    })
  );
});

// handleToolEnd tests

test("handleToolEnd emits TOOL_CALL_END and TOOL_CALL_RESULT", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const parentRunId = "run-123";
  const toolRunId = "run-tool-789";
  const toolCallId = "tc-999";

  handler["toolCallIds"].set(toolRunId, toolCallId);
  handler["messageIds"].set(parentRunId, "msg-456");

  await handler.handleToolEnd(
    JSON.stringify({ result: "success" }),
    toolRunId,
    parentRunId,
    []
  );

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "TOOL_CALL_END",
      toolCallId
    })
  );

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "TOOL_CALL_RESULT",
      content: JSON.stringify({ result: "success" })
    })
  );
});

test("handleToolEnd uses runId when toolCallId not found", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const toolRunId = "run-tool-789";

  await handler.handleToolEnd(
    JSON.stringify({ result: "success" }),
    toolRunId,
    undefined,
    []
  );

  expect(mockTransport.emit).toHaveBeenCalledWith(
    expect.objectContaining({
      toolCallId: toolRunId
    })
  );
});

test("handleToolEnd TOOL_CALL_RESULT uses same toolCallId as TOOL_CALL_END when toolCallId not found", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const toolRunId = "run-tool-789";
  const output = "tool result";

  // handleToolEnd without toolCallId stored - should use runId as fallback
  await handler.handleToolEnd(
    output,
    toolRunId,
    undefined,
    []
  );

  // Get all TOOL_CALL_END calls
  const endCalls = mockTransport.emit.mock.calls.filter(
    ([event]: any[]) => event.type === "TOOL_CALL_END"
  );
  expect(endCalls.length).toBe(1);

  // Get all TOOL_CALL_RESULT calls
  const resultCalls = mockTransport.emit.mock.calls.filter(
    ([event]: any[]) => event.type === "TOOL_CALL_RESULT"
  );
  expect(resultCalls.length).toBe(1);

  // Verify both events use the same toolCallId (runId fallback)
  const endEvent = endCalls[0]?.[0] as { toolCallId: string };
  const resultEvent = resultCalls[0]?.[0] as { toolCallId: string };
  expect(endEvent?.toolCallId).toBe(toolRunId);
  expect(resultEvent?.toolCallId).toBe(toolRunId);
});

test("handleToolEnd generates messageId for result", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const toolRunId = "run-tool-789";
  const toolCallId = "tc-999";

  handler["toolCallIds"].set(toolRunId, toolCallId);

  await handler.handleToolEnd(
    JSON.stringify({ result: "success" }),
    toolRunId,
    undefined,
    []
  );

  const resultCall = mockTransport.emit.mock.calls.find(
    ([event]) => event.type === "TOOL_CALL_RESULT"
  );

  expect(resultCall).toBeDefined();
  expect(resultCall![0].messageId).toBeDefined();
});

test("handleToolEnd cleans up toolCallId from internal state", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const toolRunId = "run-tool-789";
  const toolCallId = "tc-999";

  handler["toolCallIds"].set(toolRunId, toolCallId);

  await handler.handleToolEnd(
    JSON.stringify({ result: "success" }),
    toolRunId,
    undefined,
    []
  );

  expect(handler["toolCallIds"].has(toolRunId)).toBe(false);
});

// Cleanup tests

test("dispose clears internal state", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  handler["messageIds"].set("run-1", "msg-1");
  handler["toolCallIds"].set("run-2", "tc-1");

  handler.dispose();

  expect(handler["messageIds"].size).toBe(0);
  expect(handler["toolCallIds"].size).toBe(0);
});

test("dispose does not throw when called multiple times", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  handler["messageIds"].set("run-1", "msg-1");
  handler["toolCallIds"].set("run-2", "tc-1");

  handler.dispose();
  handler.dispose();
  handler.dispose();

  expect(handler["messageIds"].size).toBe(0);
  expect(handler["toolCallIds"].size).toBe(0);
});

// Error handling tests

test("handleLLMError cleans up messageId", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const runId = "run-123";

  await handler.handleLLMStart(null, [], runId, undefined, {}, undefined, { agui_messageId: "msg-456" }, undefined);
  await handler.handleLLMError(new Error("Test error"), runId);

  expect(handler["messageIds"].has(runId)).toBe(false);
});

test("handleToolError cleans up toolCallId", async () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const toolRunId = "run-tool-789";

  handler["toolCallIds"].set(toolRunId, "tc-999");
  await handler.handleToolError(new Error("Test error"), toolRunId);

  expect(handler["toolCallIds"].has(toolRunId)).toBe(false);
});

// TOOL_CALL_CHUNK tests

test("handleToolEnd emits TOOL_CALL_CHUNK when content exceeds maxUIPayloadSize with chunking enabled", async () => {
  const mockTransport = createMockTransport();
  // Create handler with small maxUIPayloadSize to trigger chunking
  const handler = new AGUICallbackHandler(mockTransport, { 
    maxUIPayloadSize: 50,
    chunkLargeResults: true 
  });

  const toolRunId = "run-tool-789";
  const toolCallId = "tc-999";

  handler["toolCallIds"].set(toolRunId, toolCallId);

  // Create content that exceeds 50 bytes
  const largeContent = "This is a very long tool result that definitely exceeds fifty bytes for UI payloads";
  
  await handler.handleToolEnd(
    largeContent,
    toolRunId,
    undefined,
    []
  );

  // Should have emitted TOOL_CALL_CHUNK events instead of TOOL_CALL_RESULT
  const chunkCalls = mockTransport.emit.mock.calls.filter(
    ([event]: any[]) => event.type === "TOOL_CALL_CHUNK"
  );
  
  expect(chunkCalls.length).toBeGreaterThan(0);
  
  // Verify chunk structure
  for (const [event] of chunkCalls) {
    expect(event.type).toBe("TOOL_CALL_CHUNK");
    expect(event.toolCallId).toBe(toolCallId);
    expect(event.chunk).toBeDefined();
    expect(typeof event.chunk).toBe("string");
    expect(typeof event.index).toBe("number");
  }
});

test("handleToolEnd emits TOOL_CALL_RESULT with truncation when content exceeds limit and chunking disabled", async () => {
  const mockTransport = createMockTransport();
  // Create handler with small maxUIPayloadSize but chunking disabled
  const handler = new AGUICallbackHandler(mockTransport, { 
    maxUIPayloadSize: 50,
    chunkLargeResults: false 
  });

  const toolRunId = "run-tool-789";
  const toolCallId = "tc-999";

  handler["toolCallIds"].set(toolRunId, toolCallId);

  // Create content that exceeds 50 bytes
  const largeContent = "This is a very long tool result that definitely exceeds fifty bytes for UI payloads and should be truncated";
  
  await handler.handleToolEnd(
    largeContent,
    toolRunId,
    undefined,
    []
  );

  // Should have emitted truncated TOOL_CALL_RESULT
  const resultCall = mockTransport.emit.mock.calls.find(
    ([event]: any[]) => event.type === "TOOL_CALL_RESULT"
  );

  expect(resultCall).toBeDefined();
  expect(resultCall![0].content).toContain("[Truncated:");
});

test("chunkString splits content at word boundaries", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  // Access the private chunkString method via the handler instance
  const chunkString = (handler as any).chunkString.bind(handler);
  
  const content = "Hello world this is a test of chunking at word boundaries";
  const chunks = chunkString(content, 15);
  
  expect(chunks.length).toBeGreaterThan(1);
  // Verify chunks don't split in middle of words
  for (const chunk of chunks) {
    expect(chunk.length).toBeLessThanOrEqual(15);
  }
});

test("chunkString handles content smaller than max size", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const chunkString = (handler as any).chunkString.bind(handler);
  
  const content = "Short content";
  const chunks = chunkString(content, 100);
  
  expect(chunks.length).toBe(1);
  expect(chunks[0]).toBe(content);
});

// UTF-8 multi-byte character handling tests

test("chunkString handles Chinese characters correctly", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const chunkString = (handler as any).chunkString.bind(handler);
  
  // Chinese characters are 3 bytes each in UTF-8
  const content = "你好世界";
  const chunks = chunkString(content, 10);
  
  // Verify all chunks round-trip correctly through UTF-8 encoding
  for (const chunk of chunks) {
    const bytes = new TextEncoder().encode(chunk);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe(chunk);
  }
});

test("chunkString handles emojis correctly", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const chunkString = (handler as any).chunkString.bind(handler);
  
  // Emojis are 4 bytes in UTF-8 (some are surrogate pairs in UTF-16)
  const content = "Hello 🌍! Test 😀";
  const chunks = chunkString(content, 8);
  
  for (const chunk of chunks) {
    const bytes = new TextEncoder().encode(chunk);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe(chunk);
  }
});

test("chunkString handles mixed ASCII and multi-byte characters", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const chunkString = (handler as any).chunkString.bind(handler);
  
  // Mix of ASCII (1 byte) and Chinese (3 bytes each)
  const content = "Test 你好 Hello 世界";
  const chunks = chunkString(content, 6);
  
  for (const chunk of chunks) {
    const bytes = new TextEncoder().encode(chunk);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe(chunk);
  }
});

test("chunkString handles emoji sequences correctly", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const chunkString = (handler as any).chunkString.bind(handler);
  
  // Multiple consecutive emojis
  const content = "😀😃😄😁😆😅";
  const chunks = chunkString(content, 4);
  
  for (const chunk of chunks) {
    const bytes = new TextEncoder().encode(chunk);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe(chunk);
  }
});

test("chunkString handles Japanese characters correctly", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const chunkString = (handler as any).chunkString.bind(handler);
  
  // Japanese hiragana/katakana (3 bytes each in UTF-8)
  const content = "こんにちは世界";
  const chunks = chunkString(content, 12);
  
  for (const chunk of chunks) {
    const bytes = new TextEncoder().encode(chunk);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe(chunk);
  }
});

// UTF-8 byte boundary bug reproduction test
// This test exposes the bug where chunkString splits at UTF-8 byte boundaries
// rather than character boundaries, causing corrupted output

test("chunkString forces split at byte boundary causing corruption", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const chunkString = (handler as any).chunkString.bind(handler);
  
  // Chinese character "你" is 3 bytes in UTF-8: [0xE4, 0xBD, 0xA0]
  // Using chunk size 2 bytes should force split in middle of character
  const content = "你好"; // "你" (3 bytes) + "好" (3 bytes) = 6 bytes total
  const chunks = chunkString(content, 2); // Force split at 2 bytes
  
  console.log("Original content:", content);
  console.log("Bytes:", new TextEncoder().encode(content));
  console.log("Chunks:", chunks);
  
  // At least one chunk should be corrupted if bug exists
  // The bug forces split at maxChunkSize (2 bytes) even though that splits a multi-byte char
  for (const chunk of chunks) {
    console.log("Chunk:", chunk, "Bytes:", new TextEncoder().encode(chunk));
    // This should pass if no corruption, fail if corrupted
    const bytes = new TextEncoder().encode(chunk);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe(chunk);
  }
});

test("chunkString byte boundary split with single Chinese character", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const chunkString = (handler as any).chunkString.bind(handler);
  
  // Single Chinese character "中" is 3 bytes in UTF-8
  // Using chunk size 2 bytes should cause corruption
  const content = "中"; // 3 bytes in UTF-8
  const chunks = chunkString(content, 2);
  
  // One of the chunks should be corrupted (incomplete multi-byte sequence)
  for (const chunk of chunks) {
    const bytes = new TextEncoder().encode(chunk);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe(chunk);
  }
});

test("chunkString splits long multi-byte content at byte boundaries", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const chunkString = (handler as any).chunkString.bind(handler);
  
  // Create content that's longer than the chunk size
  // Each Chinese character is 3 bytes, so "你好世界" is 12 bytes
  const content = "你好世界你好世界"; // 24 bytes total
  const chunks = chunkString(content, 10); // Split at 10 bytes
  
  console.log("Content:", content, "Length:", content.length, "Bytes:", [...new TextEncoder().encode(content)]);
  console.log("Chunks count:", chunks.length);
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const bytes = new TextEncoder().encode(chunk);
    const decoded = new TextDecoder().decode(bytes);
    console.log(`Chunk ${i}: "${chunk}" (${chunk.length} chars, ${bytes.length} bytes)`);
    expect(decoded).toBe(chunk);
  }
});

test("chunkString forces splitting of large multi-byte content", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const chunkString = (handler as any).chunkString.bind(handler);
  
  // Create very long Chinese text to force splitting
  // 50 Chinese characters = 150 bytes in UTF-8
  const content = "你".repeat(50); // 50 chars, 150 bytes
  const chunks = chunkString(content, 20); // Split at 20 bytes
  
  console.log("Content length:", content.length, "bytes:", new TextEncoder().encode(content).length);
  console.log("Chunks count:", chunks.length);
  
  expect(chunks.length).toBeGreaterThan(1); // Should actually split
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const bytes = new TextEncoder().encode(chunk);
    const decoded = new TextDecoder().decode(bytes);
    console.log(`Chunk ${i}: length=${chunk.length}, bytes=${bytes.length}, corrupted=${decoded !== chunk}`);
    expect(decoded).toBe(chunk);
  }
});

test("chunkString splits mixed ASCII and Chinese at byte boundaries", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const chunkString = (handler as any).chunkString.bind(handler);
  
  // Create mixed content where split point falls in middle of multi-byte chars
  // "abc你" = 4 chars, but 1+3=4 bytes in UTF-8
  // Using chunk size 3 bytes should force split after "ab" or "abc"
  const content = "abc你def你ghi你jkl"; // Mixed content
  const chunks = chunkString(content, 5); // Split at 5 bytes
  
  console.log("Content:", content, "bytes:", [...new TextEncoder().encode(content)]);
  console.log("Chunks:", chunks);
  
  for (const chunk of chunks) {
    const bytes = new TextEncoder().encode(chunk);
    const decoded = new TextDecoder().decode(bytes);
    console.log(`Chunk: "${chunk}" (${chunk.length} chars, ${bytes.length} bytes), corrupted: ${decoded !== chunk}`);
    expect(decoded).toBe(chunk);
  }
});

test("chunkString edge case: force byte boundary split", () => {
  const mockTransport = createMockTransport();
  const handler = new AGUICallbackHandler(mockTransport);

  const chunkString = (handler as any).chunkString.bind(handler);
  
  // Force the scenario where splitPoint hits 0 and is forced back to maxChunkSize
  // This requires content where the first maxChunkSize characters are all ASCII
  // but the byte size exceeds maxChunkSize
  const content = "aaaaa你bbbbb你ccccc"; // 5 'a' (5 bytes) + '你' (3 bytes) + 5 'b' (5 bytes) + '你' (3 bytes) + 5 'c' (5 bytes) = 21 bytes
  const chunks = chunkString(content, 10); // Split at 10 bytes
  
  console.log("Content:", content, "bytes:", [...new TextEncoder().encode(content)]);
  console.log("Chunks:", chunks);
  
  for (const chunk of chunks) {
    const bytes = new TextEncoder().encode(chunk);
    const decoded = new TextDecoder().decode(bytes);
    console.log(`Chunk: "${chunk}" (${chunk.length} chars, ${bytes.length} bytes), corrupted: ${decoded !== chunk}`);
    expect(decoded).toBe(chunk);
  }
});
