import { normalize as normalizePosix } from "node:path/posix";

import { PathTraversalError } from "@/domain/errors";

const BACKSLASH_REGEX = /\\/g;
const LEADING_SLASHES_REGEX = /^\/+/;
const WINDOWS_ABSOLUTE_PREFIX_REGEX = /^[a-zA-Z]:/;

export function normalizeStoreKey(path: string, allowEmpty = false): string {
  if (path.includes("\0") || path.includes("~")) {
    throw new PathTraversalError();
  }

  const normalized = normalizePosix(path.replace(BACKSLASH_REGEX, "/")).replace(
    LEADING_SLASHES_REGEX,
    ""
  );

  if (WINDOWS_ABSOLUTE_PREFIX_REGEX.test(normalized)) {
    throw new PathTraversalError("Absolute Windows paths not allowed");
  }

  if (normalized === "." || normalized === "") {
    if (allowEmpty) {
      return "";
    }

    throw new PathTraversalError("Empty paths are not allowed");
  }

  if (normalized.startsWith("../") || normalized === "..") {
    throw new PathTraversalError();
  }

  return normalized;
}

export function sliceByWindow(
  content: string,
  offset = 0,
  limit?: number
): string {
  const boundedOffset = Math.max(0, offset);

  if (limit === undefined) {
    return content.slice(boundedOffset);
  }

  const boundedLimit = Math.max(0, limit);
  return content.slice(boundedOffset, boundedOffset + boundedLimit);
}
