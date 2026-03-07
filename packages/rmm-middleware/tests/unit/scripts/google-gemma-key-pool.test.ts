import { afterEach, describe, expect, test } from "bun:test";
import {
  __resetGoogleGemmaKeyPoolsForTests,
  createRotatingGemmaModel,
  getGoogleApiKeys,
} from "../../../scripts/adapters/google-gemma-key-pool";

const ORIGINAL_GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const ORIGINAL_GOOGLE_API_KEYS = process.env.GOOGLE_API_KEYS;

function createRateLimitError(message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = 429;
  return error;
}

afterEach(() => {
  __resetGoogleGemmaKeyPoolsForTests();

  if (ORIGINAL_GOOGLE_API_KEY === undefined) {
    process.env.GOOGLE_API_KEY = undefined;
  } else {
    process.env.GOOGLE_API_KEY = ORIGINAL_GOOGLE_API_KEY;
  }

  if (ORIGINAL_GOOGLE_API_KEYS === undefined) {
    process.env.GOOGLE_API_KEYS = undefined;
  } else {
    process.env.GOOGLE_API_KEYS = ORIGINAL_GOOGLE_API_KEYS;
  }
});

describe("google gemma key pool", () => {
  test("prefers GOOGLE_API_KEYS pool over single key", () => {
    process.env.GOOGLE_API_KEY = "single-key";
    process.env.GOOGLE_API_KEYS = "key-a, key-b\nkey-c";

    expect(getGoogleApiKeys()).toEqual(["key-a", "key-b", "key-c"]);
  });

  test("rotates invoke calls across pooled models", async () => {
    process.env.GOOGLE_API_KEYS = "key-a,key-b";

    const usedKeys: string[] = [];
    const model = createRotatingGemmaModel(
      (apiKey) =>
        ({
          invoke: async () => {
            await Promise.resolve();
            usedKeys.push(apiKey);
            return { content: "ok" };
          },
        }) as never
    );

    await model.invoke("first");
    await model.invoke("second");
    await model.invoke("third");

    expect(usedKeys).toEqual(["key-a", "key-b", "key-a"]);
  });

  test("shares scheduling order across separate model instances", async () => {
    process.env.GOOGLE_API_KEYS = "key-a,key-b,key-c";

    const usedKeys: string[] = [];
    const modelA = createRotatingGemmaModel(
      (apiKey) =>
        ({
          invoke: async () => {
            await Promise.resolve();
            usedKeys.push(apiKey);
            return { content: "ok" };
          },
        }) as never
    );
    const modelB = createRotatingGemmaModel(
      (apiKey) =>
        ({
          invoke: async () => {
            await Promise.resolve();
            usedKeys.push(apiKey);
            return { content: "ok" };
          },
        }) as never
    );

    await modelA.invoke("first");
    await modelB.invoke("second");
    await modelA.invoke("third");
    await modelB.invoke("fourth");

    expect(usedKeys).toEqual(["key-a", "key-b", "key-c", "key-a"]);
  });

  test("quarantines a rate-limited key and retries on a healthy key", async () => {
    process.env.GOOGLE_API_KEYS = "key-a,key-b";

    const usedKeys: string[] = [];
    const attemptsByKey = new Map<string, number>();
    const model = createRotatingGemmaModel(
      (apiKey) =>
        ({
          invoke: async () => {
            await Promise.resolve();
            const attempt = (attemptsByKey.get(apiKey) ?? 0) + 1;
            attemptsByKey.set(apiKey, attempt);
            usedKeys.push(`${apiKey}:${attempt}`);

            if (apiKey === "key-a" && attempt === 1) {
              throw createRateLimitError("Please retry in 0.03s");
            }

            return { content: "ok" };
          },
        }) as never
    );

    await expect(model.invoke("first")).resolves.toEqual({ content: "ok" });
    await expect(model.invoke("second")).resolves.toEqual({ content: "ok" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await expect(model.invoke("third")).resolves.toEqual({ content: "ok" });

    expect(usedKeys).toEqual(["key-a:1", "key-b:1", "key-b:2", "key-a:2"]);
  });
});
