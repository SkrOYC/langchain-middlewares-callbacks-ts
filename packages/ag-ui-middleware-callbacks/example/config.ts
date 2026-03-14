export type ExampleProvider = "mock" | "openai-compatible";

export interface ExampleAgentConfig {
  provider: ExampleProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  useResponsesApi: boolean;
  outputVersion: "v0" | "v1";
}

export const DEFAULT_AGENT_CONFIG: ExampleAgentConfig = {
  provider: "mock",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4.1-mini",
  useResponsesApi: false,
  outputVersion: "v0",
};

export const CUSTOM_HOST_HEADER = "x-example-key";
export const DEFAULT_CUSTOM_HOST_TOKEN = "demo-secret";

export const CALCULATOR_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    a: { type: "number" },
    b: { type: "number" },
    operation: {
      type: "string",
      enum: ["add", "subtract", "multiply", "divide"],
    },
  },
  required: ["a", "b", "operation"],
};
