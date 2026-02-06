/**
 * Logger utility for RMM middleware.
 * Provides structured logging that can be configured or disabled in production.
 */

// Log levels as const object (preferred over enum for type safety)
export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

// Current log level - defaults to WARN in production, DEBUG in development
let currentLogLevel: LogLevel = (() => {
  // Check for explicit configuration
  if (typeof process !== "undefined" && process.env.RMM_LOG_LEVEL) {
    const envLevel = process.env.RMM_LOG_LEVEL.toUpperCase();
    if (envLevel in LogLevel) {
      return LogLevel[envLevel as keyof typeof LogLevel];
    }
    // Using console.warn directly as the logger is not yet initialized.
    console.warn(
      `[RMM/logger] Invalid RMM_LOG_LEVEL: "${process.env.RMM_LOG_LEVEL}". ` +
        'Valid levels are DEBUG, INFO, WARN, ERROR, NONE. Defaulting to "WARN".'
    );
  }
  // Default: WARN level (errors logged, debug/info suppressed)
  return LogLevel.WARN;
})();

// Logger interface
export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

/**
 * Format log message with optional context
 */
function formatMessage(message: string, context?: string): string {
  return context ? `[${context}] ${message}` : message;
}

/**
 * Get the current logger instance
 */
export function getLogger(context?: string): Logger {
  const prefix = context || "RMM";

  return {
    debug: (message: string, ...args: unknown[]) => {
      if (currentLogLevel <= LogLevel.DEBUG) {
        console.debug(formatMessage(message, prefix), ...args);
      }
    },
    info: (message: string, ...args: unknown[]) => {
      if (currentLogLevel <= LogLevel.INFO) {
        console.info(formatMessage(message, prefix), ...args);
      }
    },
    warn: (message: string, ...args: unknown[]) => {
      if (currentLogLevel <= LogLevel.WARN) {
        console.warn(formatMessage(message, prefix), ...args);
      }
    },
    error: (message: string, ...args: unknown[]) => {
      if (currentLogLevel <= LogLevel.ERROR) {
        console.error(formatMessage(message, prefix), ...args);
      }
    },
  };
}

/**
 * Set the log level programmatically
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

/**
 * Get the current log level
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}
