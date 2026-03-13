import { describe, expect, test } from "bun:test";
import { AGUICallbackHandler as callbackHandlerFromSubpath } from "../../src/callbacks";
import {
  AGUICallbackHandler as callbackHandlerFromRoot,
  createAGUIMiddleware as createMiddlewareFromRoot,
} from "../../src/index";
import {
  AGUIMiddlewareOptionsSchema,
  createAGUIMiddleware as createMiddlewareFromSubpath,
} from "../../src/middleware";
import { createAGUIRunPublisher } from "../../src/publication";

describe("public surface", () => {
  test("root export stays limited to low-level producers", async () => {
    const rootExports = await import("../../src/index");

    expect(callbackHandlerFromRoot).toBeDefined();
    expect(createMiddlewareFromRoot).toBeDefined();
    expect("createAGUIAgent" in rootExports).toBe(false);
  });

  test("callbacks subpath exports callback handler API", () => {
    expect(callbackHandlerFromSubpath).toBeDefined();
  });

  test("middleware subpath exports middleware factory API", () => {
    expect(createMiddlewareFromSubpath).toBeDefined();
    expect(AGUIMiddlewareOptionsSchema).toBeDefined();
  });

  test("publication subpath exports run publisher API", () => {
    expect(createAGUIRunPublisher).toBeDefined();
  });
});
