/**
 * Deterministic Clock
 *
 * Provides controllable timestamps for testing.
 */

let currentTime = 1_700_000_000_000; // Default: some fixed timestamp

/**
 * Reset the clock to default value.
 */
export function resetClock(): void {
  currentTime = 1_700_000_000_000;
}

/**
 * Set a specific timestamp.
 */
export function setTime(time: number): void {
  currentTime = time;
}

/**
 * Advance the clock by milliseconds.
 */
export function advanceTime(ms: number): void {
  currentTime += ms;
}

/**
 * Deterministic clock function.
 * Returns the current timestamp.
 */
export function deterministicClock(): number {
  return currentTime;
}

/**
 * Creates a deterministic clock with initial value.
 */
export function createDeterministicClock(initialTime?: number): () => number {
  let time = initialTime ?? 1_700_000_000_000;
  return () => {
    const result = time;
    time += 1; // Advance by 1ms each call
    return result;
  };
}

/**
 * Creates a deterministic clock that returns fixed timestamps.
 */
export function createFixedClock(fixedTime: number): () => number {
  return () => fixedTime;
}
