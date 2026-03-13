import type { BaseEvent } from "@ag-ui/core";

const textEncoder = new TextEncoder();
const contentTypeHeader = "text/event-stream";
const cacheControlHeader = "no-cache";
const connectionHeader = "keep-alive";

export const SSE_HEADERS = {
  "Content-Type": contentTypeHeader,
  "Cache-Control": cacheControlHeader,
  Connection: connectionHeader,
} as const;

export function serializeEventAsSSE(event: BaseEvent): Uint8Array {
  return textEncoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function createSSEResponse(
  stream: ReadableStream<Uint8Array>,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers);

  for (const [key, value] of Object.entries(SSE_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return new Response(stream, {
    ...init,
    headers,
  });
}
