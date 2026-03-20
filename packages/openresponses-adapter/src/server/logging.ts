import { internalErrorToStatusCode, toInternalError } from "@/core/errors.js";

interface LogPayload {
  duration_ms: number;
  error_code: string | null;
  event: string;
  path: string;
  request_id: string;
  response_id: string | null;
  status_code: number;
  stream: boolean;
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
  overrides: Pick<LogPayload, "error_code" | "event" | "status_code">
): LogPayload => {
  return {
    duration_ms: Date.now() - context.startedAt,
    error_code: overrides.error_code,
    event: overrides.event,
    path: context.path,
    request_id: context.requestId,
    response_id: context.responseId,
    status_code: overrides.status_code,
    stream: context.stream,
  };
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
      status_code: 0,
    })
  );
};

export const logRequestCompleted = (
  context: RequestLogContext,
  statusCode: number
): void => {
  writeLog(
    "info",
    buildPayload(context, {
      error_code: null,
      event: "request.completed",
      status_code: statusCode,
    })
  );
};

export const logRequestFailed = (
  context: RequestLogContext,
  error: unknown,
  statusCode?: number
): void => {
  const internal = toInternalError(error);

  writeLog(
    "error",
    buildPayload(context, {
      error_code: internal.code,
      event: "request.failed",
      status_code: statusCode ?? internalErrorToStatusCode[internal.code],
    })
  );
};
