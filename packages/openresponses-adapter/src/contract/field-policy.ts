export type ContractFieldPolicy =
  | "implemented"
  | "preserve"
  | "derive"
  | "default"
  | "read-repair";

export type TruthfulPublicationMode =
  | "live-delta"
  | "coarse-live"
  | "terminal-summary";

export interface ContractFieldPolicyEntry {
  field: string;
  policy: ContractFieldPolicy;
  notes: string;
}

export const terminalResponseFieldPolicy: ContractFieldPolicyEntry[] = [
  {
    field: "instructions",
    policy: "preserve",
    notes:
      "Echo from validated request snapshot once ORA-B001 broadens normalization.",
  },
  {
    field: "output",
    policy: "derive",
    notes:
      "Materialize from the canonical aggregate rather than transport-specific state.",
  },
  {
    field: "reasoning",
    policy: "default",
    notes:
      "Use explicit null/default semantics when the runtime exposes no compliant reasoning payload.",
  },
  {
    field: "usage",
    policy: "derive",
    notes:
      "Compute from canonical accounting when observations become available.",
  },
  {
    field: "contract_snapshot_version",
    policy: "read-repair",
    notes:
      "Persist on new records and use for migration decisions on older records.",
  },
] as const;

export const truthfulPublicationModes = {
  function_call_arguments: "live-delta",
  output_text: "live-delta",
  reasoning: "terminal-summary",
  reasoning_summary: "terminal-summary",
  refusal: "terminal-summary",
} as const satisfies Record<string, TruthfulPublicationMode>;
