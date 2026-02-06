import { describe, expect, mock, test } from "bun:test";
import {
	type ContentBlockMapper,
	defaultContentBlockMapper,
} from "../../../src/utils/contentBlockMapper";

describe("contentBlockMapper", () => {
	describe("defaultContentBlockMapper", () => {
		describe("toACP", () => {
			test("maps text content to ACP format", () => {
				const input = { type: "text", text: "Hello world" };
				const result = defaultContentBlockMapper.toACP(input);

				expect(result).toEqual({
					type: "text",
					text: "Hello world",
					_meta: null,
					annotations: null,
				});
			});

			test("maps image content to ACP format", () => {
				const input = {
					type: "image",
					data: "base64data",
					mimeType: "image/png",
				};
				const result = defaultContentBlockMapper.toACP(input);

				expect(result.type).toBe("image");
				expect(result.data).toBe("base64data");
				expect(result.mimeType).toBe("image/png");
			});

			test("maps audio content to ACP format", () => {
				const input = {
					type: "audio",
					data: "base64audio",
					mimeType: "audio/mp3",
				};
				const result = defaultContentBlockMapper.toACP(input);

				expect(result.type).toBe("audio");
				expect(result.data).toBe("base64audio");
				expect(result.mimeType).toBe("audio/mp3");
			});

			test("maps reasoning content to ACP text format with assistant audience", () => {
				const input = {
					type: "reasoning",
					reasoning: "Let me think about this step by step...",
					text: "Final response",
				};
				const result = defaultContentBlockMapper.toACP(input);

				// Reasoning is converted to text with assistant audience
				expect(result.type).toBe("text");
				expect(result.text).toBe("Let me think about this step by step...");
				expect(result._meta).toEqual({ _internal: true, reasoning: true });
				expect(result.annotations).toBeDefined();
				expect(result.annotations?.audience).toContain("assistant");
			});

			test("maps file content to ACP resource format", () => {
				const input = {
					type: "file",
					uri: "/path/to/file.txt",
					content: "file content here",
					mimeType: "text/plain",
				};
				const result = defaultContentBlockMapper.toACP(input);

				// File with content becomes embedded resource
				expect(result.type).toBe("resource");
				expect((result as any).resource.blob).toBe("file content here");
				expect((result as any).resource.mimeType).toBe("text/plain");
			});

			test("maps file link to ACP resource_link format", () => {
				const input = {
					type: "file",
					uri: "/path/to/file.txt",
					name: "myfile.txt",
					title: "My File",
				};
				const result = defaultContentBlockMapper.toACP(input);

				// File without content becomes resource link
				expect(result.type).toBe("resource_link");
				expect((result as any).uri).toBe("/path/to/file.txt");
				expect((result as any).name).toBe("myfile.txt");
				expect((result as any).title).toBe("My File");
			});

			test("handles unknown content types (converted to text)", () => {
				const input = {
					type: "resource_link",
					uri: "file:///project/src/index.ts",
				};
				const result = defaultContentBlockMapper.toACP(input);

				// resource_link is not a valid LangChain type, so it falls to default and outputs unsupported message
				expect(result.type).toBe("text");
				expect(result.text).toContain("resource_link");
			});

			test("handles resource content type (converted to text)", () => {
				const input = {
					type: "resource",
					resource: {
						type: "text",
						text: "file content",
					},
				};
				const result = defaultContentBlockMapper.toACP(input);

				// resource is not a valid LangChain type, so it falls to default
				expect(result.type).toBe("text");
				expect(result.text).toContain("resource");
			});

			test("preserves existing _meta and annotations", () => {
				const input = {
					type: "text",
					text: "test",
					_meta: { custom: "value" },
					annotations: { priority: "high" },
				};
				const result = defaultContentBlockMapper.toACP(input);

				expect(result._meta).toEqual({ custom: "value" });
				// mapAnnotations transforms to ACP format with additional fields
				expect(result.annotations).toBeDefined();
				expect(result.annotations?.priority).toBe("high");
			});

			test("handles unknown content types (converted to text)", () => {
				const input = { type: "unknown", customField: "value" };
				const result = defaultContentBlockMapper.toACP(input);

				// Unknown types are converted to text
				expect(result.type).toBe("text");
				expect(result.text).toContain("unknown");
			});
		});

		describe("fromACP", () => {
			test("maps ACP text content to internal format", () => {
				const input = {
					type: "text",
					text: "Hello from ACP",
					_meta: null,
					annotations: null,
				};
				const result = defaultContentBlockMapper.fromACP(input);

				expect(result.type).toBe("text");
				expect(result.text).toBe("Hello from ACP");
			});

			test("maps ACP image content to internal format", () => {
				const input = {
					type: "image",
					data: "imagedata",
					mimeType: "image/jpeg",
					_meta: null,
					annotations: null,
				};
				const result = defaultContentBlockMapper.fromACP(input);

				expect(result.type).toBe("image");
				expect(result.data).toBe("imagedata");
				expect(result.mimeType).toBe("image/jpeg");
			});

			test("maps ACP audio content to internal format", () => {
				const input = {
					type: "audio",
					data: "audiodata",
					mimeType: "audio/wav",
					_meta: null,
					annotations: null,
				};
				const result = defaultContentBlockMapper.fromACP(input);

				expect(result.type).toBe("audio");
				expect(result.data).toBe("audiodata");
				expect(result.mimeType).toBe("audio/wav");
			});

			test("maps ACP resource_link to internal file format", () => {
				const input = {
					type: "resource_link",
					uri: "https://example.com/file.ts",
					name: "example-file.ts",
					_meta: null,
					annotations: null,
					text: null,
					title: null,
				};
				const result = defaultContentBlockMapper.fromACP(input);

				// resource_link is converted to file type (LangChain internal format)
				expect(result.type).toBe("file");
				expect(result.uri).toBe("https://example.com/file.ts");
				expect(result.url).toBe("https://example.com/file.ts");
				expect(result.name).toBe("example-file.ts");
			});

			test("maps embedded resource to internal file format", () => {
				const input = {
					type: "resource",
					resource: { type: "blob", blob: "data" },
					_meta: null,
					annotations: null,
				};
				const result = defaultContentBlockMapper.fromACP(input);

				// resource is converted to file type (LangChain internal format)
				expect(result.type).toBe("file");
				expect(result.content).toBe("data");
			});

			test("handles null _meta and annotations", () => {
				const input = {
					type: "text",
					text: "test",
					_meta: null,
					annotations: null,
				};
				const result = defaultContentBlockMapper.fromACP(input);

				// When _meta and annotations are null in ACP, they become undefined in LangChain format
				expect(result._meta).toBeUndefined();
				expect(result.annotations).toBeUndefined();
			});
		});
	});

	describe("custom contentBlockMapper", () => {
		test("can provide custom mapper implementation", () => {
			const customMapper: ContentBlockMapper = {
				toACP: (block) => ({ ...block, transformed: true }),
				fromACP: (block) => ({ ...block, reverseTransformed: true }),
			};

			const input = { type: "text", text: "test" };

			expect(customMapper.toACP(input)).toEqual({
				type: "text",
				text: "test",
				transformed: true,
			});

			expect(customMapper.fromACP(input)).toEqual({
				type: "text",
				text: "test",
				reverseTransformed: true,
			});
		});

		test("handles transformation errors gracefully", () => {
			const faultyMapper: ContentBlockMapper = {
				toACP: () => {
					throw new Error("Transformation failed");
				},
				fromACP: () => {
					throw new Error("Reverse transformation failed");
				},
			};

			expect(() => faultyMapper.toACP({})).toThrow("Transformation failed");
			expect(() => faultyMapper.fromACP({})).toThrow(
				"Reverse transformation failed",
			);
		});
	});

	describe("edge cases", () => {
		test("handles empty text strings", () => {
			const result = defaultContentBlockMapper.toACP({
				type: "text",
				text: "",
			});
			expect(result.text).toBe("");
		});

		test("handles very long content", () => {
			const longText = "a".repeat(10000);
			const result = defaultContentBlockMapper.toACP({
				type: "text",
				text: longText,
			});
			expect(result.text).toBe(longText);
		});
	});
});
