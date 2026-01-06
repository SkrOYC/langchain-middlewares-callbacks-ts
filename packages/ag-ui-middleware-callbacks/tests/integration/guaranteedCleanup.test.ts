/**
 * Integration tests for AG-UI Activity Events.
 * Tests ACTIVITY_SNAPSHOT and ACTIVITY_DELTA emission.
 */

import { test, expect, describe } from "bun:test";
import {
  createMockTransport,
  createTestAgent,
  formatAgentInput,
  getEventsByType,
  createTextModel,
} from "../helpers/testUtils";

describe("Activity Events", () => {
  describe("ACTIVITY_SNAPSHOT and ACTIVITY_DELTA", () => {
    test("ACTIVITY_SNAPSHOT and ACTIVITY_DELTA are emitted for agent steps", async () => {
      const transport = createMockTransport();
      const model = createTextModel(["Hello!"]);

      const { agent } = createTestAgent(model, [], transport, {
        emitActivities: true,
      });

      await agent.invoke(formatAgentInput([{ role: "user", content: "Hello" }]));

      // Should have ACTIVITY_SNAPSHOT for the model call
      const snapshotEvents = getEventsByType(transport, "ACTIVITY_SNAPSHOT");
      expect(snapshotEvents.length).toBeGreaterThanOrEqual(1);

      // Should have ACTIVITY_DELTA for completion
      const deltaEvents = getEventsByType(transport, "ACTIVITY_DELTA");
      expect(deltaEvents.length).toBeGreaterThanOrEqual(1);

      // Verify activity structure
      const snapshot = snapshotEvents[0];
      expect(snapshot.messageId).toBeDefined();
      expect(snapshot.activityType).toBe("AGENT_STEP");
      expect(snapshot.content).toBeDefined();
      expect(snapshot.content.status).toBe("started");

      const delta = deltaEvents[0];
      expect(delta.messageId).toBe(snapshot.messageId);
      expect(delta.activityType).toBe("AGENT_STEP");
      expect(delta.patch).toBeDefined();
      expect(Array.isArray(delta.patch)).toBe(true);
    });

    test("ACTIVITY_SNAPSHOT contains model name and input preview", async () => {
      const transport = createMockTransport();
      const model = createTextModel(["Response text"]);

      const { agent } = createTestAgent(model, [], transport, {
        emitActivities: true,
      });

      await agent.invoke(formatAgentInput([{ role: "user", content: "What is the weather?" }]));

      const snapshotEvents = getEventsByType(transport, "ACTIVITY_SNAPSHOT");
      expect(snapshotEvents.length).toBeGreaterThanOrEqual(1);

      const snapshot = snapshotEvents[0];
      expect(snapshot.content.modelName).toBeDefined();
      expect(snapshot.content.inputPreview).toBeDefined();
      expect(snapshot.content.inputPreview).toContain("weather");
    });

    test("ACTIVITY_DELTA contains completion status and output type", async () => {
      const transport = createMockTransport();
      const model = createTextModel(["Simple response"]);

      const { agent } = createTestAgent(model, [], transport, {
        emitActivities: true,
      });

      await agent.invoke(formatAgentInput([{ role: "user", content: "Hi" }]));

      const deltaEvents = getEventsByType(transport, "ACTIVITY_DELTA");
      expect(deltaEvents.length).toBeGreaterThanOrEqual(1);

      // The last delta should have status "completed"
      const lastDelta = deltaEvents[deltaEvents.length - 1];
      expect(lastDelta.patch).toBeDefined();
      
      // Check if status was updated to "completed" in the patch
      const statusUpdate = lastDelta.patch.find((op: any) => 
        op.path === "/status" && op.value === "completed"
      );
      expect(statusUpdate).toBeDefined();
    });

    test("No activity events when emitActivities is false (default)", async () => {
      const transport = createMockTransport();
      const model = createTextModel(["Hello!"]);

      const { agent } = createTestAgent(model, [], transport);

      await agent.invoke(formatAgentInput([{ role: "user", content: "Hello" }]));

      // Should NOT have any activity events
      const snapshotEvents = getEventsByType(transport, "ACTIVITY_SNAPSHOT");
      const deltaEvents = getEventsByType(transport, "ACTIVITY_DELTA");

      expect(snapshotEvents.length).toBe(0);
      expect(deltaEvents.length).toBe(0);
    });
  });
});
