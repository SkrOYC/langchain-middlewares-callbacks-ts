import { mock } from "bun:test";

export interface AGUITransport {
  emit(event: any): void;
  connect?(): Promise<void>;
  disconnect?(): void;
  isConnected?(): boolean;
}

export function createMockTransport(): AGUITransport & { emit: ReturnType<typeof mock> } {
  return {
    emit: mock(() => {}),
  };
}
