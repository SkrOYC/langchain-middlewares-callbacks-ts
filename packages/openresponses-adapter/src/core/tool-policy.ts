import { z } from "zod";
import {
  FunctionToolSchema,
  type ToolChoice,
  ToolChoiceSchema,
} from "./schemas.js";
import type { NormalizedToolPolicy } from "./types.js";

export type EffectiveToolChoiceMode = "none" | "auto" | "required";

export const OPENRESPONSES_TOOL_POLICY_CONFIG_KEY = "openresponses_tool_policy";

export const SerializedNormalizedToolPolicySchema = z.object({
  tools: z.array(FunctionToolSchema),
  allowedToolNames: z.array(z.string().min(1)),
  toolChoice: ToolChoiceSchema,
  parallelToolCalls: z.boolean(),
});

export type SerializedNormalizedToolPolicy = z.infer<
  typeof SerializedNormalizedToolPolicySchema
>;

export const getEffectiveToolChoiceMode = (
  toolChoice: ToolChoice
): EffectiveToolChoiceMode => {
  if (toolChoice === "none") {
    return "none";
  }

  if (toolChoice === "required") {
    return "required";
  }

  if (toolChoice === "auto") {
    return "auto";
  }

  if ("type" in toolChoice && toolChoice.type === "allowed_tools") {
    return toolChoice.mode ?? "auto";
  }

  return "required";
};

export const serializeNormalizedToolPolicy = (
  policy: NormalizedToolPolicy
): SerializedNormalizedToolPolicy => {
  return {
    tools: structuredClone(policy.tools),
    allowedToolNames: [...policy.allowedToolNames],
    toolChoice: structuredClone(policy.toolChoice),
    parallelToolCalls: policy.parallelToolCalls,
  };
};
