import { createRequire } from "node:module";
import {
  buildOpenResponsesApp,
  createInMemoryPreviousResponseStore,
  createFakeAgent as createRootFakeAgent,
} from "../dist/index.js";
import { buildOpenResponsesApp as buildServerApp } from "../dist/server.js";
import { createFakeAgent as createTestingFakeAgent } from "../dist/testing.js";

const require = createRequire(import.meta.url);
const cjsRoot = require("../dist/index.cjs");
const cjsServer = require("../dist/server.cjs");
const cjsTesting = require("../dist/testing.cjs");

const assertExport = (value, label) => {
  if (typeof value !== "function") {
    throw new Error(`${label} export smoke check failed`);
  }
};

assertExport(buildOpenResponsesApp, "root ESM buildOpenResponsesApp");
assertExport(
  createInMemoryPreviousResponseStore,
  "root ESM createInMemoryPreviousResponseStore"
);
assertExport(createRootFakeAgent, "root ESM createFakeAgent");
assertExport(buildServerApp, "server ESM buildOpenResponsesApp");
assertExport(createTestingFakeAgent, "testing ESM createFakeAgent");
assertExport(cjsRoot.buildOpenResponsesApp, "root CJS buildOpenResponsesApp");
assertExport(
  cjsRoot.createInMemoryPreviousResponseStore,
  "root CJS createInMemoryPreviousResponseStore"
);
assertExport(cjsRoot.createFakeAgent, "root CJS createFakeAgent");
assertExport(
  cjsServer.buildOpenResponsesApp,
  "server CJS buildOpenResponsesApp"
);
assertExport(cjsTesting.createFakeAgent, "testing CJS createFakeAgent");

const app = await buildOpenResponsesApp({
  agent: createTestingFakeAgent(),
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
