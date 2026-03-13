import type { BaseEvent } from "@ag-ui/core";

export type AGUIEventSerializer = (event: BaseEvent) => Uint8Array;

const textEncoder = new TextEncoder();

export function serializeEventAsSSE(event: BaseEvent): Uint8Array {
  return textEncoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function resolvePublisherSerializer(
  serializer?: AGUIEventSerializer,
  transport: "sse" = "sse"
): AGUIEventSerializer {
  if (serializer) {
    return serializer;
  }

  if (transport === "sse") {
    return serializeEventAsSSE;
  }

  return serializeEventAsSSE;
}
