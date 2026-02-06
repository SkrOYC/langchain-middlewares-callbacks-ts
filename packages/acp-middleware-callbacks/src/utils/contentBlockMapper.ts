/**
 * Content Block Mapper
 *
 * Converts between LangChain content blocks and ACP content blocks.
 * This enables seamless interoperability between LangChain agents and
 * ACP-compatible clients.
 *
 * @packageDocumentation
 */

import type {
	Annotations,
	AudioContent,
	ContentBlock,
	EmbeddedResource,
	ImageContent,
	ResourceLink,
	Role,
	TextContent,
} from "@agentclientprotocol/sdk";

/**
 * Interface for mapping content blocks between LangChain and ACP formats.
 *
 * Implementations of this interface handle the conversion of content
 * from LangChain's internal format to the ACP protocol format and vice versa.
 */
export interface ContentBlockMapper {
	/**
	 * Converts a LangChain content block to ACP format.
	 *
	 * @param block - The LangChain content block to convert
	 * @returns The equivalent ACP content block
	 */
	toACP(block: LangChainContentBlock): ContentBlock;

	/**
	 * Converts an ACP content block to LangChain format.
	 *
	 * @param block - The ACP content block to convert
	 * @returns The equivalent LangChain content block
	 */
	fromACP(block: ContentBlock): LangChainContentBlock;
}

/**
 * LangChain content block representation.
 *
 * This represents the content blocks used internally by LangChain,
 * which may differ slightly from the ACP protocol format.
 */
export interface LangChainContentBlock {
	/**
	 * The type of content block.
	 */
	type: "text" | "image" | "audio" | "file" | "reasoning";

	/**
	 * The text content (for text and reasoning types).
	 */
	text?: string;

	/**
	 * The reasoning content (for reasoning type).
	 */
	reasoning?: string;

	/**
	 * Base64-encoded data (for image and audio types).
	 */
	data?: string;

	/**
	 * URL or URI for the content (for image and file types).
	 */
	url?: string;

	/**
	 * MIME type of the content (for image, audio, and file types).
	 */
	mimeType?: string;

	/**
	 * File content (for file type with embedded content).
	 */
	content?: string;

	/**
	 * File URI (for file type).
	 */
	uri?: string;

	/**
	 * File name (for file type).
	 */
	name?: string;

	/**
	 * File title (for file type).
	 */
	title?: string;

	/**
	 * File description (for file type).
	 */
	description?: string;

	/**
	 * File size in bytes (for file type).
	 */
	size?: number;

	/**
	 * Annotations for the content block.
	 */
	annotations?: Record<string, unknown>;

	/**
	 * Metadata for the content block.
	 */
	_meta?: Record<string, unknown>;
}

/**
 * Default implementation of ContentBlockMapper.
 *
 * This implementation handles all standard content types and provides
 * proper conversion between LangChain and ACP formats.
 */
export class DefaultContentBlockMapper implements ContentBlockMapper {
	/**
	 * Converts a LangChain content block to ACP format.
	 *
	 * @param block - The LangChain content block to convert
	 * @returns The equivalent ACP content block
	 */
	toACP(block: LangChainContentBlock): ContentBlock {
		switch (block.type) {
			case "text":
				return this.textToACP(block);
			case "reasoning":
				return this.reasoningToACP(block);
			case "image":
				return this.imageToACP(block);
			case "audio":
				return this.audioToACP(block);
			case "file":
				return this.fileToACP(block);
			default: {
				// Fallback for unknown types - convert to text representation
				// This ensures the function always returns a valid ContentBlock
				const typeName =
					typeof block === "object" && block !== null
						? (block as unknown as Record<string, unknown>).type || "unknown"
						: typeof block;
				return {
					type: "text",
					_meta: null,
					annotations: null,
					text: `[Unsupported content type: ${String(typeName)}]`,
				};
			}
		}
	}

	/**
	 * Converts an ACP content block to LangChain format.
	 *
	 * @param block - The ACP content block to convert
	 * @returns The equivalent LangChain content block
	 */
	fromACP(block: ContentBlock): LangChainContentBlock {
		switch (block.type) {
			case "text":
				return this.textFromACP(block);
			case "image":
				return this.imageFromACP(block);
			case "audio":
				return this.audioFromACP(block);
			case "resource_link":
				return this.resourceLinkFromACP(block);
			case "resource":
				return this.embeddedResourceFromACP(block);
			default:
				// Fallback for unknown ACP types - convert to LangChain text format
				return {
					type: "text",
					text: String(block),
				};
		}
	}

	/**
	 * Converts a text content block.
	 */
	private textToACP(block: LangChainContentBlock): ContentBlock {
		const result: TextContent & { type: "text" } = {
			type: "text",
			_meta: block._meta || null,
			annotations: this.mapAnnotations(block.annotations) ?? null,
			text: block.text || "",
		};
		return result;
	}

	/**
	 * Converts a reasoning content block to text with assistant audience.
	 */
	private reasoningToACP(block: LangChainContentBlock): ContentBlock {
		const result: TextContent & { type: "text" } = {
			type: "text",
			_meta: { _internal: true, reasoning: true },
			annotations: {
				_meta: null,
				audience: ["assistant"] as Array<Role>,
				lastModified: null,
				priority: (block.annotations?.priority as number) ?? null,
			},
			text: block.reasoning || block.text || "",
		};
		return result;
	}

