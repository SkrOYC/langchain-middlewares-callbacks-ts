import { describe, expect, test } from "bun:test";
import { createAGUIAgent } from "../../src/createAGUIAgent";
import {
	createMockCallback,
	createSingleToolScenario,
	createTextModel,
	formatAgentInput,
	getEventTypes,
} from "../helpers/testUtils";

describe("createAGUIAgent option wiring", () => {
	test("callbackOptions are consumed by runtime callback handler", async () => {
		const callback = createMockCallback();
		const model = createTextModel(["Hello"]);

		const agent = createAGUIAgent({
			model,
			tools: [],
			onEvent: callback.emit,
			callbackOptions: {
				emitTextMessages: false,
			},
		});

		const eventStream = await (agent as any).streamEvents(
			formatAgentInput([{ role: "user", content: "Hi" }]),
			{
				version: "v2",
				context: { run_id: "callback-options-run" },
			},
		);
		for await (const _ of eventStream) {
			// consume stream
		}

		const eventTypes = getEventTypes(callback);
		expect(eventTypes).toContain("RUN_STARTED");
		expect(eventTypes).not.toContain("TEXT_MESSAGE_START");
		expect(eventTypes).not.toContain("TEXT_MESSAGE_CONTENT");
		expect(eventTypes).not.toContain("TEXT_MESSAGE_END");
	});

	test("middlewareOptions.emitToolResults=false suppresses TOOL_CALL_RESULT via compatibility mapping", async () => {
		const { callback, model, tools } = createSingleToolScenario();

		const agent = createAGUIAgent({
			model,
			tools,
			onEvent: callback.emit,
			middlewareOptions: { emitToolResults: false },
		});

		await agent.invoke(
			formatAgentInput([{ role: "user", content: "Calculate 5+3" }]),
			{
				context: { run_id: "legacy-tool-result-run" },
			},
		);

		const eventTypes = getEventTypes(callback);
		expect(eventTypes).toContain("TOOL_CALL_END");
		expect(eventTypes).not.toContain("TOOL_CALL_RESULT");
	});

	test("callbackOptions.emitToolResults takes precedence over middlewareOptions.emitToolResults", async () => {
		const { callback, model, tools } = createSingleToolScenario();

		const agent = createAGUIAgent({
			model,
			tools,
			onEvent: callback.emit,
			middlewareOptions: { emitToolResults: false },
			callbackOptions: { emitToolResults: true },
		});

		await agent.invoke(
			formatAgentInput([{ role: "user", content: "Calculate 5+3" }]),
			{
				context: { run_id: "callback-precedence-run" },
			},
		);

		const eventTypes = getEventTypes(callback);
		expect(eventTypes).toContain("TOOL_CALL_END");
		expect(eventTypes).toContain("TOOL_CALL_RESULT");
	});
});
