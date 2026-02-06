/**
 * Utility Functions
 *
 * Shared utility functions for ACP middleware.
 *
 * @packageDocumentation
 */

/**
 * Extracts location information from tool arguments.
 * Looks for common path-related keys in the arguments.
 *
 * @param args - The tool arguments
 * @returns Array of location objects with path property
 *
 * @example
 * ```typescript
 * const locations = extractLocations({ path: "/tmp/file.txt" });
 * // Returns: [{ path: "/tmp/file.txt" }]
 * ```
 */
export function extractLocations(
	args: Record<string, unknown>,
): Array<{ path: string }> {
	const locations: Array<{ path: string }> = [];

	// Check for common path keys
	const pathKeys = [
		"path",
		"file",
		"filePath",
		"filepath",
		"targetPath",
		"sourcePath",
		"uri",
		"url",
	];

	for (const key of pathKeys) {
		if (args[key] && typeof args[key] === "string") {
			locations.push({ path: args[key] as string });
		} else if (args[key] && Array.isArray(args[key])) {
			// Handle array of paths
			for (const item of args[key] as unknown[]) {
				if (typeof item === "string") {
					locations.push({ path: item });
				}
			}
		}
	}

	return locations;
}
