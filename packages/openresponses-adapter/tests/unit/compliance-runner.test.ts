import { describe, expect, test } from "bun:test";
import { parseSSEStream } from "../../contracts/openresponses/compliance-runner/sse-parser.ts";
import { createOfficialComplianceFixtureAgent } from "../../scripts/official-compliance-fixtures.ts";

describe("vendored compliance runner SSE parser", () => {
  test("preserves event names across stream chunk boundaries", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: response.completed\n"));
        controller.enqueue(
          encoder.encode(
            'data: {"type":"response.completed","sequence_number":1,"response":{"id":"resp_1","object":"response","created_at":1,"completed_at":2,"status":"completed","incomplete_details":null,"model":"gpt-4.1-mini","previous_response_id":null,"instructions":null,"output":[{"type":"message","id":"msg_1","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Hello","annotations":[],"logprobs":[]}]}],"error":null,"tools":[],"tool_choice":"auto","truncation":"disabled","parallel_tool_calls":true,"text":{"format":{"type":"text"},"verbosity":"medium"},"top_p":1,"presence_penalty":0,"frequency_penalty":0,"top_logprobs":0,"temperature":1,"reasoning":null,"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}},"max_output_tokens":null,"max_tool_calls":null,"store":false,"background":false,"service_tier":"default","metadata":{},"safety_identifier":null,"prompt_cache_key":null}}\n\n'
          )
        );
        controller.close();
      },
    });

    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });

    const parsed = await parseSSEStream(response);

    expect(parsed.errors).toEqual([]);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]?.event).toBe("response.completed");
  });

  test("concatenates multi-line SSE data fields before parsing", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: response.completed\n"));
        controller.enqueue(
          encoder.encode('data: {"type":"response.completed",')
        );
        controller.enqueue(
          encoder.encode(
            '"sequence_number":1,"response":{"id":"resp_1","object":"response","created_at":1,"completed_at":2,"status":"completed","incomplete_details":null,"model":"gpt-4.1-mini","previous_response_id":null,"instructions":null,"output":[{"type":"message","id":"msg_1","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Hello","annotations":[],"logprobs":[]}]}],"error":null,"tools":[],"tool_choice":"auto","truncation":"disabled","parallel_tool_calls":true,"text":{"format":{"type":"text"},"verbosity":"medium"},"top_p":1,"presence_penalty":0,"frequency_penalty":0,"top_logprobs":0,"temperature":1,"reasoning":null,"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}},"max_output_tokens":null,"max_tool_calls":null,"store":false,"background":false,"service_tier":"default","metadata":{},"safety_identifier":null,"prompt_cache_key":null}}\n\n'
          )
        );
        controller.close();
      },
    });

    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });

    const parsed = await parseSSEStream(response);

    expect(parsed.errors).toEqual([]);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]?.data).toMatchObject({
      sequence_number: 1,
      type: "response.completed",
    });
  });
});

describe("official compliance fixtures", () => {
  test("emits function call arguments as a JSON string", async () => {
    const agent = createOfficialComplianceFixtureAgent();
    const result = (await agent.invoke(
      { messages: [] },
      {
        configurable: {
          openresponses_tool_policy: {
            tools: [{ name: "get_weather" }],
          },
        },
      }
    )) as {
      messages: Array<{
        tool_calls?: Array<{ arguments: unknown }>;
      }>;
    };

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.tool_calls?.[0]?.arguments).toBe(
      '{"location":"San Francisco, CA"}'
    );
  });
});
