/**
 * ID Generator Utility
 *
 * Generates unique IDs using crypto.randomUUID() or deterministic hashing.
 */

/**
 * Generate a unique ID using crypto.randomUUID()
 *
 * @returns A UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateId(): string {
	return crypto.randomUUID();
}

/**
 * Generate a deterministic ID from a base ID and an index.
 * Useful for coordinating between Middleware and Callbacks without direct communication.
 *
 * @param baseId - The base ID (e.g., runId)
 * @param index - The turn index
 * @returns A deterministic hyphenated string [prefix]-[hash]
 */
export function generateDeterministicId(baseId: string, index: number): string {
	if (!baseId) {
		throw new Error("baseId is required for deterministic ID generation");
	}

	const str = `${baseId}-${index}`;
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32bit integer
	}

	// Return a stable hex string
	const hex = Math.abs(hash).toString(16).padStart(8, "0");

	// Use the baseId as the prefix to ensure uniqueness across different runs.
	// We keep the full baseId to avoid any ambiguity or collision risk.
	return `${baseId}-${hex}`;
}
