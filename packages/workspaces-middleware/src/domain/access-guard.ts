import { AccessDeniedError } from "@/domain/errors";
import type { AccessScope } from "@/domain/models";

export type OperationType = "read" | "write" | "edit" | "list" | "search";

const READ_ONLY_OPERATIONS = new Set<OperationType>(["read", "list", "search"]);
const WRITE_ONLY_OPERATIONS = new Set<OperationType>(["write", "edit"]);
const READ_WRITE_OPERATIONS = new Set<OperationType>([
  "read",
  "write",
  "edit",
  "list",
  "search",
]);

export function isOperationAllowed(
  operation: OperationType,
  scope: AccessScope
): boolean {
  if (!READ_WRITE_OPERATIONS.has(operation)) {
    return false;
  }

  switch (scope) {
    case "READ_ONLY":
      return READ_ONLY_OPERATIONS.has(operation);
    case "READ_WRITE":
      return true;
    case "WRITE_ONLY":
      return WRITE_ONLY_OPERATIONS.has(operation);
    default:
      return false;
  }
}

export function authorizeOperation(
  operation: OperationType,
  scope: AccessScope
): true {
  if (!isOperationAllowed(operation, scope)) {
    throw new AccessDeniedError(
      `Operation '${operation}' is not permitted for scope '${scope}'`
    );
  }

  return true;
}
