import { test, expect } from "bun:test";

test("computeDelta returns JSON Patch operations", () => {
  const oldState = { messages: [] };
  const newState = { messages: [{ role: "user", content: "Hi" }] };
  const delta = computeStateDelta(oldState, newState);
  expect(Array.isArray(delta)).toBe(true);
  expect(delta.length).toBeGreaterThan(0);
  expect(delta[0]).toHaveProperty("op");
});

test("computeDelta handles nested object changes", () => {
  const oldState = { config: { temperature: 0.7 } };
  const newState = { config: { temperature: 0.9 } };
  const delta = computeStateDelta(oldState, newState);
  expect(Array.isArray(delta)).toBe(true);
  const replaceOp = delta.find((op: any) => op.op === "replace");
  expect(replaceOp).toBeDefined();
});

test("computeDelta handles array additions", () => {
  const oldState = { messages: [{ id: "1" }] };
  const newState = { messages: [{ id: "1" }, { id: "2" }] };
  const delta = computeStateDelta(oldState, newState);
  expect(Array.isArray(delta)).toBe(true);
  const addOp = delta.find((op: any) => op.op === "add");
  expect(addOp).toBeDefined();
});

test("computeDelta returns empty array for identical states", () => {
  const state = { messages: [{ role: "user", content: "Hi" }] };
  const delta = computeStateDelta(state, state);
  expect(Array.isArray(delta)).toBe(true);
  expect(delta.length).toBe(0);
});
