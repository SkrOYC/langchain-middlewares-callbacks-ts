import { mock } from "bun:test";
import type { BaseEvent } from "../../../src/events";

export interface MockCallback {
  emit: ReturnType<typeof mock>;
  events: BaseEvent[];
}

export function createMockCallback(): MockCallback & { emit: ReturnType<typeof mock> } {
  const events: BaseEvent[] = [];
  return {
    events,
    emit: mock((event: BaseEvent) => {
      events.push(event);
    }),
  };
}
