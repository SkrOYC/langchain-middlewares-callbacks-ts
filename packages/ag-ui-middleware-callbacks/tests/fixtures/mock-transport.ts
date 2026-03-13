import { mock } from "bun:test";
import type { BaseEvent } from "../../../src/events";

export interface MockCallback {
  publish: ReturnType<typeof mock>;
  emit: ReturnType<typeof mock>;
  events: BaseEvent[];
}

export function createMockCallback(): MockCallback & {
  publish: ReturnType<typeof mock>;
  emit: ReturnType<typeof mock>;
} {
  const events: BaseEvent[] = [];
  const publish = mock((event: BaseEvent) => {
    events.push(event);
  });
  return {
    events,
    publish,
    emit: publish,
  };
}
