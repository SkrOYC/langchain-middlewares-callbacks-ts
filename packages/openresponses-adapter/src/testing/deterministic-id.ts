/**
 * Deterministic ID Generator
 *
 * Provides controllable ID generation for testing.
 */

let currentIdCounter = 0;
const idPrefix = "test-response-";

/**
 * Reset the ID counter.
 */
export function resetIdCounter(): void {
  currentIdCounter = 0;
}

/**
 * Set the starting ID counter.
 */
export function setIdCounter(start: number): void {
  currentIdCounter = start;
}

/**
 * Deterministic ID generator.
 * Returns IDs like: test-response-0, test-response-1, etc.
 */
export function deterministicId(): string {
  const id = `${idPrefix}${currentIdCounter}`;
  currentIdCounter++;
  return id;
}

/**
 * Creates a deterministic ID generator with custom prefix.
 */
export function createDeterministicIdGenerator(prefix = "test-"): () => string {
  let counter = 0;
  return () => {
    const id = `${prefix}${counter}`;
    counter++;
    return id;
  };
}

/**
 * Creates an ID generator that returns fixed IDs in sequence.
 *
 * Note: The non-null assertions are safe because we check for empty array
 * at the start of the function and return early if empty.
 */
export function createSequentialIdGenerator(ids: string[]): () => string {
  if (ids.length === 0) {
    return () => {
      throw new Error("ID generator created with empty array");
    };
  }
  let index = 0;
  return () => {
    if (index >= ids.length) {
      throw new Error(`ID generator exhausted: no more IDs at index ${index}`);
    }
    const value = ids[index];
    if (value === undefined) {
      throw new Error(`ID generator exhausted: no value at index ${index}`);
    }
    index++;
    return value;
  };
}

/**
 * Creates an ID generator that cycles through a list of IDs.
 *
 * Note: The non-null assertion is safe because we check for empty array
 * at the start of the function and return early if empty.
 */
export function createCyclingIdGenerator(ids: string[]): () => string {
  if (ids.length === 0) {
    return () => {
      throw new Error("ID generator created with empty array");
    };
  }
  let index = 0;
  return () => {
    const value = ids[index % ids.length];
    if (value === undefined) {
      throw new Error("ID generator created with empty array");
    }
    index++;
    return value;
  };
}
