import type { BaseEvent } from "@ag-ui/core";
import { serializeEventAsSSE as serializeEventAsSSEImplementation } from "../transports/sse";

export type AGUIEventSerializer = (event: BaseEvent) => Uint8Array;

export function serializeEventAsSSE(event: BaseEvent): Uint8Array {
  return serializeEventAsSSEImplementation(event);
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
