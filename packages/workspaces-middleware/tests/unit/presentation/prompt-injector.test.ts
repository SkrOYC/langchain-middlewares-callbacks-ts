import { describe, expect, test } from "bun:test";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { MountConfig } from "@/presentation/index";
import {
  FILESYSTEM_MAP_MARKER,
  generateFilesystemMap,
  injectFilesystemMap,
} from "@/presentation/prompt-injector";

const mountsTurnOne: MountConfig[] = [
  {
    prefix: "/alpha",
    scope: "READ_ONLY",
    store: { type: "physical", rootDir: "/tmp/alpha" },
  },
];

const mountsTurnTwo: MountConfig[] = [
  {
    prefix: "/beta",
    scope: "READ_WRITE",
    store: { type: "virtual", namespace: ["workspaces", "beta"] },
  },
];

describe("prompt-injector", () => {
  test("generates explicit deny message when no mounts exist", () => {
    const map = generateFilesystemMap([]);

    expect(map).toContain("(no mounted workspaces)");
    expect(map).toContain("denied by default");
  });

  test("injects fresh filesystem map each turn without stale content", () => {
    const initial = [new HumanMessage("hello")];

    const firstTurnMessages = injectFilesystemMap(initial, mountsTurnOne);
    const secondTurnMessages = injectFilesystemMap(
      firstTurnMessages,
      mountsTurnTwo
    );

    const firstSystem = firstTurnMessages[0] as { content?: unknown };
    const secondSystem = secondTurnMessages[0] as { content?: unknown };

    expect(typeof firstSystem.content).toBe("string");
    expect(typeof secondSystem.content).toBe("string");

    const firstContent = firstSystem.content as string;
    const secondContent = secondSystem.content as string;

    expect(firstContent).toContain(FILESYSTEM_MAP_MARKER);
    expect(firstContent).toContain("/alpha");
    expect(firstContent).toContain("physical");
    expect(firstContent).not.toContain("/tmp/alpha");
    expect(secondContent).toContain(FILESYSTEM_MAP_MARKER);
    expect(secondContent).toContain("/beta");
    expect(secondContent).not.toContain("/alpha");

    const mapMessageCount = secondTurnMessages.filter((message) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("content" in message)
      ) {
        return false;
      }

      const content = (message as { content?: unknown }).content;
      return (
        typeof content === "string" && content.includes(FILESYSTEM_MAP_MARKER)
      );
    }).length;

    expect(mapMessageCount).toBe(1);
  });

  test("preserves non-system messages that include the marker text", () => {
    const userMessage = new HumanMessage(
      `${FILESYSTEM_MAP_MARKER} keep this user message`
    );

    const firstTurnMessages = injectFilesystemMap([userMessage], mountsTurnOne);
    const secondTurnMessages = injectFilesystemMap(
      firstTurnMessages,
      mountsTurnTwo
    );

    const preservedUserMessage = secondTurnMessages.find(
      (message) =>
        message instanceof HumanMessage &&
        message.content === `${FILESYSTEM_MAP_MARKER} keep this user message`
    );

    expect(preservedUserMessage).toBeDefined();

    const injectedSystemMaps = secondTurnMessages.filter(
      (message) =>
        message instanceof SystemMessage &&
        typeof message.content === "string" &&
        message.content.startsWith(`${FILESYSTEM_MAP_MARKER}\n`)
    );

    expect(injectedSystemMaps).toHaveLength(1);
  });

  test("preserves foreign system messages that look like filesystem maps", () => {
    const foreignSystemMessage = new SystemMessage({
      content: `${FILESYSTEM_MAP_MARKER}\nFilesystem Map:\n- external replay`,
    });

    const nextMessages = injectFilesystemMap(
      [foreignSystemMessage],
      mountsTurnTwo
    );

    const foreignMessages = nextMessages.filter(
      (message) =>
        message instanceof SystemMessage &&
        message.content ===
          `${FILESYSTEM_MAP_MARKER}\nFilesystem Map:\n- external replay`
    );

    const injectedMaps = nextMessages.filter(
      (message) =>
        message instanceof SystemMessage &&
        typeof message.content === "string" &&
        message.additional_kwargs?.workspacesFilesystemMap === true
    );

    expect(foreignMessages).toHaveLength(1);
    expect(injectedMaps).toHaveLength(1);
  });

  test("handles undefined messages array", () => {
    const result = injectFilesystemMap(undefined, mountsTurnOne);

    expect(result).toHaveLength(1);
    const systemMessage = result[0] as SystemMessage;
    expect(systemMessage.content).toContain("/alpha");
  });

  test("handles non-array messages input", () => {
    const result = injectFilesystemMap("not an array" as never, mountsTurnOne);

    expect(result).toHaveLength(1);
  });

  test("handles null messages array element", () => {
    const messages = [null] as unknown[];
    const result = injectFilesystemMap(messages, mountsTurnOne);

    // Should still inject the filesystem map
    expect(result).toHaveLength(2);
  });

  test("handles messages with string type property", () => {
    const messages = [
      {
        type: "system",
        content: "system message with type property",
      },
    ];
    const result = injectFilesystemMap(messages, mountsTurnOne);

    expect(result).toHaveLength(2);
  });

  test("handles messages with role property", () => {
    const messages = [
      {
        role: "system",
        content: "system message with role property",
      },
    ];
    const result = injectFilesystemMap(messages, mountsTurnOne);

    expect(result).toHaveLength(2);
  });

  test("handles messages with _getType function", () => {
    const messages = [
      {
        _getType: () => "system",
        content: "system message with _getType",
      },
    ];
    const result = injectFilesystemMap(messages, mountsTurnOne);

    expect(result).toHaveLength(2);
  });

  test("handles messages with _getType that throws", () => {
    const messages = [
      {
        _getType: () => {
          throw new Error("getType failed");
        },
        content: "message with throwing _getType",
      },
    ];
    const result = injectFilesystemMap(messages, mountsTurnOne);

    // Should treat as non-system and preserve the message
    expect(result).toHaveLength(2);
  });

  test("handles message without additional_kwargs", () => {
    const messages = [
      {
        content: "simple message without additional_kwargs",
      },
    ];
    const result = injectFilesystemMap(messages, mountsTurnOne);

    expect(result).toHaveLength(2);
  });

  test("handles message with null additional_kwargs", () => {
    const messages = [
      {
        content: "message with null additional_kwargs",
        additional_kwargs: null,
      },
    ];
    const result = injectFilesystemMap(messages, mountsTurnOne);

    expect(result).toHaveLength(2);
  });
});
