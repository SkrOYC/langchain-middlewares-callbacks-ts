import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/algorithms/memory-actions.ts",
    "src/algorithms/memory-extraction.ts",
    "src/algorithms/memory-update.ts",
    "src/algorithms/similarity-search.ts",
    "src/middleware/hooks/after-agent.ts",
    "src/middleware/prompts/extract-speaker1.ts",
    "src/middleware/prompts/extract-speaker2.ts",
    "src/middleware/prompts/format-memories.ts",
    "src/middleware/prompts/generate-with-citations.ts",
    "src/middleware/prompts/update-memory.ts",
    "src/schemas/index.ts",
    "src/storage/metadata-storage.ts",
    "src/storage/weight-storage.ts",
    "src/utils/citation-extractor.ts",
    "src/utils/matrix.ts",
    "src/utils/similarity.ts",
  ],
  format: ["esm"],
  dts: {
    resolve: true,
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: true,
  outDir: "dist",
  outExtension: () => ({ js: ".js" }),
  external: ["langchain", "@langchain/core", "@langchain/langgraph", "zod"],
});
