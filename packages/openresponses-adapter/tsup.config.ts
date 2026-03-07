import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	splitting: false,
	sourcemap: true,
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
		"zod",
		"hono",
		"@hono/node-server",
	],
});
