import { test, expect } from "bun:test";

test("generateId creates unique IDs", () => {
  const id1 = generateId();
  const id2 = generateId();
  expect(id1).not.toBe(id2);
  expect(typeof id1).toBe("string");
  expect(id1.length).toBeGreaterThan(0);
});

test("generateId creates UUIDs", () => {
  const id = generateId();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  expect(id).toMatch(uuidRegex);
});

test("generateId never returns empty string", () => {
  for (let i = 0; i < 100; i++) {
    const id = generateId();
    expect(id).not.toBe("");
    expect(id).not.toBeUndefined();
    expect(id).not.toBeNull();
  }
});
