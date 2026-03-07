/**
 * Error Taxonomy
 *
 * Internal error codes used for classification within the adapter,
 * and public error types that are emitted on the wire per the Open Responses spec.
 */

import type { ErrorObject } from "./schemas.js";

// =============================================================================
// Internal Error Codes
// =============================================================================

/**
 * Internal error codes for adapter-specific classification.
 * These are mapped to spec-compliant public error types when emitted.
 */
export type InternalErrorCode =
	| "invalid_request"
	| "unsupported_media_type"
	| "previous_response_not_found"
	| "previous_response_unusable"
	| "agent_execution_failed"
	| "stream_transport_failed"
	| "internal_error";

/**
 * Internal error structure with code and details.
 */
export interface InternalError {
	code: InternalErrorCode;
	message: string;
	details?: Record<string, unknown>;
	cause?: unknown;
}

// =============================================================================
// Public Error Types (per Open Responses spec)
// =============================================================================

/**
 * Public error types that are emitted on the wire.
 * These are per the Open Responses specification.
 */
export type SpecErrorType =
	| "server_error" // 500: unexpected condition
	| "invalid_request_error" // 400: malformed request
	| "not_found" // 404: resource not found
	| "model_error" // 500: model execution error
	| "too_many_requests"; // 429: rate limited

// =============================================================================
// Error Mapping
// =============================================================================

/**
 * Maps internal error codes to HTTP status codes.
 */
export const internalErrorToStatusCode: Record<InternalErrorCode, number> = {
	invalid_request: 400,
	unsupported_media_type: 415,
	previous_response_not_found: 404,
	previous_response_unusable: 409,
	agent_execution_failed: 500,
	stream_transport_failed: 500,
	internal_error: 500,
};

/**
 * Maps internal error codes to public error types.
 */
export const internalErrorToSpecErrorType: Record<InternalErrorCode, SpecErrorType> =
	{
		invalid_request: "invalid_request_error",
		unsupported_media_type: "invalid_request_error",
		previous_response_not_found: "not_found",
		previous_response_unusable: "invalid_request_error",
		agent_execution_failed: "model_error",
		stream_transport_failed: "server_error",
		internal_error: "server_error",
	};

/**
 * Creates a public ErrorObject from an internal error.
 */
export function internalErrorToPublicError(
	internal: InternalError,
	defaultMessage = "An unexpected error occurred"
): ErrorObject {
	const specType = internalErrorToSpecErrorType[internal.code];
	const statusCode = internalErrorToStatusCode[internal.code];

	return {
		code: String(statusCode),
		message: internal.message || defaultMessage,
		type: specType,
	};
}

/**
 * Creates an internal error.
 */
export function createInternalError(
	code: InternalErrorCode,
	message: string,
	details?: Record<string, unknown>,
	cause?: unknown
): InternalError {
	return {
		code,
		message,
		details,
		cause,
	};
}

// =============================================================================
// Common Error Factory Functions
// =============================================================================

/**
 * Invalid request error factory.
 */
export function invalidRequest(
	message: string,
	details?: Record<string, unknown>
): InternalError {
	return createInternalError("invalid_request", message, details);
}

/**
 * Unsupported media type error factory.
 */
export function unsupportedMediaType(message: string): InternalError {
	return createInternalError("unsupported_media_type", message);
}

/**
 * Previous response not found error factory.
 */
export function previousResponseNotFound(responseId: string): InternalError {
	return createInternalError(
		"previous_response_not_found",
		`Previous response with id '${responseId}' not found`
	);
}

/**
 * Previous response unusable error factory.
 */
export function previousResponseUnusable(
	responseId: string,
	reason: string
): InternalError {
	return createInternalError(
		"previous_response_unusable",
		`Previous response '${responseId}' is unusable: ${reason}`
	);
}

/**
 * Agent execution failed error factory.
 */
export function agentExecutionFailed(
	message: string,
	cause?: unknown
): InternalError {
	return createInternalError("agent_execution_failed", message, undefined, cause);
}

/**
 * Stream transport failed error factory.
 */
export function streamTransportFailed(message: string): InternalError {
	return createInternalError("stream_transport_failed", message);
}

/**
 * Internal error factory.
 */
export function internalError(message: string, cause?: unknown): InternalError {
	return createInternalError("internal_error", message, undefined, cause);
}
