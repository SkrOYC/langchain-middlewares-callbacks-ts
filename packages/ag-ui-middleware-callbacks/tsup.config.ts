import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    adapter: "src/adapter.ts",
    backend: "src/backend.ts",
    index: "src/index.ts",
    callbacks: "src/callbacks.ts",
    middleware: "src/middleware.ts",
    publication: "src/publication.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: true,
  outExtension: ({ format }) => ({
    js: format === "esm" ? ".js" : ".cjs",
  }),
  external: [
    "langchain",
    "@langchain/core",
    "@langchain/langgraph",
    "@ag-ui/core",
    "@ag-ui/proto",
    "zod",
  ],
});
