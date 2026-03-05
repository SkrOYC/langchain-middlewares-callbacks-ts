import { SystemMessage } from "@langchain/core/messages";

import type { MountConfig } from "@/presentation/index";

export const FILESYSTEM_MAP_MARKER = "[WORKSPACES_FILESYSTEM_MAP]";

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
  });

  return [filesystemMapMessage, ...withoutPreviousMap];
}

function formatStoreSummary(mount: MountConfig): string {
  if (mount.store.type === "physical") {
    return `physical:${mount.store.rootDir}`;
  }

  return `virtual:${mount.store.namespace.join("/")}`;
}

function isInjectedFilesystemMapMessage(message: unknown): boolean {
  const content = extractMessageContent(message);
  return content.includes(FILESYSTEM_MAP_MARKER);
}

function extractMessageContent(message: unknown): string {
  if (typeof message !== "object" || message === null) {
    return "";
  }

  if (!("content" in message)) {
    return "";
  }

  const content = (message as { content?: unknown }).content;

  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (
        typeof item === "object" &&
        item !== null &&
        "text" in item &&
        typeof (item as { text?: unknown }).text === "string"
      ) {
        return (item as { text: string }).text;
      }

      return "";
    })
    .join("\n");
}
