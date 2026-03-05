import { ToolMessage } from "@langchain/core/messages";
import type { InteropZodObject } from "@langchain/core/utils/types";
import { createMiddleware } from "langchain";
import { z } from "zod";

import {
  buildVFSServices,
  createInMemoryBaseStore,
  synthesizeSafeTools,
} from "@/application/tool-synthesizer";
import type {
  RegisteredTool,
  WorkspacesMiddlewareOptions,
} from "@/presentation/index";
import { injectFilesystemMap } from "@/presentation/prompt-injector";

export interface WorkspacesMiddlewareContext {
  threadId?: string;
  runId?: string;
}

const workspacesContextSchema = z.object({
  threadId: z.string().optional(),
  runId: z.string().optional(),
}) as unknown as InteropZodObject;

export function createWorkspacesMiddleware(
  options: WorkspacesMiddlewareOptions
) {
  const virtualStore = createInMemoryBaseStore();

  return createMiddleware({
    name: "workspaces-vfs",
    contextSchema: workspacesContextSchema,

    beforeModel: (state) => {
      const stateMessages =
        typeof state === "object" &&
        state !== null &&
        "messages" in state &&
        Array.isArray((state as { messages?: unknown }).messages)
          ? ((state as { messages: unknown[] }).messages ?? [])
          : [];

      return {
        messages: injectFilesystemMap(stateMessages, options.mounts) as never,
      };
    },

    wrapToolCall: async (request, handler) => {
      const toolCallId = request.toolCall?.id ?? "unknown";

      try {
        const toolName = request.toolCall?.name;

        if (!toolName) {
          return await handler(request);
        }

        const registeredTool = findRegisteredTool(options.tools, toolName);

        if (registeredTool === undefined) {
          return await handler(request);
        }

        const safeTools = synthesizeSafeTools(options.mounts, options.tools);
        const safeTool = findRegisteredTool(safeTools, toolName);

        if (safeTool === undefined) {
          return errorToolMessage(
            toolCallId,
            `Tool '${toolName}' is not allowed by current workspace access scopes`
          );
        }

        const parsedParams = safeTool.parameters.parse(
          request.toolCall?.args ?? {}
        );
        const services = buildVFSServices(options.mounts, {
          virtualStore,
        });

        const result = await safeTool.handler(parsedParams, services);

        return new ToolMessage({
          tool_call_id: toolCallId,
          content: result.content,
          metadata: result.metadata,
        });
      } catch (error) {
        return errorToolMessage(toolCallId, getErrorMessage(error));
      }
    },
  });
}

function findRegisteredTool(
  tools: RegisteredTool[],
  name: string
): RegisteredTool | undefined {
  return tools.find((tool) => tool.name === name);
}

function errorToolMessage(toolCallId: string, message: string): ToolMessage {
  return new ToolMessage({
    tool_call_id: toolCallId,
    content: `Error: ${message}`,
    status: "error",
  });
}

function getErrorMessage(error: unknown): string {
  if (isFileNotFoundError(error)) {
    return "File not found";
  }

  if (error instanceof Error) {
    if (
      error.name === "AccessDeniedError" ||
      error.name === "PathTraversalError"
    ) {
      return error.message;
    }

    if (error.message.includes("File not found")) {
      return "File not found";
    }
  }

  return "Filesystem operation failed";
}

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT") {
    return true;
  }

  if (error instanceof Error) {
    return error.message.includes("ENOENT");
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes("ENOENT");
}
