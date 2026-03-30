import type { BaseEvent } from "@ag-ui/core";
import {
  createSSEStream as createSSEStreamImplementation,
  serializeEventAsSSE as serializeEventAsSSEImplementation,
} from "@/transports/sse";

export type AGUIEventSerializer = (event: BaseEvent) => Uint8Array;
export const createSSEStream = createSSEStreamImplementation;
export const serializeEventAsSSE = serializeEventAsSSEImplementation;

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
