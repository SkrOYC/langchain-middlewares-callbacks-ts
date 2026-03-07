/**
 * Testing Module
 *
 * Deterministic test helpers and fakes for testing the adapter.
 */

// Clock utilities
export {
	deterministicClock,
	createDeterministicClock,
	createFixedClock,
	resetClock,
	setTime,
	advanceTime,
} from "./deterministic-clock.js";

// ID generator utilities
export {
	deterministicId,
	createDeterministicIdGenerator,
	createSequentialIdGenerator,
	createCyclingIdGenerator,
	resetIdCounter,
	setIdCounter,
} from "./deterministic-id.js";

// Fake agent
export {
	createFakeAgent,
	createTextFakeAgent,
	createStreamingFakeAgent,
	createErrorFakeAgent,
} from "./fake-agent.js";
export type { FakeAgentConfig } from "./fake-agent.js";

// In-memory store
export {
	createInMemoryPreviousResponseStore,
	createPopulatedInMemoryStore,
} from "./in-memory-store.js";
export type { InMemoryPreviousResponseStore } from "./in-memory-store.js";
