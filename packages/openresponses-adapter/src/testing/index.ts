/**
 * Testing Module
 *
 * Deterministic test helpers and fakes for testing the adapter.
 */

// Clock utilities
export {
  advanceTime,
  createDeterministicClock,
  createFixedClock,
  deterministicClock,
  resetClock,
  setTime,
} from "./deterministic-clock.js";

// ID generator utilities
export {
  createCyclingIdGenerator,
  createDeterministicIdGenerator,
  createSequentialIdGenerator,
  deterministicId,
  resetIdCounter,
  setIdCounter,
} from "./deterministic-id.js";
export type { FakeAgentConfig } from "./fake-agent.js";
// Fake agent
export {
  createErrorFakeAgent,
  createFakeAgent,
  createStreamingFakeAgent,
  createTextFakeAgent,
} from "./fake-agent.js";
export type { InMemoryPreviousResponseStore } from "./in-memory-store.js";
// In-memory store
export {
  createInMemoryPreviousResponseStore,
  createPopulatedInMemoryStore,
} from "./in-memory-store.js";
