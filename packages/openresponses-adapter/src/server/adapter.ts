/**
 * Open Responses Adapter
 *
 * Programmatic adapter without HTTP transport.
 * TODO: Implement in Epic 3
 */

import type {
  OpenResponsesHandlerOptions,
  OpenResponsesRequest,
  OpenResponsesResponse,
} from "../core/index.js";
import type { OpenResponsesEvent } from "../core/schemas.js";

export interface OpenResponsesAdapter {
  invoke(
    request: OpenResponsesRequest,
    signal?: AbortSignal
  ): Promise<OpenResponsesResponse>;

  stream(
    request: OpenResponsesRequest,
    signal?: AbortSignal
  ): AsyncIterable<OpenResponsesEvent | "[DONE]">;
}

/**
 * Creates an Open Responses adapter without HTTP transport.
 *
 * @param options - Adapter configuration options
 * @returns Adapter with invoke and stream methods
 */
export function createOpenResponsesAdapter(
  _options: OpenResponsesHandlerOptions
): OpenResponsesAdapter {
  // TODO: Implement in ORL-007 through ORL-016
  return {
    invoke(_request: OpenResponsesRequest): Promise<OpenResponsesResponse> {
      return Promise.reject(
        new Error("Not implemented yet - see ORL-007-ORL-016")
      );
    },
    stream(
      _request: OpenResponsesRequest
    ): AsyncIterable<OpenResponsesEvent | "[DONE]"> {
      throw new Error("Not implemented yet - see ORL-007-ORL-016");
    },
  };
}