	/**
	 * Converts an image content block.
	 */
	private imageToACP(block: LangChainContentBlock): ContentBlock {
		const result: ImageContent & { type: "image" } = {
			type: "image",
			_meta: block._meta || null,
			annotations: this.mapAnnotations(block.annotations) ?? null,
			data: block.data || "",
			mimeType: block.mimeType || "image/png",
			uri: (block.url || null) as string | null,
		};
		return result;
	}

	/**
	 * Converts an audio content block.
	 */
	private audioToACP(block: LangChainContentBlock): ContentBlock {
		const result: AudioContent & { type: "audio" } = {
			type: "audio",
			_meta: block._meta || null,
			annotations: this.mapAnnotations(block.annotations) ?? null,
			data: block.data || "",
			mimeType: block.mimeType || "audio/wav",
		};
		return result;
	}

	/**
	 * Converts a file content block to either resource link or embedded resource.
	 */
	private fileToACP(block: LangChainContentBlock): ContentBlock {
		if (block.content) {
			const result: EmbeddedResource & { type: "resource" } = {
				type: "resource",
				_meta: block._meta || null,
				annotations: this.mapAnnotations(block.annotations) ?? null,
				resource: {
					uri: block.uri || block.url || "",
					mimeType: block.mimeType || "application/octet-stream",
					blob: block.content,
				},
			};
			return result;
		} else {
			const result: ResourceLink & { type: "resource_link" } = {
				type: "resource_link",
				_meta: block._meta || null,
				annotations: this.mapAnnotations(block.annotations) ?? null,
				description: (block.description || null) as string | null,
				mimeType: (block.mimeType || null) as string | null,
				name: block.name || "file",
				size: block.size ? BigInt(block.size) : null,
				title: (block.title || null) as string | null,
				uri: block.uri || block.url || "",
			};
			return result;
		}
	}

	/**
	 * Converts a text content block from ACP format.
	 */
	private textFromACP(
		block: TextContent & { type: "text" },
	): LangChainContentBlock {
		const isReasoning = block.annotations?.audience?.includes("assistant");
		return {
			type: isReasoning ? "reasoning" : "text",
			text: block.text,
			reasoning: isReasoning ? block.text : undefined,
			annotations: this.unmapAnnotations(block.annotations),
			_meta: block._meta || undefined,
		};
	}

	/**
	 * Converts an image content block from ACP format.
	 */
	private imageFromACP(
		block: ImageContent & { type: "image" },
	): LangChainContentBlock {
		return {
			type: "image",
			data: block.data,
			url: block.uri || undefined,
			mimeType: block.mimeType,
			annotations: this.unmapAnnotations(block.annotations),
			_meta: block._meta || undefined,
		};
	}

	/**
	 * Converts an audio content block from ACP format.
	 */
	private audioFromACP(
		block: AudioContent & { type: "audio" },
	): LangChainContentBlock {
		return {
			type: "audio",
			data: block.data,
			mimeType: block.mimeType,
			annotations: this.unmapAnnotations(block.annotations),
			_meta: block._meta || undefined,
		};
	}

	/**
	 * Converts a resource link from ACP format.
	 */
	private resourceLinkFromACP(
		block: ResourceLink & { type: "resource_link" },
	): LangChainContentBlock {
		return {
			type: "file",
			uri: block.uri,
			url: block.uri,
			name: block.name,
			title: block.title || undefined,
			description: block.description || undefined,
			mimeType: block.mimeType || undefined,
			size: block.size ? Number(block.size) : undefined,
			annotations: this.unmapAnnotations(block.annotations),
			_meta: block._meta || undefined,
		};
	}

	/**
	 * Converts an embedded resource from ACP format.
	 */
	private embeddedResourceFromACP(
		block: EmbeddedResource & { type: "resource" },
	): LangChainContentBlock {
		const resource = block.resource;
		return {
			type: "file",
			uri: resource.uri,
			url: resource.uri,
			mimeType: resource.mimeType ?? undefined,
			content: "text" in resource ? resource.text : resource.blob,
			annotations: this.unmapAnnotations(block.annotations),
			_meta: block._meta || undefined,
		};
	}

	/**
	 * Maps LangChain annotations to ACP annotations format.
	 */
	private mapAnnotations(
		langChainAnnotations?: Record<string, unknown>,
	): Annotations | null | undefined {
		if (!langChainAnnotations) return null;
		return {
			_meta: null,
			audience: (langChainAnnotations.audience as Array<Role>) ?? null,
			lastModified: (langChainAnnotations.lastModified as string) ?? null,
			priority: (langChainAnnotations.priority as number) ?? null,
		};
	}

	/**
	 * Maps ACP annotations back to LangChain format.
	 */
	private unmapAnnotations(
		annotations: Annotations | null | undefined,
	): Record<string, unknown> | undefined {
		if (!annotations) return undefined;
		const result: Record<string, unknown> = {};
		if (annotations.audience) {
			result.audience = annotations.audience;
		}
		if (annotations.lastModified) {
			result.lastModified = annotations.lastModified;
		}
		if (annotations.priority !== null) {
			result.priority = annotations.priority;
		}
		return Object.keys(result).length > 0 ? result : undefined;
	}
}

/**
 * Default instance of ContentBlockMapper for convenience.
 */
export const defaultContentBlockMapper = new DefaultContentBlockMapper();
