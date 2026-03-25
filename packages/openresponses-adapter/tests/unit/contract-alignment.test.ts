import { describe, expect, test } from "bun:test";
import {
  contractSnapshotVersion,
  FunctionCallOutputItemSchema,
  OpenResponsesEventSchema,
  OpenResponsesRequestSchema,
  OpenResponsesResponseSchema,
  OutputItemSchema,
  ReasoningItemSchema,
  ResponseIncompleteEventSchema,
} from "@/core/schemas.js";

const createFullResponseFixture = () => ({
  id: "resp_123",
  object: "response",
  created_at: 1,
  completed_at: 2,
  status: "completed",
  incomplete_details: null,
  model: "gpt-4.1-mini",
  previous_response_id: null,
  instructions: null,
  output: [
    {
      type: "message",
      id: "msg_123",
      status: "completed",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "Hello",
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
  usage: {
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
  max_output_tokens: null,
  max_tool_calls: null,
  store: false,
  background: false,
  service_tier: "default",
  metadata: {},
  safety_identifier: null,
  prompt_cache_key: null,
});

describe("snapshot-aligned contract facade", () => {
  test("exports a stable snapshot version marker", () => {
    expect(contractSnapshotVersion).toBe("2.3.0+0e3605e36180");
  });

  test("accepts broadened request fields from the pinned snapshot", () => {
    const result = OpenResponsesRequestSchema.safeParse({
      model: "gpt-4.1-mini",
      input: [{ type: "message", role: "developer", content: "Be terse." }],
      include: ["reasoning.encrypted_content"],
      instructions: "Answer in one sentence.",
      store: false,
      background: false,
      truncation: "disabled",
      text: { format: { type: "text" }, verbosity: "medium" },
      reasoning: { effort: null, summary: null },
      top_p: 1,
      temperature: 0.2,
      max_output_tokens: 32,
      max_tool_calls: null,
      service_tier: "default",
      safety_identifier: null,
      prompt_cache_key: null,
      metadata: { source: "contract-test" },
    });

    expect(result.success).toBe(true);
  });

  test("accepts a full terminal ResponseResource", () => {
    const result = OpenResponsesResponseSchema.safeParse(
      createFullResponseFixture()
    );

    expect(result.success).toBe(true);
  });

  test("accepts response families outside the old MVP subset", () => {
    const reasoningResult = ReasoningItemSchema.safeParse({
      type: "reasoning",
      id: "rs_123",
      summary: [{ type: "summary_text", text: "Need to compare options." }],
    });

    const toolOutputResult = FunctionCallOutputItemSchema.safeParse({
      type: "function_call_output",
      id: "fc_out_123",
      call_id: "call_123",
      output: "55F",
      status: "completed",
    });

    expect(reasoningResult.success).toBe(true);
    expect(toolOutputResult.success).toBe(true);
  });

  test("accepts streaming terminal events that embed a full response resource", () => {
    const event = {
      type: "response.incomplete",
      sequence_number: 7,
      response: {
        ...createFullResponseFixture(),
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        completed_at: null,
      },
    };

    expect(ResponseIncompleteEventSchema.safeParse(event).success).toBe(true);
    expect(OpenResponsesEventSchema.safeParse(event).success).toBe(true);
  });

  test("rejects omitted required terminal response fields", () => {
    const response = createFullResponseFixture();
    const { tools: _tools, ...invalidResponse } = response;

    const result = OpenResponsesResponseSchema.safeParse(invalidResponse);
    expect(result.success).toBe(false);
  });

  test("output item union accepts reasoning and function_call_output items", () => {
    expect(
      OutputItemSchema.safeParse({
        type: "reasoning",
        id: "rs_456",
        summary: [{ type: "summary_text", text: "Compare paths." }],
      }).success
    ).toBe(true);

    expect(
      OutputItemSchema.safeParse({
        type: "function_call_output",
        id: "fc_out_456",
        call_id: "call_456",
        output: [{ type: "input_text", text: "done" }],
        status: "completed",
      }).success
    ).toBe(true);
  });
});
