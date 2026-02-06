import { describe, expect, mock, test } from "bun:test";
import { ACPCallbackHandler } from "../../src/callbacks/ACPCallbackHandler";
import { createACPSessionMiddleware } from "../../src/middleware/createACPSessionMiddleware";

// Mock connection factory for integration testing
function createMockACPConnection() {
	const sessionUpdate = mock(async (_params: any) => undefined);
	const close = mock(async () => undefined);

	return {
		sessionUpdate,
		close,
	};
}

describe("Full Session Lifecycle Integration", () => {
	describe("newSession → prompt → stream events flow", () => {
		test("complete session lifecycle with middleware and callbacks", async () => {
			const connection = createMockACPConnection();
			const lifecycleEvents: Array<{ type: string; data: any }> = [];

			// Create session middleware with lifecycle callbacks
			const sessionMiddleware = createACPSessionMiddleware({
				sessionIdExtractor: (config: any) => config.configurable?.thread_id,
				emitStateSnapshots: "all",
				onNewSession: mock((sessionId, state) => {
					lifecycleEvents.push({
						type: "newSession",
						data: { sessionId, state },
					});
				}),
				onPrompt: mock((sessionId, state) => {
					lifecycleEvents.push({ type: "prompt", data: { sessionId, state } });
				}),
			});

			// Create callback handler
			const callbackHandler = new ACPCallbackHandler({
				connection: connection as any,
			});

			// Simulate agent execution lifecycle
			const threadId = "integration-session-123";
			const initialState = { messages: [], context: {} };

			// beforeAgent hook (newSession)
			const beforeAgent = sessionMiddleware.beforeAgent as any;
			const agentResult = await beforeAgent(initialState, {
				config: { configurable: { thread_id: threadId } },
			});

			expect(agentResult.acp_sessionId).toBe(threadId);
			expect(lifecycleEvents).toContainEqual({
				type: "newSession",
				data: { sessionId: threadId, state: initialState },
			});

			// beforeModel hook (prompt)
			const beforeModel = sessionMiddleware.beforeModel as any;
			const modelState = {
				...initialState,
				messages: [{ role: "user", content: "Hello" }],
			};
			const modelResult = await beforeModel(modelState, {
				config: { configurable: { thread_id: threadId } },
			});

			expect(modelResult.acp_turnCount).toBe(1);
			expect(lifecycleEvents).toContainEqual({
				type: "prompt",
				data: { sessionId: threadId, state: modelState },
			});

			// Simulate LLM token streaming via callback
			await callbackHandler.handleLLMStart({} as any, [], "run-1");
			await callbackHandler.handleLLMNewToken("I ", {}, "run-1");
			await callbackHandler.handleLLMNewToken("can ", {}, "run-1");
			await callbackHandler.handleLLMNewToken("help ", {}, "run-1");
			await callbackHandler.handleLLMNewToken("you!", {}, "run-1");

			// afterModel hook
			const afterModel = sessionMiddleware.afterModel as any;
			await afterModel(modelState, {
				config: { configurable: { thread_id: threadId } },
			});

			// afterAgent hook (final state)
			const afterAgent = sessionMiddleware.afterAgent as any;
			const finalState = {
				...modelState,
				messages: [
					...modelState.messages,
					{ role: "assistant", content: "I can help you!" },
				],
			};
			const finalResult = await afterAgent(finalState, {
				config: { configurable: { thread_id: threadId } },
			});

			expect(finalResult.acp_shouldEmitSnapshot).toBe(true);
			expect(finalResult.acp_finalState).toBeDefined();

			// Verify callback events were sent
			expect(connection.sessionUpdate).toHaveBeenCalled();
		});

		test("session with tool call lifecycle", async () => {
			const connection = createMockACPConnection();

			const sessionMiddleware = createACPSessionMiddleware({
				emitStateSnapshots: "final",
			});

			const callbackHandler = new ACPCallbackHandler({
				connection: connection as any,
			});

			const threadId = "tool-session-456";

			// Execute middleware lifecycle
			const beforeAgent = sessionMiddleware.beforeAgent as any;
			await beforeAgent(
				{},
				{ config: { configurable: { thread_id: threadId } } },
			);

			const beforeModel = sessionMiddleware.beforeModel as any;
			await beforeModel(
				{},
				{ config: { configurable: { thread_id: threadId } } },
			);

			// Simulate tool execution
			await callbackHandler.handleToolStart(
				{ name: "readFile", description: "Read a file from disk" },
				"src/index.ts",
				"run-1",
			);
			await callbackHandler.handleToolEnd("file content here", "run-1");

			// Execute remaining lifecycle
			const afterModel = sessionMiddleware.afterModel as any;
			await afterModel(
				{},
				{ config: { configurable: { thread_id: threadId } } },
			);

			const afterAgent = sessionMiddleware.afterAgent as any;
			await afterAgent(
				{},
				{ config: { configurable: { thread_id: threadId } } },
			);

			// Verify tool events were sent
			expect(connection.sessionUpdate).toHaveBeenCalled();
		});

		test("error handling in full lifecycle", async () => {
			const connection = createMockACPConnection();

			const sessionMiddleware = createACPSessionMiddleware({
				emitStateSnapshots: "final",
				onPrompt: mock(() => {
					throw new Error("Prompt processing error");
				}),
			});

			const callbackHandler = new ACPCallbackHandler({
				connection: connection as any,
			});

			const threadId = "error-session-789";

			// Execute beforeAgent (should succeed)
			const beforeAgent = sessionMiddleware.beforeAgent as any;
			const agentResult = await beforeAgent(
				{},
				{
					config: { configurable: { thread_id: threadId } },
				},
			);

			expect(agentResult.acp_sessionId).toBe(threadId);

			// Execute beforeModel (should handle callback error gracefully)
			const beforeModel = sessionMiddleware.beforeModel as any;
			const modelResult = await beforeModel(
				{},
				{
					config: { configurable: { thread_id: threadId } },
				},
			);

			expect(modelResult.acp_turnCount).toBe(1);

			// Simulate error in callback
			await callbackHandler.handleLLMStart({} as any, [], "run-1");
			await callbackHandler.handleLLMError(new Error("Model failed"), "run-1");

			// Verify error was sent
			expect(connection.sessionUpdate).toHaveBeenCalled();
		});

		test("multiple turns in single session", async () => {
			const connection = createMockACPConnection();

			const sessionMiddleware = createACPSessionMiddleware({
				emitStateSnapshots: "final",
			});

			const callbackHandler = new ACPCallbackHandler({
				connection: connection as any,
			});

			const threadId = "multi-turn-session";
			const beforeAgent = sessionMiddleware.beforeAgent as any;
			await beforeAgent(
				{},
				{ config: { configurable: { thread_id: threadId } } },
			);

			// Turn 1
			const beforeModel1 = sessionMiddleware.beforeModel as any;
			await beforeModel1(
				{},
				{ config: { configurable: { thread_id: threadId } } },
			);

			await callbackHandler.handleLLMStart({} as any, [], "run-1");
			await callbackHandler.handleLLMNewToken("Response 1", {}, "run-1");
			await callbackHandler.handleLLMEnd({} as any, "run-1");

			const afterModel1 = sessionMiddleware.afterModel as any;
			const result1 = await afterModel1(
				{},
				{ config: { configurable: { thread_id: threadId } } },
			);
			expect(result1.acp_turnCount).toBe(1);

			// Turn 2
			const beforeModel2 = sessionMiddleware.beforeModel as any;
			await beforeModel2(
				{},
				{ config: { configurable: { thread_id: threadId } } },
			);

			await callbackHandler.handleLLMStart({} as any, [], "run-2");
			await callbackHandler.handleLLMNewToken("Response 2", {}, "run-2");
			await callbackHandler.handleLLMEnd({} as any, "run-2");

			const afterModel2 = sessionMiddleware.afterModel as any;
			const result2 = await afterModel2(
				{},
				{ config: { configurable: { thread_id: threadId } } },
			);
			expect(result2.acp_turnCount).toBe(2);

			// Verify all LLM events were sent
			expect(connection.sessionUpdate).toHaveBeenCalled();
		});
	});

	describe("state snapshot modes", () => {
		test("initial snapshot mode emits only at start", async () => {
			const connection = createMockACPConnection();

			const sessionMiddleware = createACPSessionMiddleware({
				emitStateSnapshots: "initial",
			});

			const threadId = "initial-snapshot-session";
			const beforeAgent = sessionMiddleware.beforeAgent as any;
			const agentResult = await beforeAgent(
				{ value: "initial" },
				{
					config: { configurable: { thread_id: threadId } },
				},
			);

			expect(agentResult.acp_shouldEmitSnapshot).toBe(true);

			const beforeModel = sessionMiddleware.beforeModel as any;
			const modelResult = await beforeModel(
				{ value: "model" },
				{
					config: { configurable: { thread_id: threadId } },
				},
			);

			// Should not emit in beforeModel for initial mode
			expect(modelResult.acp_shouldEmitSnapshot).toBeFalsy();
		});

		test("final snapshot mode emits only at end", async () => {
			const connection = createMockACPConnection();

			const sessionMiddleware = createACPSessionMiddleware({
				emitStateSnapshots: "final",
			});

			const threadId = "final-snapshot-session";
			const beforeAgent = sessionMiddleware.beforeAgent as any;
			const agentResult = await beforeAgent(
				{ value: "initial" },
				{
					config: { configurable: { thread_id: threadId } },
				},
			);

			expect(agentResult.acp_shouldEmitSnapshot).toBeFalsy();

			const afterAgent = sessionMiddleware.afterAgent as any;
			const finalResult = await afterAgent(
				{ value: "final" },
				{
					config: { configurable: { thread_id: threadId } },
				},
			);

			expect(finalResult.acp_shouldEmitSnapshot).toBe(true);
			expect(finalResult.acp_finalState).toEqual({ value: "final" });
		});
	});

	describe("concurrent sessions", () => {
		test("handles multiple concurrent session lifecycles", async () => {
			const connection1 = createMockACPConnection();
			const connection2 = createMockACPConnection();

			const sessionMiddleware1 = createACPSessionMiddleware();
			const sessionMiddleware2 = createACPSessionMiddleware();

			const callbackHandler1 = new ACPCallbackHandler({
				connection: connection1 as any,
			});
			const callbackHandler2 = new ACPCallbackHandler({
				connection: connection2 as any,
			});

			// Session 1
			const beforeAgent1 = sessionMiddleware1.beforeAgent as any;
			await beforeAgent1(
				{},
				{ config: { configurable: { thread_id: "session-1" } } },
			);

			const beforeModel1 = sessionMiddleware1.beforeModel as any;
			await beforeModel1(
				{},
				{ config: { configurable: { thread_id: "session-1" } } },
			);

			await callbackHandler1.handleLLMStart({} as any, [], "run-1");
			await callbackHandler1.handleLLMNewToken(
				"Session 1 response",
				{},
				"run-1",
			);
			await callbackHandler1.handleLLMEnd({} as any, "run-1");

			// Session 2 (concurrent)
			const beforeAgent2 = sessionMiddleware2.beforeAgent as any;
			await beforeAgent2(
				{},
				{ config: { configurable: { thread_id: "session-2" } } },
			);

			const beforeModel2 = sessionMiddleware2.beforeModel as any;
			await beforeModel2(
				{},
				{ config: { configurable: { thread_id: "session-2" } } },
			);

			await callbackHandler2.handleLLMStart({} as any, [], "run-2");
			await callbackHandler2.handleLLMNewToken(
				"Session 2 response",
				{},
				"run-2",
			);
			await callbackHandler2.handleLLMEnd({} as any, "run-2");

			// Verify sessions are independent
			expect(connection1.sessionUpdate).toHaveBeenCalled();
			expect(connection2.sessionUpdate).toHaveBeenCalled();
		});
	});
});
