import { contractSnapshotVersion } from "@/contract/snapshot.js";
import { internalErrorToStatusCode, toInternalError } from "@/core/errors.js";

type FailureClass =
  | "continuation"
  | "internal"
  | "persistence"
  | "runtime"
  | "timeout"
  | "transport"
  | "validation"
  | null;

type TerminalStatus = "completed" | "failed" | "incomplete" | null;

interface LogPayload {
  contract_snapshot_version: string;
  duration_ms: number;
  error_code: string | null;
  event: string;
  failure_class: FailureClass;
  path: string;
  request_id: string;
  response_id: string | null;
  status_code: number;
  stream: boolean;
  terminal_status: TerminalStatus;
}

const writeLog = (method: "error" | "info", payload: LogPayload): void => {
  console[method](JSON.stringify(payload));
};

export interface RequestLogContext {
  path: string;
  requestId: string;
  responseId: string | null;
  startedAt: number;
  stream: boolean;
}

const buildPayload = (
  context: RequestLogContext,
  overrides: Pick<
    LogPayload,
    "error_code" | "event" | "failure_class" | "status_code" | "terminal_status"
  >
): LogPayload => {
  return {
    contract_snapshot_version: contractSnapshotVersion,
    duration_ms: Date.now() - context.startedAt,
    error_code: overrides.error_code,
    event: overrides.event,
    failure_class: overrides.failure_class,
    path: context.path,
    request_id: context.requestId,
    response_id: context.responseId,
    status_code: overrides.status_code,
    stream: context.stream,
    terminal_status: overrides.terminal_status,
  };
};

const classifyFailure = (error: unknown): FailureClass => {
  const internal = toInternalError(error);

  switch (internal.code) {
    case "invalid_request":
    case "unsupported_media_type":
      return "validation";
    case "previous_response_not_found":
    case "previous_response_unusable":
      return "continuation";
    case "stream_transport_failed":
      return "transport";
    case "agent_execution_failed":
      return internal.message.toLowerCase().includes("timed out")
        ? "timeout"
        : "runtime";
    case "internal_error": {
      const message = internal.message.toLowerCase();
      if (message.includes("save previous response")) {
        return "persistence";
      }
      if (message.includes("timed out")) {
        return "timeout";
      }
      return "internal";
    }
    default:
      return "internal";
  }
};

export const getRequestPath = (request: Request): string => {
  if (typeof request.url === "string" && request.url.length > 0) {
    try {
      return new URL(request.url).pathname;
    } catch {
      return request.url;
    }
  }

  return "/v1/responses";
};

export const logRequestStarted = (context: RequestLogContext): void => {
  writeLog(
    "info",
    buildPayload(context, {
      error_code: null,
      event: "request.started",
      failure_class: null,
      status_code: 0,
      terminal_status: null,
    })
  );
};

export const logRequestCompleted = (
  context: RequestLogContext,
  statusCode: number,
  terminalStatus: Exclude<TerminalStatus, null> = "completed"
): void => {
  writeLog(
    "info",
    buildPayload(context, {
      error_code: null,
      event: "request.completed",
      failure_class: null,
      status_code: statusCode,
      terminal_status: terminalStatus,
    })
  );
};

export const logRequestFailed = (
  context: RequestLogContext,
  error: unknown,
  statusCode?: number,
  terminalStatus: TerminalStatus = null
): void => {
  const internal = toInternalError(error);

  writeLog(
    "error",
    buildPayload(context, {
      error_code: internal.code,
      event: "request.failed",
      failure_class: classifyFailure(internal),
      status_code: statusCode ?? internalErrorToStatusCode[internal.code],
      terminal_status: terminalStatus,
    })
  );
};
