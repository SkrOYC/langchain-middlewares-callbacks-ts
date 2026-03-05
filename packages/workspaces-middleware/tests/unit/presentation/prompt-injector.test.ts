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
});
