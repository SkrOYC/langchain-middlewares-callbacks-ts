import { invalidRequest } from "@/core/errors.js";
import type {
  FunctionCallItem,
  MessageOutputItem,
  OutputItem,
  OutputTextPart,
} from "@/core/schemas.js";

export type CanonicalOutputItem = OutputItem;
export type CanonicalMessageItem = MessageOutputItem;
export type CanonicalFunctionCallItem = FunctionCallItem;
export type CanonicalOutputTextPart = OutputTextPart;

export interface CanonicalItemAccumulator {
  startMessageItem(input?: { id?: string }): CanonicalMessageItem;
  startFunctionCallItem(input: {
    name: string;
    callId: string;
    id?: string;
    arguments?: string;
  }): CanonicalFunctionCallItem;
  startOutputTextPart(itemId: string): CanonicalOutputTextPart;
  appendOutputTextDelta(
    itemId: string,
    contentIndex: number,
    delta: string
  ): void;
  appendFunctionCallArgumentsDelta(itemId: string, delta: string): void;
  finalizeOutputTextPart(
    itemId: string,
    contentIndex: number
  ): CanonicalOutputTextPart;
  finalizeItem(
    itemId: string,
    status: "completed" | "incomplete"
  ): CanonicalOutputItem;
  snapshot(): CanonicalOutputItem[];
}

export interface CanonicalItemAccumulatorOptions {
  generateId: () => string;
}

interface MutableTextPart {
  readonly type: "output_text";
  status: "in_progress" | "completed";
  text: string;
  finalized: boolean;
}

interface MutableMessageItem {
  readonly kind: "message";
  readonly id: string;
  status: "in_progress" | "completed" | "incomplete";
  finalized: boolean;
  content: MutableTextPart[];
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

type MutableItem = MutableMessageItem | MutableFunctionCallItem;

const duplicateTerminalError = (target: string): never => {
  throw invalidRequest(`${target} already received a terminal event`);
};

const asOutputTextPart = (part: MutableTextPart): CanonicalOutputTextPart => {
  return {
    type: "output_text",
    text: part.text,
    annotations: [],
  };
};

const asMessageItem = (item: MutableMessageItem): CanonicalMessageItem => {
  return {
    id: item.id,
    type: "message",
    role: "assistant",
    status: item.status,
    content: item.content.map(asOutputTextPart),
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

const asOutputItem = (item: MutableItem): CanonicalOutputItem => {
  return item.kind === "message"
    ? asMessageItem(item)
    : asFunctionCallItem(item);
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

  startMessageItem(input?: { id?: string }): CanonicalMessageItem {
    const item: MutableMessageItem = {
      kind: "message",
      id: input?.id ?? this.#generateId(),
      status: "in_progress",
      finalized: false,
      content: [],
    };

    this.#assertUniqueItemId(item.id);
    this.#items.push(item);
    this.#itemsById.set(item.id, item);

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

    this.#assertUniqueItemId(item.id);
    this.#items.push(item);
    this.#itemsById.set(item.id, item);

    return asFunctionCallItem(item);
  }

  startOutputTextPart(itemId: string): CanonicalOutputTextPart {
    const item = this.#getMessageItem(itemId);
    this.#assertItemOpen(item);

    const part: MutableTextPart = {
      type: "output_text",
      status: "in_progress",
      text: "",
      finalized: false,
    };

    item.content.push(part);

    return asOutputTextPart(part);
  }

  appendOutputTextDelta(
    itemId: string,
    contentIndex: number,
    delta: string
  ): void {
    const part = this.#getTextPart(itemId, contentIndex);
    if (part.finalized) {
      duplicateTerminalError(
        `output text part ${contentIndex} for canonical item '${itemId}'`
      );
    }

    part.text += delta;
  }

  appendFunctionCallArgumentsDelta(itemId: string, delta: string): void {
    const item = this.#getFunctionCallItem(itemId);
    this.#assertItemOpen(item);
    item.arguments += delta;
  }

  finalizeOutputTextPart(
    itemId: string,
    contentIndex: number
  ): CanonicalOutputTextPart {
    const part = this.#getTextPart(itemId, contentIndex);
    if (part.finalized) {
      duplicateTerminalError(
        `output text part ${contentIndex} for canonical item '${itemId}'`
      );
    }

    part.finalized = true;
    part.status = "completed";

    return asOutputTextPart(part);
  }

  finalizeItem(
    itemId: string,
    status: "completed" | "incomplete"
  ): CanonicalOutputItem {
    const item = this.#getItem(itemId);
    if (item.finalized) {
      duplicateTerminalError(`canonical item '${itemId}'`);
    }

    if (item.kind === "message") {
      for (const [index, part] of item.content.entries()) {
        if (!part.finalized) {
          throw invalidRequest(
            `Cannot finalize canonical item '${itemId}' before output text part ${index} is closed`
          );
        }
      }
    }

    item.finalized = true;
    item.status = status;

    return asOutputItem(item);
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

  #getTextPart(itemId: string, contentIndex: number): MutableTextPart {
    const item = this.#getMessageItem(itemId);
    const part = item.content[contentIndex];
    if (!part) {
      throw invalidRequest(
        `Canonical item '${itemId}' does not contain output text part ${contentIndex}`
      );
    }

    return part;
  }

  #assertItemOpen(item: MutableItem): void {
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
