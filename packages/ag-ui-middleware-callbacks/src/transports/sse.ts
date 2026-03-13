import type { BaseEvent } from "@ag-ui/core";

const textEncoder = new TextEncoder();

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
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
