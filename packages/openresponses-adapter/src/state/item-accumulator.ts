import { invalidRequest } from "@/core/errors.js";
import type {
  FunctionCallItem,
  FunctionCallOutputItem,
  MessageOutputItem,
  OutputItem,
  OutputTextPart,
  ReasoningItem,
  RefusalContent,
} from "@/core/schemas.js";

interface ReasoningTextPart {
  readonly type: "reasoning_text";
  text: string;
}

interface SummaryTextPart {
  readonly type: "summary_text";
  text: string;
}

type MessagePart = OutputTextPart | RefusalContent;

type ReasoningContentPart = ReasoningTextPart;

export type CanonicalOutputItem = OutputItem;
export type CanonicalMessageItem = MessageOutputItem;
export type CanonicalFunctionCallItem = FunctionCallItem;
export type CanonicalFunctionCallOutputItem = FunctionCallOutputItem;
export type CanonicalReasoningItem = ReasoningItem;
export type CanonicalOutputTextPart = OutputTextPart;
export type CanonicalRefusalPart = RefusalContent;
export type CanonicalReasoningTextPart = ReasoningTextPart;
export type CanonicalSummaryTextPart = SummaryTextPart;

export interface CanonicalItemAccumulator {
  startMessageItem(input?: { id?: string }): CanonicalMessageItem;
  startTextMessageItem(input?: { id?: string }): CanonicalMessageItem;
  startRefusalMessageItem(input?: { id?: string }): CanonicalMessageItem;
  startOutputTextPart(itemId: string): CanonicalOutputTextPart;
  appendOutputTextDelta(
    itemId: string,
    contentIndexOrDelta: number | string,
    delta?: string
  ): void;
  appendRefusalDelta(itemId: string, delta: string): void;
  addOutputTextAnnotation(
    itemId: string,
    annotation: Record<string, unknown>
  ): void;
  finalizeOutputTextPart(
    itemId: string,
    contentIndex?: number
  ): CanonicalOutputTextPart;
  finalizeItem(
    itemId: string,
    status: "completed" | "incomplete"
  ): CanonicalOutputItem;
  finalizeMessageItem(
    itemId: string,
    status: "completed" | "incomplete"
  ): CanonicalMessageItem;
  startFunctionCallItem(input: {
    name: string;
    callId: string;
    id?: string;
    arguments?: string;
  }): CanonicalFunctionCallItem;
  appendFunctionCallArgumentsDelta(itemId: string, delta: string): void;
  finalizeFunctionCallItem(
    itemId: string,
    status: "completed" | "incomplete"
  ): CanonicalFunctionCallItem;
  addFunctionCallOutputItem(input: {
    callId: string;
    output: string | Record<string, unknown>[];
    id?: string;
    status?: "completed" | "incomplete";
  }): CanonicalFunctionCallOutputItem;
  startReasoningItem(input?: { id?: string }): CanonicalReasoningItem;
  appendReasoningDelta(itemId: string, delta: string): void;
  appendReasoningSummary(itemId: string, text: string): void;
  finalizeReasoningItem(
    itemId: string,
    status?: "completed" | "incomplete"
  ): CanonicalReasoningItem;
  finalizeOpenItemsAsIncomplete(): CanonicalOutputItem[];
  snapshot(): CanonicalOutputItem[];
}

export interface CanonicalItemAccumulatorOptions {
  generateId: () => string;
}

interface MutableOutputTextPart {
  readonly kind: "output_text";
  text: string;
  annotations: Record<string, unknown>[];
  finalized: boolean;
}

interface MutableRefusalPart {
  readonly kind: "refusal";
  refusal: string;
  finalized: boolean;
}

type MutableMessagePart = MutableOutputTextPart | MutableRefusalPart;

interface MutableMessageItem {
  readonly kind: "message";
  readonly id: string;
  status: "in_progress" | "completed" | "incomplete";
  finalized: boolean;
  content: MutableMessagePart[];
}

interface MutableFunctionCallItem {
  readonly kind: "function_call";
  readonly id: string;
  readonly name: string;
  readonly callId: string;
  arguments: string;
  status: "in_progress" | "completed" | "incomplete";
  finalized: boolean;
}

interface MutableFunctionCallOutputItem {
  readonly kind: "function_call_output";
  readonly id: string;
  readonly callId: string;
  output: string | Record<string, unknown>[];
  status: "completed" | "incomplete";
  finalized: true;
}

