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

export interface TruthfulPublicationPolicyEntry {
  family: string;
  preferred: TruthfulPublicationMode;
  fallbacks: TruthfulPublicationMode[];
  notes: string;
}

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

export const truthfulPublicationPolicies: TruthfulPublicationPolicyEntry[] = [
  {
    family: "output_text",
    preferred: "live-delta",
    fallbacks: ["coarse-live"],
    notes:
      "Use raw token deltas when present; only fall back to coarse completion when the runtime exposes final text but not token chunks.",
  },
  {
    family: "function_call_arguments",
    preferred: "live-delta",
    fallbacks: ["coarse-live"],
    notes:
      "Use observed tool-call chunks or action/message-log deltas; fall back to done-only publication when only final arguments are available.",
  },
  {
    family: "reasoning",
    preferred: "live-delta",
    fallbacks: ["coarse-live", "terminal-summary"],
    notes:
      "Use LangChain chunk contentBlocks/v1 content when reasoning is exposed live; otherwise complete from final message truth without fabricating deltas.",
  },
  {
    family: "reasoning_summary",
    preferred: "coarse-live",
    fallbacks: ["terminal-summary"],
    notes:
      "Publish live only when structured summary parts are observed; otherwise include the summary only on final reasoning items.",
  },
  {
    family: "refusal",
    preferred: "coarse-live",
    fallbacks: ["terminal-summary"],
    notes:
      "Publish from observed refusal blocks or additional_kwargs, but never invent refusal deltas from plain text.",
  },
  {
    family: "output_text.annotation",
    preferred: "coarse-live",
    fallbacks: ["terminal-summary"],
    notes:
      "Emit annotations when they first appear on observed output_text blocks; otherwise leave them only on the finalized output text part.",
  },
] as const;
