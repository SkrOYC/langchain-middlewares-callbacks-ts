import { describe, expect, test } from "bun:test";

import {
  authorizeOperation,
  isOperationAllowed,
  type OperationType,
} from "../../../src/domain/access-guard";
import { AccessDeniedError } from "../../../src/domain/errors";

describe("access guard", () => {
  test("allows only read-like operations in READ_ONLY scope", () => {
    const allowed: OperationType[] = ["read", "list", "search"];
    const denied: OperationType[] = ["write", "edit"];

    for (const operation of allowed) {
      expect(isOperationAllowed(operation, "READ_ONLY")).toBe(true);
      expect(authorizeOperation(operation, "READ_ONLY")).toBe(true);
    }

    for (const operation of denied) {
      expect(isOperationAllowed(operation, "READ_ONLY")).toBe(false);
      expect(() => authorizeOperation(operation, "READ_ONLY")).toThrow(
        AccessDeniedError
      );
    }
  });

  test("allows all operations in READ_WRITE scope", () => {
    const operations: OperationType[] = [
      "read",
      "write",
      "edit",
      "list",
      "search",
    ];

    for (const operation of operations) {
      expect(isOperationAllowed(operation, "READ_WRITE")).toBe(true);
      expect(authorizeOperation(operation, "READ_WRITE")).toBe(true);
    }
  });

  test("allows only write-like operations in WRITE_ONLY scope", () => {
    const allowed: OperationType[] = ["write", "edit"];
    const denied: OperationType[] = ["read", "list", "search"];

    for (const operation of allowed) {
      expect(isOperationAllowed(operation, "WRITE_ONLY")).toBe(true);
      expect(authorizeOperation(operation, "WRITE_ONLY")).toBe(true);
    }

    for (const operation of denied) {
      expect(isOperationAllowed(operation, "WRITE_ONLY")).toBe(false);
      expect(() => authorizeOperation(operation, "WRITE_ONLY")).toThrow(
        AccessDeniedError
      );
    }
  });

  test("denies unknown operations by default", () => {
    const unknownOperation = "unknown" as OperationType;

    expect(isOperationAllowed(unknownOperation, "READ_WRITE")).toBe(false);
    expect(() => authorizeOperation(unknownOperation, "READ_WRITE")).toThrow(
      AccessDeniedError
    );
  });
});
