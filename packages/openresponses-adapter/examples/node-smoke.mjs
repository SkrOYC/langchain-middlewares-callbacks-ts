import { createRequire } from "node:module";
import { buildOpenResponsesApp } from "../dist/server.js";
import { createFakeAgent } from "../dist/testing.js";

const require = createRequire(import.meta.url);
const cjsServer = require("../dist/server.cjs");

if (typeof cjsServer.buildOpenResponsesApp !== "function") {
  throw new Error("CJS export smoke check failed");
}

const app = await buildOpenResponsesApp({
  agent: createFakeAgent(),
});

const response = await app.fetch(
  new Request("http://localhost/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: "Hello",
      metadata: {},
      tools: [],
      parallel_tool_calls: true,
      stream: false,
    }),
  })
);

if (!response.ok) {
  throw new Error(`Node smoke failed with status ${response.status}`);
}

const payload = await response.json();
if (payload.object !== "response" || payload.status !== "completed") {
  throw new Error("Node smoke returned an unexpected response payload");
}
