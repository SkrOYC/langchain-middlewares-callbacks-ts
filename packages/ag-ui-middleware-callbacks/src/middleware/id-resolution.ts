/**
 * ID Resolution Helpers
 *
 * Resolves AG-UI lifecycle IDs from supported LangChain runtime sources.
 */

interface ResolveLifecycleIdsOptions {
  context: unknown;
  threadIdOverride?: string;
  runIdOverride?: string;
  createFallbackRunId: () => string;
}

interface ResolvedLifecycleIds {
  threadId: string;
  runId: string;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Resolve lifecycle IDs using contract-supported paths.
 *
 * Precedence for `threadId`:
 * 1. runtime.context.thread_id / runtime.context.threadId
 * 2. threadIdOverride option
 * 3. fallback to ""
 *
 * Precedence for `runId`:
 * 1. runtime.context.run_id / runtime.context.runId
 * 2. runIdOverride option
 * 3. fallback via createFallbackRunId()
 */
export function resolveLifecycleIds(
  options: ResolveLifecycleIdsOptions
): ResolvedLifecycleIds {
  const contextAny = options.context as Record<string, unknown> | undefined;

  const contextThreadId =
    nonEmptyString(contextAny?.thread_id) ||
    nonEmptyString(contextAny?.threadId);
  const contextRunId =
    nonEmptyString(contextAny?.run_id) || nonEmptyString(contextAny?.runId);

  const overrideThreadId = nonEmptyString(options.threadIdOverride);
  const overrideRunId = nonEmptyString(options.runIdOverride);

  return {
    threadId: contextThreadId || overrideThreadId || "",
    runId: contextRunId || overrideRunId || options.createFallbackRunId(),
  };
}
