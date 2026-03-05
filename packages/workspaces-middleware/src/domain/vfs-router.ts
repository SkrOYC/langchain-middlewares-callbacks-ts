import { isAbsolute, normalize, relative } from "node:path/posix";

import { AccessDeniedError, PathTraversalError } from "@/domain/errors";
import type { AccessScope, Workspace } from "@/domain/models";

const WINDOWS_ABSOLUTE_PATH_REGEX = /^[a-zA-Z]:[\\/]/;

export interface WorkspaceResolution {
  workspace: Workspace;
  normalizedLogicalPath: string;
  normalizedKey: string;
  scope: AccessScope;
}

export function coerceAbsoluteLogicalPath(requestPath: string): string {
  const normalizedSeparators = requestPath.replace(/\\/g, "/");
  const absolutePath = normalizedSeparators.startsWith("/")
    ? normalizedSeparators
    : `/${normalizedSeparators}`;

  return normalize(absolutePath);
}

export function validateFilePath(
  requestPath: string,
  rootPrefix: string
): string {
  if (requestPath.includes("..") || requestPath.includes("~")) {
    throw new PathTraversalError();
  }

  if (WINDOWS_ABSOLUTE_PATH_REGEX.test(requestPath)) {
    throw new PathTraversalError("Absolute Windows paths not allowed");
  }

  const normalizedRoot = normalizeWorkspacePrefix(rootPrefix);
  const normalizedRequestPath = coerceAbsoluteLogicalPath(requestPath);

  if (!isWithinPrefix(normalizedRequestPath, normalizedRoot)) {
    throw new PathTraversalError("Path escapes workspace boundary");
  }

  const relativeKey = relative(normalizedRoot, normalizedRequestPath);

  if (relativeKey.startsWith("..") || isAbsolute(relativeKey)) {
    throw new PathTraversalError("Path escapes workspace boundary");
  }

  return relativeKey;
}

export function resolveWorkspace(
  requestPath: string,
  workspaces: Workspace[]
): WorkspaceResolution {
  const normalizedLogicalPath = coerceAbsoluteLogicalPath(requestPath);

  let bestMatch: { workspace: Workspace; normalizedPrefix: string } | undefined;

  for (const workspace of workspaces) {
    const normalizedPrefix = normalizeWorkspacePrefix(workspace.prefix);

    if (!isWithinPrefix(normalizedLogicalPath, normalizedPrefix)) {
      continue;
    }

    if (
      bestMatch === undefined ||
      normalizedPrefix.length > bestMatch.normalizedPrefix.length
    ) {
      bestMatch = { workspace, normalizedPrefix };
    }
  }

  if (bestMatch === undefined) {
    throw new AccessDeniedError(
      "Requested path does not map to a configured workspace"
    );
  }

  const normalizedKey = validateFilePath(
    requestPath,
    bestMatch.normalizedPrefix
  );

  return {
    workspace: bestMatch.workspace,
    normalizedLogicalPath,
    normalizedKey,
    scope: bestMatch.workspace.scope,
  };
}

function normalizeWorkspacePrefix(prefix: string): string {
  const normalized = coerceAbsoluteLogicalPath(prefix);

  if (normalized !== "/" && normalized.endsWith("/")) {
    return normalized.slice(0, -1);
  }

  return normalized;
}

function isWithinPrefix(pathToCheck: string, prefix: string): boolean {
  if (prefix === "/") {
    return pathToCheck.startsWith("/");
  }

  return pathToCheck === prefix || pathToCheck.startsWith(`${prefix}/`);
}
