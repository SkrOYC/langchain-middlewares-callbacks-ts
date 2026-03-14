import { createMiddleware } from "langchain";
import type { RunnableConfig } from "@langchain/core/runnables";
import { agentExecutionFailed } from "@/core/errors.js";
import {
  getEffectiveToolChoiceMode,
  OPENRESPONSES_TOOL_POLICY_CONFIG_KEY,
  SerializedNormalizedToolPolicySchema,
} from "@/core/tool-policy.js";

interface RunQueueState {
  tail: Promise<void>;
  pendingCount: number;
}

const getConfigurable = (runtime: unknown): Record<string, unknown> | null => {
  if (typeof runtime !== "object" || runtime === null) {
    return null;
  }

  const config = (runtime as { config?: RunnableConfig }).config;
  if (!config || typeof config !== "object") {
    return null;
  }

  const configurable = config.configurable;
  if (!configurable || typeof configurable !== "object") {
    return null;
  }

  return configurable as Record<string, unknown>;
};

const getPolicyKey = (configurable: Record<string, unknown> | null): string => {
  const runId = configurable?.run_id;
  if (typeof runId === "string" && runId.length > 0) {
    return runId;
  }

  const threadId =
    configurable?.thread_id ??
    configurable?.threadId ??
    configurable?.conversation_id;
  if (typeof threadId === "string" && threadId.length > 0) {
    return threadId;
  }

  return "openresponses-default-run";
};

const getSerializedPolicy = (
  configurable: Record<string, unknown> | null
) => {
  const policyValue = configurable?.[OPENRESPONSES_TOOL_POLICY_CONFIG_KEY];
  const result = SerializedNormalizedToolPolicySchema.safeParse(policyValue);
  return result.success ? result.data : null;
};

const getToolName = (request: unknown): string => {
  if (typeof request !== "object" || request === null) {
    return "unknown_tool";
  }

  const tool = (request as { tool?: { name?: string } | undefined }).tool;
  const toolCall = (request as { toolCall?: { name?: string } | undefined })
    .toolCall;

  return tool?.name ?? toolCall?.name ?? "unknown_tool";
};

export const createOpenResponsesToolPolicyMiddleware = () => {
  const runQueues = new Map<string, RunQueueState>();

  return createMiddleware({
    name: "openresponses-tool-policy",
    wrapToolCall: async (request, handler) => {
      const configurable = getConfigurable(request.runtime);
      const policy = getSerializedPolicy(configurable);
      if (!policy) {
        return handler(request);
      }

      const toolName = getToolName(request);
      const effectiveMode = getEffectiveToolChoiceMode(policy.toolChoice);

      if (effectiveMode === "none") {
        throw agentExecutionFailed("tool_choice forbids tool execution");
      }

      if (!policy.allowedToolNames.includes(toolName)) {
        throw agentExecutionFailed(
          `Tool '${toolName}' is not allowed for this request`
        );
      }

      if (policy.parallelToolCalls) {
        return handler(request);
      }

      const queueKey = getPolicyKey(configurable);
      const queue =
        runQueues.get(queueKey) ??
        ({
          tail: Promise.resolve(),
          pendingCount: 0,
        } satisfies RunQueueState);

      queue.pendingCount += 1;
      runQueues.set(queueKey, queue);

      const previous = queue.tail;
      let release!: () => void;
      const next = new Promise<void>((resolve) => {
        release = resolve;
      });

      // Keep the queue chain alive even if a prior gate were ever to reject.
      queue.tail = previous.then(
        () => next,
        () => next
      );

      await previous;

      try {
        return await handler(request);
      } finally {
        release();

        queue.pendingCount -= 1;
        if (queue.pendingCount === 0) {
          runQueues.delete(queueKey);
        }
      }
    },
    afterAgent: (_state, runtime) => {
      const configurable = getConfigurable(runtime);
      runQueues.delete(getPolicyKey(configurable));
      return;
    },
  });
};
