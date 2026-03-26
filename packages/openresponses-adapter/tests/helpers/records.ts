import { contractSnapshotVersion } from "@/core/schemas.js";
import type { StoredResponseRecord } from "@/core/types.js";

export const createRequestSnapshot = (
  overrides: Partial<StoredResponseRecord["request"]> = {}
): StoredResponseRecord["request"] => {
  return {
    model: "gpt-4.1-mini",
    input: [
      {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: "Be terse." }],
      },
      {
        type: "message",
        role: "user",
        content: "Tell me a joke",
      },
    ],
    previous_response_id: null,
    include: [],
    tools: [],
    tool_choice: "auto",
    parallel_tool_calls: true,
    instructions: null,
    store: false,
    background: false,
    truncation: "disabled",
    text: { format: { type: "text" }, verbosity: "medium" },
    reasoning: null,
    top_p: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
    top_logprobs: 0,
    temperature: 1,
    max_output_tokens: null,
    max_tool_calls: null,
    service_tier: "default",
    safety_identifier: null,
    prompt_cache_key: null,
    metadata: {},
    stream_options: null,
    ...overrides,
  };
};

export const createTerminalResponse = (
  overrides: Partial<StoredResponseRecord["response"]> = {}
): StoredResponseRecord["response"] => {
  return {
    id: "resp-prev",
    object: "response",
    created_at: 1000,
    completed_at: 2000,
    status: "completed",
    incomplete_details: null,
    model: "gpt-4.1-mini",
    previous_response_id: null,
    instructions: null,
    output: [
      {
        id: "msg-prev",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "Why did the test cross the road?",
            annotations: [],
            logprobs: [],
          },
        ],
      },
    ],
    error: null,
    tools: [],
    tool_choice: "auto",
    truncation: "disabled",
    parallel_tool_calls: true,
    text: { format: { type: "text" }, verbosity: "medium" },
    top_p: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
    top_logprobs: 0,
    temperature: 1,
    reasoning: null,
    usage: null,
    max_output_tokens: null,
    max_tool_calls: null,
    store: false,
    background: false,
    service_tier: "default",
    metadata: {},
    safety_identifier: null,
    prompt_cache_key: null,
    ...overrides,
  };
};

export const createPriorRecord = (): StoredResponseRecord => {
  return {
    response_id: "resp-prev",
    request: createRequestSnapshot(),
    response: createTerminalResponse(),
    status: "completed",
    created_at: 1000,
    completed_at: 2000,
    contract_snapshot_version: contractSnapshotVersion,
  };
};

export const createImagePriorRecord = (): StoredResponseRecord => {
  return {
    ...createPriorRecord(),
    request: {
      ...createRequestSnapshot(),
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "Describe this image." },
            {
              type: "input_image",
              image_url: "https://example.com/cat.png",
              detail: "high",
            },
          ],
        },
      ],
    },
  };
};
