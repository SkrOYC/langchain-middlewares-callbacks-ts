import { describe, expect, test } from "bun:test";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createAGUIMiddleware } from "../../../src/middleware/createAGUIMiddleware";
import { createMockCallback } from "../../fixtures/mockTransport";

describe("createAGUIMiddleware", () => {
	const mockCallback = createMockCallback();

	test("returns middleware object", () => {
		const middleware = createAGUIMiddleware({ onEvent: mockCallback.emit });

		expect(middleware).toBeDefined();
		expect(typeof middleware).toBe("object");
	});

	describe("beforeAgent", () => {
		test("emits RUN_STARTED and mapped MESSAGES_SNAPSHOT (Red Phase)", async () => {
			const middleware = createAGUIMiddleware({ onEvent: mockCallback.emit });

			const state = {
				messages: [new HumanMessage("Hello"), new AIMessage("Hi there!")],
			};
			const runtime = {
				config: {
					configurable: { thread_id: "thread-123", run_id: "run-123" },
				},
				context: { onEvent: mockCallback.emit },
			};

			const beforeAgent = middleware.beforeAgent as any;
			await beforeAgent(state, runtime);

			expect(mockCallback.emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "RUN_STARTED",
					threadId: "thread-123",
				}),
			);

			// Verify MESSAGES_SNAPSHOT uses mapped AG-UI messages
			expect(mockCallback.emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "MESSAGES_SNAPSHOT",
					messages: expect.arrayContaining([
						expect.objectContaining({ role: "user", content: "Hello" }),
						expect.objectContaining({
							role: "assistant",
							content: "Hi there!",
						}),
					]),
				}),
			);
		});

		test("applies stateMapper if provided", async () => {
			const stateMapper = (state: any) => ({
				curated: state.secret ? "hidden" : "visible",
			});
			const middleware = createAGUIMiddleware({
				onEvent: mockCallback.emit,
				stateMapper,
				emitStateSnapshots: "initial",
			});

			const state = { secret: "top-secret", other: "public" };
			const runtime = {
				config: { configurable: { run_id: "run-123" } },
				context: { onEvent: mockCallback.emit },
			};

			const beforeAgent = middleware.beforeAgent as any;
			await beforeAgent(state, runtime);

			expect(mockCallback.emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "STATE_SNAPSHOT",
					snapshot: { curated: "hidden" },
				}),
			);
		});

		test("filters 'messages' from STATE_SNAPSHOT by default (Red Phase)", async () => {
			const middleware = createAGUIMiddleware({ onEvent: mockCallback.emit });
			const state = {
				messages: [new HumanMessage("test")],
				app_data: "keep me",
			};
			const runtime = {
				config: { configurable: { run_id: "run-123" } },
				context: { onEvent: mockCallback.emit },
			};

			const beforeAgent = middleware.beforeAgent as any;
			await beforeAgent(state, runtime);

			const snapshotCall = mockCallback.emit.mock.calls.find(
				(call) => call[0].type === "STATE_SNAPSHOT",
			);
			expect(snapshotCall).toBeDefined();
			// This should FAIL currently because we haven't implemented filtering yet
			expect(snapshotCall![0].snapshot.messages).toBeUndefined();
		});
	});

	describe("Step/Activity Correlation (Red Phase)", () => {
		test("emits ACTIVITY_SNAPSHOT for configured steps", async () => {
			const middleware = createAGUIMiddleware({
				onEvent: mockCallback.emit,
				emitActivities: true,
			});

			const state = {};
			const runtime = {
				config: { configurable: { thread_id: "t1", run_id: "run-123" } },
				context: { onEvent: mockCallback.emit },
			};

			const beforeAgent = middleware.beforeAgent as any;
			await beforeAgent(state, runtime);

			const beforeModel = middleware.beforeModel as any;
			await beforeModel(state, runtime);

			expect(mockCallback.emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "ACTIVITY_SNAPSHOT",
					activityType: expect.any(String),
					messageId: expect.any(String),
				}),
			);
		});
	});

	describe("afterAgent", () => {
		test("applies resultMapper to RUN_FINISHED (Red Phase)", async () => {
			const resultMapper = (result: any) => ({
				status: "done",
				count: result.messages.length,
			});
			const middleware = createAGUIMiddleware({
				onEvent: mockCallback.emit,
				resultMapper,
			});

			const state = { messages: ["msg1", "msg2"] };
			const runtime = {
				config: { configurable: { thread_id: "t1", run_id: "run-123" } },
				context: { onEvent: mockCallback.emit },
			};

			const beforeAgent = middleware.beforeAgent as any;
			await beforeAgent(state, runtime);

			const afterAgent = middleware.afterAgent as any;
			await afterAgent(state, runtime);

			expect(mockCallback.emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "RUN_FINISHED",
					result: { status: "done", count: 2 },
				}),
			);
		});
	});
});
