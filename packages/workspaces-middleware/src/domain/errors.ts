const DEFAULT_PATH_TRAVERSAL_ERROR_MESSAGE = "Path traversal not allowed";
const DEFAULT_ACCESS_DENIED_ERROR_MESSAGE =
  "Operation not permitted for this workspace scope";

export class PathTraversalError extends Error {
  constructor(message = DEFAULT_PATH_TRAVERSAL_ERROR_MESSAGE) {
    super(message);
    this.name = "PathTraversalError";
  }
}

export class AccessDeniedError extends Error {
  constructor(message = DEFAULT_ACCESS_DENIED_ERROR_MESSAGE) {
    super(message);
    this.name = "AccessDeniedError";
  }
}