interface MutableReasoningItem {
  readonly kind: "reasoning";
  readonly id: string;
  status: "in_progress" | "completed" | "incomplete";
  finalized: boolean;
  content: ReasoningContentPart[];
  summary: SummaryTextPart[];
}

type MutableItem =
  | MutableMessageItem
  | MutableFunctionCallItem
  | MutableFunctionCallOutputItem
  | MutableReasoningItem;

const unreachableItemKind = (value: never): never => {
  throw new Error(`Unhandled canonical item kind: ${String(value)}`);
};

const duplicateTerminalError = (target: string): never => {
  throw invalidRequest(`${target} already received a terminal event`);
};

const asOutputTextPart = (
  part: MutableOutputTextPart
): CanonicalOutputTextPart => {
  return {
    type: "output_text",
    text: part.text,
    annotations: structuredClone(
      part.annotations
    ) as CanonicalOutputTextPart["annotations"],
    logprobs: [],
  };
};

const asRefusalPart = (part: MutableRefusalPart): CanonicalRefusalPart => {
  return {
    type: "refusal",
    refusal: part.refusal,
  };
};

const asMessagePart = (part: MutableMessagePart): MessagePart => {
  return part.kind === "output_text"
    ? asOutputTextPart(part)
    : asRefusalPart(part);
};

const asMessageItem = (item: MutableMessageItem): CanonicalMessageItem => {
  return {
    id: item.id,
    type: "message",
    role: "assistant",
    status: item.status,
    content: item.content.map(asMessagePart),
  };
};

const asFunctionCallItem = (
  item: MutableFunctionCallItem
): CanonicalFunctionCallItem => {
  return {
    id: item.id,
    type: "function_call",
    status: item.status,
    name: item.name,
    call_id: item.callId,
    arguments: item.arguments,
  };
};

const asFunctionCallOutputItem = (
  item: MutableFunctionCallOutputItem
): CanonicalFunctionCallOutputItem => {
  return {
    id: item.id,
    type: "function_call_output",
    call_id: item.callId,
    output: structuredClone(
      item.output
    ) as CanonicalFunctionCallOutputItem["output"],
    status: item.status,
  };
};

const asReasoningItem = (
  item: MutableReasoningItem
): CanonicalReasoningItem => {
  return {
    id: item.id,
    type: "reasoning",
    ...(item.content.length > 0
      ? { content: structuredClone(item.content) }
      : {}),
    summary: structuredClone(item.summary),
  };
};

const asOutputItem = (item: MutableItem): CanonicalOutputItem => {
  switch (item.kind) {
    case "message":
      return asMessageItem(item);
    case "function_call":
      return asFunctionCallItem(item);
    case "function_call_output":
      return asFunctionCallOutputItem(item);
    case "reasoning":
      return asReasoningItem(item);
    default:
      return unreachableItemKind(item);
  }
};

const duplicateItemIdError = (itemId: string): never => {
  throw invalidRequest(`Canonical item '${itemId}' already exists`);
};

class DefaultCanonicalItemAccumulator implements CanonicalItemAccumulator {
  readonly #generateId: () => string;
  readonly #items: MutableItem[] = [];
  readonly #itemsById = new Map<string, MutableItem>();

  constructor(options: CanonicalItemAccumulatorOptions) {
    this.#generateId = options.generateId;
  }

