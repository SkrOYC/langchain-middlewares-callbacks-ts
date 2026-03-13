import type { BaseEvent } from "@ag-ui/core";
import { serializeEventAsSSE } from "@/transports/sse";

export type AGUIEventSerializer = (event: BaseEvent) => Uint8Array;
export { serializeEventAsSSE };

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
