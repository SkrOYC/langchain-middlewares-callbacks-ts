/**
 * ID Generator Utility
 * 
 * Generates unique IDs using crypto.randomUUID() for:
 * - messageId: Unique identifier for text message boundaries
 * - toolCallId: Unique identifier for tool call boundaries
 */

/**
 * Generate a unique ID using crypto.randomUUID()
 * 
 * @returns A UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateId(): string {
  return crypto.randomUUID();
}
