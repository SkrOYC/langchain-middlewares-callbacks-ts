import type { StoredResponseRecord } from "@/core/types.js";

export const createPriorRecord = (): StoredResponseRecord => {
  return {
    response_id: "resp-prev",
    created_at: 1000,
    completed_at: 2000,
    model: "gpt-4.1-mini",
    request: {
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
      metadata: {},
      tools: [],
      parallel_tool_calls: true,
    },
    response: {
      id: "resp-prev",
      object: "response",
      created_at: 1000,
      completed_at: 2000,
      status: "completed",
      model: "gpt-4.1-mini",
      previous_response_id: null,
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
            },
          ],
        },
      ],
      error: null,
      metadata: {},
    },
    status: "completed",
    error: null,
  };
};

export const createImagePriorRecord = (): StoredResponseRecord => {
  return {
    ...createPriorRecord(),
    request: {
      ...createPriorRecord().request,
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
