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
				context: { thread_id: "thread-123", run_id: "run-123" },
			};

			const beforeAgent = middleware.beforeAgent as any;
			await beforeAgent(state, runtime);

			expect(mockCallback.emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "RUN_STARTED",
					threadId: "thread-123",
					runId: "run-123",
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
				context: { run_id: "run-123" },
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
				context: { run_id: "run-123" },
			};

			const beforeAgent = middleware.beforeAgent as any;
			await beforeAgent(state, runtime);

			const snapshotCall = mockCallback.emit.mock.calls.find(
				(call) => call[0].type === "STATE_SNAPSHOT",
			);
			expect(snapshotCall).toBeDefined();
			expect(snapshotCall![0].snapshot.messages).toBeUndefined();
		});

		test("preserves AG-UI structured user content in MESSAGES_SNAPSHOT", async () => {
			const callback = createMockCallback();
			const middleware = createAGUIMiddleware({ onEvent: callback.emit });
			const state = {
				messages: [
					new HumanMessage({
						content: [
							{ type: "text", text: "hello" },
							{
								type: "binary",
								mimeType: "image/png",
								url: "https://example.com/image.png",
							},
						] as any,
					}),
				],
			};
			const runtime = {
				context: { run_id: "run-123" },
			};

			const beforeAgent = middleware.beforeAgent as any;
			await beforeAgent(state, runtime);

			const snapshotCall = callback.events.find(
				(event) => event.type === "MESSAGES_SNAPSHOT",
			);
			expect(snapshotCall).toBeDefined();
			expect(snapshotCall!.messages).toEqual([
				expect.objectContaining({
					role: "user",
					content: [
						{ type: "text", text: "hello" },
						{
							type: "binary",
							mimeType: "image/png",
							url: "https://example.com/image.png",
						},
					],
				}),
			]);
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
				context: { thread_id: "t1", run_id: "run-123" },
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

	describe("emitStateSnapshots mode semantics", () => {
		const runtime = {
			context: { thread_id: "thread-123", run_id: "run-123" },
			config: { input: { messages: [] } },
		};
		const getSnapshotIndexes = (events: any[]) =>
			events
				.map((event, index) => (event.type === "STATE_SNAPSHOT" ? index : -1))
				.filter((index) => index !== -1);

		const runLifecycle = async (mode: "initial" | "final" | "all" | "none") => {
			const callback = createMockCallback();
			const middleware = createAGUIMiddleware({
				onEvent: callback.emit,
				emitStateSnapshots: mode,
			});
			const state = { messages: [new HumanMessage("Hello")], custom: "value" };

			const beforeAgent = middleware.beforeAgent as any;
			const beforeModel = middleware.beforeModel as any;
			const afterModel = middleware.afterModel as any;
			const afterAgent = middleware.afterAgent as any;

			await beforeAgent(state, runtime);
			await beforeModel(state, runtime);
			await afterModel(state, runtime);
			await afterAgent(state, runtime);

			return callback.events;
		};

		test("initial emits exactly one STATE_SNAPSHOT at run start", async () => {
			const events = await runLifecycle("initial");
			const snapshotIndexes = getSnapshotIndexes(events);

			expect(snapshotIndexes).toHaveLength(1);
			expect(snapshotIndexes[0]).toBe(
				events.findIndex((event) => event.type === "RUN_STARTED") + 1,
			);
		});

		test("final emits exactly one STATE_SNAPSHOT at run end", async () => {
			const events = await runLifecycle("final");
			const snapshotIndexes = getSnapshotIndexes(events);
			const runFinishedIndex = events.findIndex(
				(event) => event.type === "RUN_FINISHED",
			);

			expect(snapshotIndexes).toHaveLength(1);
			expect(snapshotIndexes[0]).toBe(runFinishedIndex - 1);
		});

		test("all emits exactly two STATE_SNAPSHOT events (start and end)", async () => {
			const events = await runLifecycle("all");
			const snapshotIndexes = getSnapshotIndexes(events);
			const runStartedIndex = events.findIndex((event) => event.type === "RUN_STARTED");
			const runFinishedIndex = events.findIndex(
				(event) => event.type === "RUN_FINISHED",
			);

			expect(snapshotIndexes).toHaveLength(2);
			expect(snapshotIndexes[0]).toBe(runStartedIndex + 1);
			expect(snapshotIndexes[1]).toBe(runFinishedIndex - 1);
		});

		test("none emits zero STATE_SNAPSHOT events", async () => {
			const events = await runLifecycle("none");
			const snapshotEvents = events.filter(
				(event) => event.type === "STATE_SNAPSHOT",
			);

			expect(snapshotEvents).toHaveLength(0);
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
				context: { thread_id: "t1", run_id: "run-123" },
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

	describe("ID resolution", () => {
		test("uses context IDs before explicit overrides", async () => {
			const callback = createMockCallback();
			const middleware = createAGUIMiddleware({
				onEvent: callback.emit,
				threadIdOverride: "override-thread",
				runIdOverride: "override-run",
			});

			const state = {};
			const runtime = {
				context: { thread_id: "context-thread", run_id: "context-run" },
			};

			const beforeAgent = middleware.beforeAgent as any;
			const afterAgent = middleware.afterAgent as any;
			await beforeAgent(state, runtime);
			await afterAgent(state, runtime);

			const runStarted = callback.events.find((e) => e.type === "RUN_STARTED");
			const runFinished = callback.events.find((e) => e.type === "RUN_FINISHED");

			expect(runStarted?.threadId).toBe("context-thread");
			expect(runStarted?.runId).toBe("context-run");
			expect(runFinished?.threadId).toBe("context-thread");
			expect(runFinished?.runId).toBe("context-run");
		});

		test("uses explicit overrides when context IDs are absent", async () => {
			const callback = createMockCallback();
			const middleware = createAGUIMiddleware({
				onEvent: callback.emit,
				threadIdOverride: "override-thread",
				runIdOverride: "override-run",
			});

			const state = {};
			const runtime = { context: {} };

			const beforeAgent = middleware.beforeAgent as any;
			await beforeAgent(state, runtime);

			const runStarted = callback.events.find((e) => e.type === "RUN_STARTED");
			expect(runStarted?.threadId).toBe("override-thread");
			expect(runStarted?.runId).toBe("override-run");
		});

		test("falls back only when run ID is missing", async () => {
			const callback = createMockCallback();
			const middleware = createAGUIMiddleware({ onEvent: callback.emit });

			const state = {};
			const runtime = { context: {} };

			const beforeAgent = middleware.beforeAgent as any;
			await beforeAgent(state, runtime);

			const runStarted = callback.events.find((e) => e.type === "RUN_STARTED");
			expect(typeof runStarted?.runId).toBe("string");
			expect(runStarted?.runId.length).toBeGreaterThan(0);
			expect(runStarted?.threadId).toBe("");
		});
	});
});
