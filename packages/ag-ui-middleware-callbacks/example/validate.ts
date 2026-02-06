#!/usr/bin/env bun

/**
 * AG-UI Middleware Validation CLI
 *
 * Compares raw createAgent() vs AG-UI middleware implementation
 *
 * Usage:
 *   bun run ./validate.ts middleware "Your prompt here"    # Use AG-UI middleware
 *   bun run ./validate.ts raw "Your prompt here"           # Use raw createAgent
 *   bun run ./validate.ts compare "Your prompt here"       # Compare both (middleware first, then raw)
 *   bun run ./validate.ts --help                           # Show help
 *
 * Purpose: Study LangChain/LangGraph event handling and ID alignment
 */

import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import {
	AGUICallbackHandler,
	type BaseEvent,
	createAGUIAgent,
} from "../src/index";

// ============================================================================
// Calculator Tool (from demo.tsx)
// ============================================================================

const calculatorTool = tool(
	async ({ a, b, operation }: { a: number; b: number; operation: string }) => {
		let result: number;
		switch (operation) {
			case "add":
				result = a + b;
				break;
			case "subtract":
				result = a - b;
				break;
			case "multiply":
				result = a * b;
				break;
			case "divide":
				result = a / b;
				break;
			default:
				return `Unknown operation: ${operation}`;
		}
		return `Result: ${result}`;
	},
	{
		name: "calculator",
		description: "Perform arithmetic",
		schema: {
			type: "object",
			properties: {
				a: { type: "number" },
				b: { type: "number" },
				operation: {
					type: "string",
					enum: ["add", "subtract", "multiply", "divide"],
				},
			},
			required: ["a", "b", "operation"],
		},
	},
);

// ============================================================================
// Validation Observer: Separates validation concerns from event emission
// ============================================================================

interface ValidationResult {
	passed: boolean;
	toolCalls: Array<{
		toolCallId: string;
		hasStart: boolean;
		hasEnd: boolean;
		hasResult: boolean;
		consistent: boolean;
	}>;
	inconsistencies: string[];
}

class ValidationObserver {
	private toolCallEvents: Map<
		string,
		{ start?: BaseEvent; end?: BaseEvent; result?: BaseEvent }
	> = new Map();
	private allEvents: BaseEvent[] = [];

	/**
	 * Track an event for validation
	 */
	track(event: BaseEvent): void {
		this.allEvents.push(event);

		if ("toolCallId" in event && event.toolCallId) {
			const existing = this.toolCallEvents.get(event.toolCallId) || {};
			if (event.type === "TOOL_CALL_START") {
				existing.start = event;
			} else if (event.type === "TOOL_CALL_END") {
				existing.end = event;
			} else if (event.type === "TOOL_CALL_RESULT") {
				existing.result = event;
			}
			this.toolCallEvents.set(event.toolCallId, existing);
		}
	}

	/**
	 * Validate toolCallId consistency across all tracked events
	 */
	validate(): ValidationResult {
		const results: ValidationResult = {
			passed: true,
			toolCalls: [],
			inconsistencies: [],
		};

		for (const [toolCallId, events] of this.toolCallEvents) {
			const { start, end, result } = events;

			const toolCallResult = {
				toolCallId,
				hasStart: !!start,
				hasEnd: !!end,
				hasResult: !!result,
				consistent: true,
			};

			// Check consistency: all events should use the same toolCallId as START
			if (start && end && start.toolCallId !== end.toolCallId) {
				toolCallResult.consistent = false;
				results.inconsistencies.push(
					`toolCallId mismatch for ${toolCallId}: START=${start.toolCallId}, END=${end.toolCallId}`,
				);
			}

			if (start && result && start.toolCallId !== result.toolCallId) {
				toolCallResult.consistent = false;
				results.inconsistencies.push(
					`toolCallId mismatch for ${toolCallId}: START=${start.toolCallId}, RESULT=${result.toolCallId}`,
				);
			}

			results.toolCalls.push(toolCallResult);

			if (!toolCallResult.consistent) {
				results.passed = false;
			}
		}

		return results;
	}

	/**
	 * Get summary statistics for reporting
	 */
	getSummary(): {
		totalEvents: number;
		toolCallGroups: number;
		eventTypes: Map<string, number>;
	} {
		const eventTypes = new Map<string, number>();
		for (const event of this.allEvents) {
			eventTypes.set(event.type, (eventTypes.get(event.type) || 0) + 1);
		}

		return {
			totalEvents: this.allEvents.length,
			toolCallGroups: this.toolCallEvents.size,
			eventTypes,
		};
	}

	/**
	 * Reset the observer for a new validation run
	 */
	reset(): void {
		this.toolCallEvents.clear();
		this.allEvents = [];
	}
}

// ============================================================================
// Transport: Write events to stdout (SSE-like format)
// ============================================================================

const validationObserver = new ValidationObserver();

const onEvent = (event: BaseEvent) => {
	// Track for validation (separate concern)
	validationObserver.track(event);

	// Write in SSE format: "data: {JSON}\n\n"
	process.stdout.write(`data: ${JSON.stringify(event)}\n\n`);
};

// ============================================================================
// Raw createAgent() - for comparison
// ============================================================================

