import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
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
		"@agentclientprotocol/sdk",
		"zod",
	],
});
