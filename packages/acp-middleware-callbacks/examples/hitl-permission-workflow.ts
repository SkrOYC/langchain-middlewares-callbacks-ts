/**
 * HITL Permission Workflow Example
 * 
 * This example demonstrates the complete Human-in-the-Loop (HITL) permission
 * workflow using createACPPermissionMiddleware with the interrupt/resume pattern.
 * 
 * Key concepts:
 * 1. Permission middleware intercepts tool calls requiring approval
 * 2. interrupt() checkpoints state and pauses execution
 * 3. UI presents approval interface to user
 * 4. User decision is passed via Command({ resume: { decisions: [...] } })
 * 5. Execution resumes with modified state based on decisions
 */

import { createAgent } from "langchain";
import { createACPPermissionMiddleware } from "../src/middleware/createACPPermissionMiddleware";
import { Command } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph-checkpoint";

/**
 * Example 1: Basic HITL Permission Workflow
 * 
 * This demonstrates the core pattern: agent runs, hits interrupt for permission,
 * waits for user decision, then resumes.
 */
async function basicHitlWorkflow() {
  console.log("=== Example 1: Basic HITL Permission Workflow ===\n");

  // 1. Create permission middleware with policy
  const permissionMiddleware = createACPPermissionMiddleware({
    permissionPolicy: {
      "delete_*": { requiresPermission: true, kind: "delete" },
      "write_*": { requiresPermission: true, kind: "edit" },
      "read_*": { requiresPermission: false },  // Auto-approved
    },
    transport: {
      // Mock transport - in real usage, this connects to your ACP client
      sendNotification: (method: string, params: any) => {
        console.log(`[ACP Notification] ${method}:`, params);
      },
      sessionUpdate: async (params: any) => {
        console.log(`[Session Update]`, params);
      },
    },
  });

  // 2. Create agent with middleware
  const agent = createAgent({
    model: "claude-sonnet-4-20250514",
    middleware: [permissionMiddleware],
  });

  // 3. Configuration for the agent run
  const config = {
    configurable: {
      thread_id: "user-session-123",
      session_id: "acp-session-456",
    },
  };

  // 4. Initial invoke - this will trigger an interrupt
  console.log("Step 1: Invoke agent with request requiring permission\n");
  const initialResult = await agent.invoke(
    { messages: [new HumanMessage("Delete old logs and write new config")] },
    config
  );

  // 5. Check if agent was interrupted
  const state = await agent.graph.getState(config);
  
  if (state.next?.length > 0) {
    console.log("\nStep 2: Agent interrupted - waiting for user approval\n");
    
    // Get the interrupt data (tools awaiting approval)
    const interruptData = state.tasks[0].interrupts[0].value;
    console.log("Tools requiring approval:", interruptData.actionRequests.length);
    
    // In a real UI, you would display each tool to the user for approval
    // For this example, we simulate user decisions:
    const decisions = interruptData.actionRequests.map((tool: any) => {
      if (tool.name.startsWith("delete_")) {
        // User approves deletes
        return { type: "approve" as const, toolCallId: tool.toolCallId };
      } else {
        // User edits write arguments for safety
        return {
          type: "edit" as const,
          toolCallId: tool.toolCallId,
          editedAction: {
            name: tool.name,
            args: {
              ...tool.args,
              safeMode: true,  // Add safety parameter
            },
          },
        };
      }
    });

    console.log("\nStep 3: Resume with user decisions\n");
    
    // 6. Resume with decisions via Command
    const resumedResult = await agent.invoke(
      new Command({
        resume: { decisions },
      }),
      config
    );
    
    console.log("\nStep 4: Agent completed with decisions applied\n");
    console.log("Final messages:", resumedResult.messages?.length);
  } else {
    console.log("Agent completed without interruption");
  }
}

/**
 * Example 2: Mixed Permission Workflow
 * 
 * Demonstrates handling multiple tools with mixed permission requirements.
 */
async function mixedPermissionWorkflow() {
  console.log("\n=== Example 2: Mixed Permission Workflow ===\n");

  const permissionMiddleware = createACPPermissionMiddleware({
    permissionPolicy: {
      "dangerous_*": { requiresPermission: true, kind: "delete" },
      "modify_*": { requiresPermission: true, kind: "edit" },
      "query_*": { requiresPermission: false },
      "get_*": { requiresPermission: false },
    },
    transport: {
      sendNotification: (method: string, params: any) => {
        console.log(`[Notification] ${method}`);
      },
      sessionUpdate: async () => {},
    },
  });

  const agent = createAgent({
    model: "claude-sonnet-4-20250514",
    middleware: [permissionMiddleware],
  });

  const config = {
    configurable: {
      thread_id: "mixed-permission-session",
      session_id: "acp-session-789",
    },
  };

  console.log("Invoking with mixed tool permissions...\n");
  
  const result = await agent.invoke(
    {
      messages: [
        new HumanMessage(
          "Query database, get user data, modify settings, and dangerous cleanup"
        ),
      ],
    },
    config
  );

  const state = await agent.graph.getState(config);
  
  if (state.next?.length > 0) {
    const interruptData = state.tasks[0].interrupts[0].value;
    
    console.log(`\nInterrupted: ${interruptData.actionRequests.length} tools require approval`);
    console.log("Tools requiring permission:");
    interruptData.actionRequests.forEach((tool: any) => {
      console.log(`  - ${tool.name} (${tool.toolCallId})`);
    });
    
    // Simulate user decisions: approve all
    const decisions = interruptData.actionRequests.map((tool: any) => ({
      type: "approve" as const,
      toolCallId: tool.toolCallId,
    }));

    const resumed = await agent.invoke(
      new Command({ resume: { decisions } }),
      config
    );
    
    console.log("\nResumed with all approvals");
  }
}

