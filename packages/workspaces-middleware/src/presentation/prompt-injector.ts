import { SystemMessage } from "@langchain/core/messages";

import type { MountConfig } from "@/presentation/index";

export const FILESYSTEM_MAP_MARKER = "[WORKSPACES_FILESYSTEM_MAP]";
const FILESYSTEM_MAP_MESSAGE_FLAG = "workspacesFilesystemMap";

export function generateFilesystemMap(mounts: MountConfig[]): string {
  const normalizedMounts = [...mounts].sort((left, right) =>
    left.prefix.localeCompare(right.prefix)
  );

  if (normalizedMounts.length === 0) {
    return [
      "Filesystem Map:",
      "- (no mounted workspaces)",
      "- All filesystem operations are denied by default.",
    ].join("\n");
  }

  return [
    "Filesystem Map:",
    ...normalizedMounts.map(
      (mount) =>
        `- ${mount.prefix} [${mount.scope}] -> ${formatStoreSummary(mount)}`
    ),
  ].join("\n");
}

export function injectFilesystemMap(
  messages: unknown[] | undefined,
  mounts: MountConfig[]
): unknown[] {
  const baseMessages = Array.isArray(messages) ? messages : [];
  const withoutPreviousMap = baseMessages.filter(
    (message) => !isInjectedFilesystemMapMessage(message)
  );
  const filesystemMapMessage = new SystemMessage({
    content: `${FILESYSTEM_MAP_MARKER}\n${generateFilesystemMap(mounts)}`,
    additional_kwargs: {
      [FILESYSTEM_MAP_MESSAGE_FLAG]: true,
    },
  });

  return [filesystemMapMessage, ...withoutPreviousMap];
}

function formatStoreSummary(mount: MountConfig): string {
  if (mount.store.type === "physical") {
    return "physical";
  }

  return `virtual:${mount.store.namespace.join("/")}`;
}

function isInjectedFilesystemMapMessage(message: unknown): boolean {
  if (!isSystemRoleMessage(message)) {
    return false;
  }

  const additionalKwargs = extractAdditionalKwargs(message);
  return additionalKwargs[FILESYSTEM_MAP_MESSAGE_FLAG] === true;
}

function isSystemRoleMessage(message: unknown): boolean {
  if (SystemMessage.isInstance(message)) {
    return true;
  }

  if (typeof message !== "object" || message === null) {
    return false;
  }

  if ((message as { type?: unknown }).type === "system") {
    return true;
  }

  if ((message as { role?: unknown }).role === "system") {
    return true;
  }

  const getType = (message as { _getType?: unknown })._getType;
  if (typeof getType === "function") {
    try {
      return getType() === "system";
    } catch {
      return false;
    }
  }

  return false;
}

function extractAdditionalKwargs(message: unknown): Record<string, unknown> {
  if (typeof message !== "object" || message === null) {
    return {};
  }

  const additionalKwargs = (message as { additional_kwargs?: unknown })
    .additional_kwargs;

  if (typeof additionalKwargs !== "object" || additionalKwargs === null) {
    return {};
  }

  return additionalKwargs as Record<string, unknown>;
}
