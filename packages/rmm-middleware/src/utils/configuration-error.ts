/**
 * Custom error class for configuration-related errors
 *
 * Used when the middleware is configured incorrectly, such as:
 * - Embedding dimension mismatches
 * - Missing required configuration options
 * - Invalid configuration values
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConfigurationError);
    }
  }
}