  #assertUniqueItemId(itemId: string): void {
    if (this.#itemsById.has(itemId)) {
      duplicateItemIdError(itemId);
    }
  }

  #addItem(item: MutableItem): void {
    this.#assertUniqueItemId(item.id);
    this.#items.push(item);
    this.#itemsById.set(item.id, item);
  }

  startTextMessageItem(input?: { id?: string }): CanonicalMessageItem {
    const item: MutableMessageItem = {
      kind: "message",
      id: input?.id ?? this.#generateId(),
      status: "in_progress",
      finalized: false,
      content: [
        {
          kind: "output_text",
          text: "",
          annotations: [],
          finalized: false,
        },
      ],
    };

    this.#addItem(item);
    return asMessageItem(item);
  }

  startMessageItem(input?: { id?: string }): CanonicalMessageItem {
    return this.startTextMessageItem(input);
  }

  startRefusalMessageItem(input?: { id?: string }): CanonicalMessageItem {
    const item: MutableMessageItem = {
      kind: "message",
      id: input?.id ?? this.#generateId(),
      status: "in_progress",
      finalized: false,
      content: [
        {
          kind: "refusal",
          refusal: "",
          finalized: false,
        },
      ],
    };

    this.#addItem(item);
    return asMessageItem(item);
  }

  startOutputTextPart(itemId: string): CanonicalOutputTextPart {
    return asOutputTextPart(this.#getOutputTextPart(itemId));
  }

  appendOutputTextDelta(
    itemId: string,
    contentIndexOrDelta: number | string,
    delta?: string
  ): void {
    const part = this.#getOutputTextPart(itemId);
    if (part.finalized) {
      duplicateTerminalError(`output text part for canonical item '${itemId}'`);
    }

    const nextDelta =
      typeof contentIndexOrDelta === "string"
        ? contentIndexOrDelta
        : (delta ?? "");
    part.text += nextDelta;
  }

  appendRefusalDelta(itemId: string, delta: string): void {
    const part = this.#getRefusalPart(itemId);
    if (part.finalized) {
      duplicateTerminalError(`refusal part for canonical item '${itemId}'`);
    }

    part.refusal += delta;
  }

  addOutputTextAnnotation(
    itemId: string,
    annotation: Record<string, unknown>
  ): void {
    const part = this.#getOutputTextPart(itemId);
    part.annotations.push(structuredClone(annotation));
  }

  finalizeOutputTextPart(
    itemId: string,
    _contentIndex = 0
  ): CanonicalOutputTextPart {
    const part = this.#getOutputTextPart(itemId);
    if (part.finalized) {
      duplicateTerminalError(`output text part for canonical item '${itemId}'`);
    }
    part.finalized = true;
    return asOutputTextPart(part);
  }

  finalizeItem(
    itemId: string,
    status: "completed" | "incomplete"
  ): CanonicalOutputItem {
    const item = this.#getItem(itemId);
    switch (item.kind) {
      case "message":
        return this.finalizeMessageItem(itemId, status);
      case "function_call":
        return this.finalizeFunctionCallItem(itemId, status);
      case "reasoning":
        return this.finalizeReasoningItem(itemId, status);
      case "function_call_output":
        return asFunctionCallOutputItem(item);
      default:
        return unreachableItemKind(item);
    }
  }

  finalizeMessageItem(
    itemId: string,
    status: "completed" | "incomplete"
  ): CanonicalMessageItem {
    const item = this.#getMessageItem(itemId);
    if (item.finalized) {
      duplicateTerminalError(`canonical item '${itemId}'`);
    }

    for (const part of item.content) {
      part.finalized = true;
    }

    item.finalized = true;
    item.status = status;
    return asMessageItem(item);
  }

  startFunctionCallItem(input: {
    name: string;
    callId: string;
    id?: string;
    arguments?: string;
  }): CanonicalFunctionCallItem {
    const item: MutableFunctionCallItem = {
      kind: "function_call",
      id: input.id ?? this.#generateId(),
      name: input.name,
      callId: input.callId,
      arguments: input.arguments ?? "",
      status: "in_progress",
      finalized: false,
    };

    this.#addItem(item);
    return asFunctionCallItem(item);
  }

  appendFunctionCallArgumentsDelta(itemId: string, delta: string): void {
    const item = this.#getFunctionCallItem(itemId);
    this.#assertItemOpen(item);
    item.arguments += delta;
  }

  finalizeFunctionCallItem(
    itemId: string,
    status: "completed" | "incomplete"
  ): CanonicalFunctionCallItem {
    const item = this.#getFunctionCallItem(itemId);
    if (item.finalized) {
      duplicateTerminalError(`canonical item '${itemId}'`);
    }

    item.finalized = true;
    item.status = status;
    return asFunctionCallItem(item);
  }

  addFunctionCallOutputItem(input: {
    callId: string;
    output: string | Record<string, unknown>[];
    id?: string;
    status?: "completed" | "incomplete";
  }): CanonicalFunctionCallOutputItem {
    const item: MutableFunctionCallOutputItem = {
      kind: "function_call_output",
      id: input.id ?? this.#generateId(),
      callId: input.callId,
      output: structuredClone(input.output),
      status: input.status ?? "completed",
      finalized: true,
    };

    this.#addItem(item);
    return asFunctionCallOutputItem(item);
  }

  startReasoningItem(input?: { id?: string }): CanonicalReasoningItem {
    const item: MutableReasoningItem = {
      kind: "reasoning",
      id: input?.id ?? this.#generateId(),
      status: "in_progress",
      finalized: false,
      content: [{ type: "reasoning_text", text: "" }],
      summary: [],
    };

    this.#addItem(item);
    return asReasoningItem(item);
  }

  appendReasoningDelta(itemId: string, delta: string): void {
    const item = this.#getReasoningItem(itemId);
    this.#assertItemOpen(item);
    const part = item.content[0];
    if (!part) {
      item.content.push({ type: "reasoning_text", text: delta });
      return;
    }

    part.text += delta;
  }

  appendReasoningSummary(itemId: string, text: string): void {
    const item = this.#getReasoningItem(itemId);
    item.summary.push({ type: "summary_text", text });
  }

  finalizeReasoningItem(
    itemId: string,
    status: "completed" | "incomplete" = "completed"
  ): CanonicalReasoningItem {
    const item = this.#getReasoningItem(itemId);
    if (item.finalized) {
      duplicateTerminalError(`canonical item '${itemId}'`);
    }

    item.finalized = true;
    item.status = status;
    return asReasoningItem(item);
  }

  finalizeOpenItemsAsIncomplete(): CanonicalOutputItem[] {
    const finalized: CanonicalOutputItem[] = [];
    for (const item of this.#items) {
      if ("finalized" in item && item.finalized) {
        continue;
      }

      if (item.kind === "message") {
        finalized.push(this.finalizeMessageItem(item.id, "incomplete"));
        continue;
      }

      if (item.kind === "function_call") {
        finalized.push(this.finalizeFunctionCallItem(item.id, "incomplete"));
        continue;
      }

      if (item.kind === "reasoning") {
        finalized.push(this.finalizeReasoningItem(item.id, "incomplete"));
      }
    }

    return finalized;
  }

  snapshot(): CanonicalOutputItem[] {
    return this.#items.map(asOutputItem);
  }

  #getItem(itemId: string): MutableItem {
    const item = this.#itemsById.get(itemId);
    if (item === undefined) {
      throw invalidRequest(`Unknown canonical item '${itemId}'`);
    }

    return item;
  }

  #getMessageItem(itemId: string): MutableMessageItem {
    const item = this.#getItem(itemId);
    if (item.kind !== "message") {
      throw invalidRequest(`Canonical item '${itemId}' is not a message item`);
    }

    return item;
  }

  #getFunctionCallItem(itemId: string): MutableFunctionCallItem {
    const item = this.#getItem(itemId);
    if (item.kind !== "function_call") {
      throw invalidRequest(
        `Canonical item '${itemId}' is not a function call item`
      );
    }

    return item;
  }

  #getReasoningItem(itemId: string): MutableReasoningItem {
    const item = this.#getItem(itemId);
    if (item.kind !== "reasoning") {
      throw invalidRequest(
        `Canonical item '${itemId}' is not a reasoning item`
      );
    }

    return item;
  }

  #getOutputTextPart(itemId: string): MutableOutputTextPart {
    const item = this.#getMessageItem(itemId);
    const part = item.content[0];
    if (!part || part.kind !== "output_text") {
      throw invalidRequest(
        `Canonical item '${itemId}' does not contain an output_text part`
      );
    }

    return part;
  }

  #getRefusalPart(itemId: string): MutableRefusalPart {
    const item = this.#getMessageItem(itemId);
    const part = item.content[0];
    if (!part || part.kind !== "refusal") {
      throw invalidRequest(
        `Canonical item '${itemId}' does not contain a refusal part`
      );
    }

    return part;
  }

  #assertItemOpen(
    item: MutableMessageItem | MutableFunctionCallItem | MutableReasoningItem
  ): void {
    if (item.finalized || item.status !== "in_progress") {
      duplicateTerminalError(`canonical item '${item.id}'`);
    }
  }
}

export const createCanonicalItemAccumulator = (
  options: CanonicalItemAccumulatorOptions
): CanonicalItemAccumulator => {
  return new DefaultCanonicalItemAccumulator(options);
};