async function runRawAgent(input: string) {
	console.error("=== RUNNING RAW createAgent() ===");
	console.error("=== No AG-UI middleware, just native callbacks ===\n");

	const model = new ChatOpenAI({
		model: "big-pickle",
		streaming: true,
		configuration: {
			baseURL: "https://opencode.ai/zen/v1",
			apiKey: "",
		},
	});

	// Create raw agent without middleware
	const agent = createAgent({
		model,
		tools: [calculatorTool],
	});

	// Use built-in streaming with event capture
	try {
		const eventStream = await (agent as any).streamEvents(
			{ messages: [{ role: "user", content: input }] },
			{ version: "v2" },
		);

		let eventCount = 0;
		for await (const event of eventStream) {
			eventCount++;
			// Output native LangChain/LangGraph events
			process.stdout.write(
				`data: ${JSON.stringify({
					_source: "native",
					_event: event.event,
					...event.data,
				})}\n\n`,
			);
		}
		console.error(`\n=== RAW AGENT: ${eventCount} events captured ===\n`);
	} catch (error) {
		console.error("Error during raw execution:", error);
		process.exit(1);
	}
}

// ============================================================================
// AG-UI Middleware Agent
// ============================================================================

async function runMiddlewareAgent(input: string) {
	console.error("=== RUNNING AG-UI MIDDLEWARE AGENT ===\n");

	// Reset validation observer for new run
	validationObserver.reset();

	const model = new ChatOpenAI({
		model: "big-pickle",
		streaming: true,
		configuration: {
			baseURL: "https://opencode.ai/zen/v1",
			apiKey: "",
		},
	});

	// Create agent with middleware
	const agent = createAGUIAgent({
		model,
		tools: [calculatorTool],
		onEvent,
	});

	// Create callback handler for streaming events
	const callbacks = new AGUICallbackHandler({ onEvent });

	try {
		const eventStream = await (agent as any).streamEvents(
			{ messages: [{ role: "user", content: input }] },
			{ version: "v2", callbacks: [callbacks] },
		);

		let eventCount = 0;
		for await (const _ of eventStream) {
			eventCount++;
		}
		console.error(
			`\n=== MIDDLEWARE AGENT: ${eventCount} stream iterations ===\n`,
		);

		// Validate toolCallId consistency using ValidationObserver
		console.error("\n=== VALIDATION SUMMARY ===\n");

		const summary = validationObserver.getSummary();
		console.error(`Total events captured: ${summary.totalEvents}`);

		console.error("Events by type:");
		for (const [type, count] of summary.eventTypes) {
			console.error(`  - ${type}: ${count}`);
		}
		console.error("");

		console.error(`Tool call groups: ${summary.toolCallGroups}`);
		console.error("");

		const result = validationObserver.validate();

		for (const tc of result.toolCalls) {
			if (tc.consistent) {
				if (tc.hasStart && tc.hasEnd && tc.hasResult) {
					console.error(
						`✅ ${tc.toolCallId}: START → END → RESULT (consistent)`,
					);
				} else if (tc.hasStart && tc.hasEnd) {
					console.error(`✅ ${tc.toolCallId}: START → END (consistent)`);
				} else {
					console.error(`⚠️  ${tc.toolCallId}: START only (no END/RESULT yet)`);
				}
			}
		}

		if (result.passed && result.toolCalls.length > 0) {
			console.error(
				"\n✅ VALIDATION PASSED: All tool calls have consistent toolCallId\n",
			);
		} else if (!result.passed) {
			console.error(
				"\n❌ VALIDATION FAILED: toolCallId inconsistencies detected\n",
			);
			for (const issue of result.inconsistencies) {
				console.error(`  - ${issue}`);
			}
			console.error("");
		} else {
			console.error("⚠️  No tool calls detected in this run\n");
		}
	} catch (error) {
		console.error("Error during middleware execution:", error);
		process.exit(1);
	}
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
	const mode = process.argv[2];
	const input = process.argv[3];

	if (!input || mode === "--help" || mode === "-h") {
		console.log(`
AG-UI Middleware Validation CLI

Usage:
  bun run ./validate.ts middleware "Your prompt here"    # Use AG-UI middleware with validation
  bun run ./validate.ts raw "Your prompt here"           # Use raw createAgent
  bun run ./validate.ts compare "Your prompt here"       # Compare both approaches

Examples:
  bun run ./validate.ts middleware "Calculate 2+2"
  bun run ./validate.ts raw "Calculate 2+2"
  bun run ./validate.ts compare "What is 5 * 3 and divide 10 by 2"

Purpose:
  Compare raw LangChain/LangGraph events vs AG-UI middleware output
  to study ID alignment and event handling patterns.

Validation:
  Middleware mode automatically validates that TOOL_CALL_START, TOOL_CALL_END,
  and TOOL_CALL_RESULT events all share the same toolCallId (AG-UI protocol compliance).

Comparison Notes:
  - Raw mode shows native LangChain callback events
  - Middleware mode shows AG-UI protocol events with ID consistency validation
  - Compare event structures, IDs, and timing
`);
		process.exit(mode === "--help" || mode === "-h" ? 0 : 1);
	}

	switch (mode) {
		case "middleware":
			await runMiddlewareAgent(input);
			break;
		case "raw":
			await runRawAgent(input);
			break;
		case "compare":
			console.error("\n" + "=".repeat(60));
			console.error("COMPARISON MODE: Running middleware first, then raw");
			console.error("=".repeat(60) + "\n");

			await runMiddlewareAgent(input);

			console.error("\n" + "=".repeat(60));
			console.error("SWITCHING TO RAW AGENT");
			console.error("=".repeat(60) + "\n");

			await runRawAgent(input);
			break;
		default:
			console.error(`Unknown mode: ${mode}`);
			console.error("Use --help for usage information");
			process.exit(1);
	}
}

main();
