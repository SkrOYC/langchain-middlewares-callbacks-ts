import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		callbacks: "src/callbacks.ts",
		middleware: "src/middleware.ts",
	},
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
		"@ag-ui/core",
		"@ag-ui/proto",
		"zod",
		"fast-json-patch",
	],
});