/**
 * Example 3: Rejection and Re-planning
 * 
 * Demonstrates what happens when user rejects a tool call.
 */
async function rejectionAndReplanningWorkflow() {
  console.log("\n=== Example 3: Rejection and Re-planning ===\n");

  const permissionMiddleware = createACPPermissionMiddleware({
    permissionPolicy: {
      "delete_*": { requiresPermission: true, kind: "delete" },
      "write_*": { requiresPermission: true, kind: "edit" },
    },
    transport: {
      sendNotification: (method: string, params: any) => {
        console.log(`[Notification] ${method}`);
      },
      sessionUpdate: async () => {},
    },
  });

  const agent = createAgent({
    model: "claude-sonnet-4-20250514",
    middleware: [permissionMiddleware],
  });

  const config = {
    configurable: {
      thread_id: "rejection-session",
      session_id: "acp-session-abc",
    },
  };

  console.log("Requesting potentially dangerous operation...\n");
  
  const result = await agent.invoke(
    { messages: [new HumanMessage("Delete everything and write random data")] },
    config
  );

  const state = await agent.graph.getState(config);
  
  if (state.next?.length > 0) {
    const interruptData = state.tasks[0].interrupts[0].value;
    
    console.log("\nUser review:");
    console.log("  delete_everything: REJECTED (too dangerous!)");
    console.log("  write_random_data: REJECTED (noisy)");
    
    const decisions = interruptData.actionRequests.map((tool: any) => ({
      type: "reject" as const,
      toolCallId: tool.toolCallId,
      message: "User rejected: too dangerous or unnecessary",
    }));

    const resumed = await agent.invoke(
      new Command({ resume: { decisions } }),
      config
    );
    
    // With rejections, agent jumps back to model for re-planning
    console.log("\nAgent re-planned after rejection");
    console.log("New messages added for rejected tools:", 
      resumed.messages?.filter((m: any) => m.role === "tool").length || 0);
  }
}

/**
 * Example 4: Checkpoint and State Recovery
 * 
 * Demonstrates checkpointing behavior with checkpointer configured.
 */
async function checkpointAndRecoveryWorkflow() {
  console.log("\n=== Example 4: Checkpoint and State Recovery ===\n");

  const checkpointer = new MemorySaver();

  const permissionMiddleware = createACPPermissionMiddleware({
    permissionPolicy: {
      "sensitive_*": { requiresPermission: true },
    },
    transport: {
      sendNotification: (method: string, params: any) => {
        console.log(`[Notification] ${method}`);
      },
      sessionUpdate: async () => {},
    },
  });

  const agent = createAgent({
    model: "claude-sonnet-4-20250514",
    middleware: [permissionMiddleware],
    checkpointer,
  });

  const config = {
    configurable: {
      thread_id: "checkpoint-session",
      session_id: "acp-session-check",
    },
  };

  console.log("Starting workflow with checkpointer...\n");
  
  // Initial state with conversation history
  const initialState = {
    messages: [
      new HumanMessage("First, query the database"),
      new HumanMessage("Now access sensitive data"),
    ],
  };

  const result = await agent.invoke(initialState, config);

  // Check for interrupt
  const state = await agent.graph.getState(config);
  
  if (state.next?.length > 0) {
    const checkpointId = state.channelValues?.__metadata?.checkpoint_id;
    console.log(`\nCheckpoint created: ${checkpointId || "yes"}`);
    console.log("Conversation history preserved in checkpoint");
    
    // User makes decision
    const interruptData = state.tasks[0].interrupts[0].value;
    const decisions = interruptData.actionRequests.map((tool: any) => ({
      type: "approve" as const,
      toolCallId: tool.toolCallId,
    }));

    await agent.invoke(new Command({ resume: { decisions } }), config);
    
    console.log("State restored from checkpoint, execution continued");
  }
}

// Run all examples
async function main() {
  console.log("HITL Permission Workflow Examples\n");
  console.log("=".repeat(60));
  
  try {
    await basicHitlWorkflow();
    await mixedPermissionWorkflow();
    await rejectionAndReplanningWorkflow();
    await checkpointAndRecoveryWorkflow();
    
    console.log("\n" + "=".repeat(60));
    console.log("All examples completed successfully!\n");
  } catch (error) {
    console.error("Example failed:", error);
    throw error;
  }
}

main().catch(console.error);

/**
 * Summary of Key Patterns:
 * 
 * 1. Permission Check:
 *    - Tools are categorized based on permissionPolicy
 *    - Auto-approved tools proceed without interrupt
 *    - Permission-required tools trigger interrupt()
 * 
 * 2. Interrupt Flow:
 *    - afterModel hook extracts tool calls from state
 *    - Sends session/request_permission notification
 *    - Calls runtime.interrupt(HITLRequest)
 *    - LangGraph checkpoints state
 * 
 * 3. Resume Pattern:
 *    - Pass decisions via Command({ resume: { decisions } })
 *    - Decisions: approve, edit (with new args), reject (with optional message)
 *    - Rejection causes jumpTo: "model" for re-planning
 * 
 * 4. State Management:
 *    - Conversation history preserved through checkpoint
 *    - Checkpointer (MemorySaver, PostgresSaver, etc.) required for durability
 *    - State restored on resume before applying decisions
 */
