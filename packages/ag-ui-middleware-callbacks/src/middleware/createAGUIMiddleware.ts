/**
 * AG-UI Middleware Factory
 *
 * Creates middleware that integrates LangChain agents with the AG-UI protocol.
 */

import { createMiddleware } from "langchain";
import { z } from "zod";
import { compare, type Operation } from "fast-json-patch";
import { generateId, generateDeterministicId } from "../utils/idGenerator";
import { computeStateDelta } from "../utils/stateDiff";
import { mapLangChainMessageToAGUI } from "../utils/messageMapper";
import { cleanLangChainData } from "../utils/cleaner";
import {
  AGUIMiddlewareOptionsSchema,
  type AGUIMiddlewareOptions,
} from "./types";

/**
 * Filter STATE_DELTA operations to include only UI-relevant state paths.
 * Based on AG-UI protocol spec: STATE_DELTA should emit shared application state,
 * not internal framework metadata.
 * 
 * Whitelist: paths that serve legitimate UI purposes
 * Blacklist: internal framework details that should not be synchronized
 */
function filterStateDelta(delta: Operation[]): Operation[] {
  // Paths that are valuable for UI/synchronization
  const WHITELIST_PATTERNS = [
    // Message array structure
    '/messages',
    '/messages/-',           // Add new message
    '/messages/\\d+',        // Specific message index
    
    // Message properties (AG-UI relevant)
    '/messages/\\d+/id',           // Message ID for correlation
    '/messages/\\d+/role',         // Message role (user/assistant/tool)
    '/messages/\\d+/content',      // Message content
    '/messages/\\d+/name',         // Component name (for tracing)
    '/messages/\\d+/tool_call_id', // Tool result correlation
    '/messages/\\d+/status',       // Tool execution status
    
    // Provider and usage data (valuable for UI)
    '/messages/\\d+/additional_kwargs',
    '/messages/\\d+/response_metadata',
    '/messages/\\d+/usage_metadata',
    
    // Tool calls (important for UI state)
    '/messages/\\d+/tool_calls',
    '/messages/\\d+/tool_call_chunks',
  ];
  
  // Internal framework details to exclude
  const BLACKLIST_PATTERNS = [
    // LangChain internal markers
    '/messages/\\d+/lc',
    '/messages/\\d+/type',
    '/messages/\\d+/id$',          // Internal ID array (keep messageId, remove this)
    '/messages/\\d+/kwargs',       // Internal structure (extract content instead)
    '/messages/\\d+/invalid_tool_calls',
    
    // LangGraph internals
    '/messages/\\d+/lg_',
    '/lg_',
    
    // Root-level internal paths
    '^/lc$',
    '^/type$',
    '^/kwargs$',
    '^/additional_kwargs$',
  ];
  
  const isWhitelisted = (path: string): boolean => {
    return WHITELIST_PATTERNS.some(pattern => {
      const regex = new RegExp(pattern);
      return regex.test(path);
    });
  };
  
  const isBlacklisted = (path: string): boolean => {
    return BLACKLIST_PATTERNS.some(pattern => {
      const regex = new RegExp(pattern);
      return regex.test(path);
    });
  };
  
  // Filter: include if whitelisted AND not blacklisted
  return delta.filter(op => {
    const path = op.path;
    
    // Must be whitelisted
    if (!isWhitelisted(path)) {
      return false;
    }
    
    // Must not be blacklisted
    if (isBlacklisted(path)) {
      return false;
    }
    
    return true;
  });
}

/**
 * Check if a path is whitelisted for STATE_DELTA emission.
 * Whitelist paths have legitimate UI/synchronization purposes.
 */
function isPathWhitelisted(path: string): boolean {
  const WHITELIST_PATTERNS = [
    // Message array structure
    '/messages',
    '/messages/-',           // Add new message
    '/messages/\\d+',        // Specific message index
    
    // Message properties (AG-UI relevant)
    '/messages/\\d+/id',           // Message ID for correlation
    '/messages/\\d+/role',         // Message role (user/assistant/tool)
    '/messages/\\d+/content',      // Message content
    '/messages/\\d+/name',         // Component name (for tracing)
    '/messages/\\d+/tool_call_id', // Tool result correlation
    '/messages/\\d+/status',       // Tool execution status
    
    // Provider and usage data (valuable for UI)
    '/messages/\\d+/additional_kwargs',
    '/messages/\\d+/response_metadata',
    '/messages/\\d+/usage_metadata',
    
    // Tool calls (important for UI state)
    '/messages/\\d+/tool_calls',
    '/messages/\\d+/tool_call_chunks',
  ];
  
  return WHITELIST_PATTERNS.some(pattern => {
    const regex = new RegExp(pattern);
    return regex.test(path);
  });
}

/**
 * Check if a path is blacklisted for STATE_DELTA emission.
 * Blacklist paths are internal framework details.
 */
function isPathBlacklisted(path: string): boolean {
  const BLACKLIST_PATTERNS = [
    // LangChain internal markers
    '/messages/\\d+/lc',
    '/messages/\\d+/type',
    '/messages/\\d+/id$',          // Internal ID array (keep messageId, remove this)
    '/messages/\\d+/kwargs',       // Internal structure (extract content instead)
    '/messages/\\d+/invalid_tool_calls',
    
    // LangGraph internals
    '/messages/\\d+/lg_',
    '/lg_',
    
    // Root-level internal paths
    '^/lc$',
    '^/type$',
    '^/kwargs$',
    '^/additional_kwargs$',
  ];
  
  return BLACKLIST_PATTERNS.some(pattern => {
    const regex = new RegExp(pattern);
    return regex.test(path);
  });
}

/**
 * Clean LangChain message objects to extract UI-relevant fields only.
 * Based on field-by-field justification analysis.
 */
function cleanMessageForState(message: any): any {
  if (!message || typeof message !== 'object') {
    return message;
  }
  
  // For LangChain objects, extract from kwargs if it exists
  const kwargs = message.kwargs || {};
  
  return {
    // UI-relevant fields from AG-UI spec
    id: kwargs.id || message.id,          // AG-UI messageId or LangChain internal ID
    role: kwargs.role || inferRole(message), // Message role
    content: kwargs.content || '',         // Message content
    name: kwargs.name || message.name,     // Component name (for tracing)
    tool_call_id: kwargs.tool_call_id,     // Tool result correlation
    status: kwargs.status,                 // Tool execution status
    
    // Provider and usage data (valuable for UI)
    additional_kwargs: kwargs.additional_kwargs,
    response_metadata: kwargs.response_metadata,
    usage_metadata: kwargs.usage_metadata,
    tool_calls: kwargs.tool_calls,
    tool_call_chunks: kwargs.tool_call_chunks,
  };
}

/**
 * Infer message role from LangChain message structure.
 */
function inferRole(message: any): string {
  const kwargs = message.kwargs || {};
  
  if (kwargs.role) return kwargs.role;
  if (message.name === 'calculator' || message.tool_call_id) return 'tool';
  if (message.lc_serializable?.id?.[1] === 'AIMessage' || 
      message.lc_serializable?.id?.[1] === 'AIMessageChunk') return 'assistant';
  if (message.lc_serializable?.id?.[1] === 'HumanMessage') return 'user';
  if (message.lc_serializable?.id?.[1] === 'ToolMessage') return 'tool';
  
  return 'unknown';
}

/**
 * Filter STATE_DELTA operations and clean message values.
 * Ensures only UI-relevant state paths and data are emitted.
 */
function filterAndCleanStateDelta(delta: Operation[]): Operation[] {
  return delta
    .map(op => {
      // Filter paths first
      const path = op.path;
      if (!isPathWhitelisted(path) || isPathBlacklisted(path)) {
        return null;
      }
      
      // For 'add' operations, clean the value (message objects)
      if (op.op === 'add' && op.value && typeof op.value === 'object') {
        // Check if this looks like a message object
        if (op.value.kwargs || op.value.lc || op.value.type) {
          return {
            ...op,
            value: cleanMessageForState(op.value),
          };
        }
      }
      
      return op;
    })
    .filter((op): op is Operation => op !== null);
}

/**
 * Interface for tracking previous state for delta computation.
 */
interface StateTracker {
  previousState: unknown;
}

/**
 * Interface for tracking agent execution activities.
 */
interface ActivityTracker {
  currentActivityId: string | undefined;
  currentActivityType: string;
  activityContent: Record<string, any>;
}

/**
 * Helper function to get a preview of the input for activity content.
 */
interface StateTracker {
  previousState: unknown;
}

/**
 * Interface for tracking agent execution activities.
 */
interface ActivityTracker {
  currentActivityId: string | undefined;
  currentActivityType: string;
  activityContent: Record<string, any>;
}

/**
 * Helper function to get a preview of the input for activity content.
 */
function getInputPreview(state: unknown): string {
  const stateAny = state as any;
  if (stateAny.messages && Array.isArray(stateAny.messages)) {
    const lastMessage = stateAny.messages[stateAny.messages.length - 1];
    if (lastMessage && typeof lastMessage.content === "string") {
      return lastMessage.content.substring(0, 100) + (lastMessage.content.length > 100 ? "..." : "");
    }
  }
  return "[no input preview]";
}

/**
 * Helper function to get the type of output from state.
 */
function getOutputType(state: unknown): string {
  const stateAny = state as any;
  if (stateAny.messages && Array.isArray(stateAny.messages)) {
    const lastMessage = stateAny.messages[stateAny.messages.length - 1];
    if (lastMessage?.tool_calls?.length) return "tool_calls";
    if (lastMessage?.content) return "text";
  }
  return "unknown";
}

/**
 * Helper function to check if state contains tool calls.
 */
function hasToolCalls(state: unknown): boolean {
  const stateAny = state as any;
  return !!(stateAny.messages && stateAny.messages.some((m: any) => m.tool_calls?.length > 0));
}

/**
 * Emit ACTIVITY_SNAPSHOT or ACTIVITY_DELTA based on current state.
 * ACTIVITY_SNAPSHOT = new activity or significant change
 * ACTIVITY_DELTA = incremental update
 */
async function emitActivityUpdate(
  transport: any,
  currentRunId: string | undefined,
  stepIndex: number,
  activityTracker: ActivityTracker,
  status: "started" | "processing" | "completed",
  activityMapper: ((node: any) => any) | undefined,
  details?: Record<string, any>
): Promise<void> {
  if (!currentRunId) return;

  const activityId = `activity-${currentRunId}-${stepIndex}`;
  const baseContent = {
    status,
    timestamp: Date.now(),
    ...details,
  };

  // Apply activityMapper if provided
  const finalContent = activityMapper ? activityMapper(baseContent) : baseContent;

  if (!activityTracker.currentActivityId || activityTracker.currentActivityId !== activityId) {
    // New activity - emit SNAPSHOT
    activityTracker.currentActivityId = activityId;
    activityTracker.currentActivityType = "AGENT_STEP";
    activityTracker.activityContent = finalContent;

    transport.emit({
      type: "ACTIVITY_SNAPSHOT",
      messageId: activityId,
      activityType: "AGENT_STEP",
      content: finalContent,
      replace: true,
    });
  } else {
    // Existing activity - emit DELTA
    const patch = computeStateDelta(activityTracker.activityContent, finalContent);
    if (patch.length > 0) {
      activityTracker.activityContent = finalContent;

      transport.emit({
        type: "ACTIVITY_DELTA",
        messageId: activityId,
        activityType: "AGENT_STEP",
        patch,
      });
    }
  }
}

/**
 * Create AG-UI middleware for LangChain agents.
 *
 * @param options - Middleware configuration options
 * @returns AgentMiddleware instance with lifecycle hooks
 */
export function createAGUIMiddleware(options: AGUIMiddlewareOptions) {
  // Validate options at creation time
  const validated = AGUIMiddlewareOptionsSchema.parse(options);
  
  const transport = validated.transport;
  
  let threadId: string | undefined;
  let runId: string | undefined;
  let currentStepName: string | undefined = undefined;
  let modelTurnIndex = 0;

  const stateTracker: StateTracker = {
    previousState: undefined,
  };

  const activityTracker: ActivityTracker = {
    currentActivityId: undefined,
    currentActivityType: "AGENT_STEP",
    activityContent: {},
  };

  const activityStates = new Map<string, any>();

  return createMiddleware({
    name: "ag-ui-lifecycle",
    contextSchema: z.object({
      run_id: z.string().optional(),
      runId: z.string().optional(),
      thread_id: z.string().optional(),
      threadId: z.string().optional(),
    }) as any,

    beforeAgent: async (state, runtime) => {
      modelTurnIndex = 0;
      const runtimeAny = runtime as any;
      const configurable = runtimeAny.config?.configurable || runtimeAny.configurable;
      
      threadId =
        (configurable?.threadId as string | undefined) ||
        (configurable?.thread_id as string | undefined) ||
        (configurable?.checkpoint_id as string | undefined) ||
        validated.threadIdOverride ||
        (runtimeAny.context?.threadId as string | undefined) ||
        (runtimeAny.context?.thread_id as string | undefined) ||
        "";

      // Exhaustive search for Run ID - generate fallback if not found
      runId =
        validated.runIdOverride ||
        (configurable?.run_id as string | undefined) ||
        (runtimeAny.runId as string | undefined) ||
        (runtimeAny.id as string | undefined) ||
        (runtimeAny.context?.runId as string | undefined) ||
        (runtimeAny.context?.run_id as string | undefined) ||
        (runtimeAny.config?.runId as string | undefined) ||
        crypto.randomUUID(); // Generate fallback for streamEvents compatibility

      try {
        transport.emit({
          type: "RUN_STARTED",
          threadId,
          runId,
          input: cleanLangChainData(runtimeAny.config?.input),
          timestamp: Date.now(),
        });

        if (
          validated.emitStateSnapshots === "initial" ||
          validated.emitStateSnapshots === "all"
        ) {
          const snapshot = validated.stateMapper 
            ? validated.stateMapper(state) 
            : cleanLangChainData(state);
          
          // Remove messages from state snapshot by default to avoid redundancy
          if (!validated.stateMapper && snapshot && typeof snapshot === "object") {
            delete (snapshot as any).messages;
          }

           transport.emit({
             type: "STATE_SNAPSHOT",
             snapshot,
             timestamp: Date.now(),
           });
         }
         
         const stateAny = state as any;
         if (stateAny.messages && Array.isArray(stateAny.messages)) {
           transport.emit({
             type: "MESSAGES_SNAPSHOT",
             messages: stateAny.messages.map(mapLangChainMessageToAGUI),
             timestamp: Date.now(),
           });
         }
      } catch {
        // Fail-safe
      }

      // Store runId in metadata for callback coordination
      // This allows callbacks to use the same runId as middleware
      const configAny = runtimeAny.config as any;
      if (configAny) {
        configAny.metadata = {
          ...(configAny.metadata || {}),
          agui_runId: runId,
        };
      }

      return {};
    },

    beforeModel: async (state, runtime) => {
      const turnIndex = modelTurnIndex++;
      const messageId = generateDeterministicId(runId!, turnIndex);
      const stepName = `model_call_${messageId}`;
      currentStepName = stepName;

      // Store messageId in metadata for callback coordination
      // This ensures callbacks use the same messageId as middleware
      const runtimeAny = runtime as any;
      const configAny = runtimeAny.config as any;
      if (configAny) {
        configAny.metadata = {
          ...(configAny.metadata || {}),
          agui_messageId: messageId,
        };
      }

      try {
        transport.emit({
          type: "STEP_STARTED",
          stepName,
          timestamp: Date.now(),
          // REMOVED: runId, threadId
        });

        // Emit ACTIVITY_SNAPSHOT for new activity if activities are enabled
        if (validated.emitActivities) {
          await emitActivityUpdate(
            transport,
            runId,
            turnIndex,
            activityTracker,
            "started",
            validated.activityMapper,
            {
              stepName,
              modelName: (runtime as any).config?.model?._modelType || "unknown",
              inputPreview: getInputPreview(state),
            } as Record<string, any>
          );
        }

        // TEXT_MESSAGE_START is handled by AGUICallbackHandler
        // It reads messageId from metadata in handleLLMStart
      } catch {
        // Fail-safe
      }

      return {};
    },

    afterModel: async (state, _runtime) => {
      try {
        // TEXT_MESSAGE_END is handled by AGUICallbackHandler
        // It uses the same messageId from metadata coordination

        transport.emit({
          type: "STEP_FINISHED",
          stepName: currentStepName || "",
          timestamp: Date.now(),
          // REMOVED: runId, threadId
        });

        // Emit ACTIVITY_DELTA for completed activity if activities are enabled
        if (validated.emitActivities && currentStepName) {
          const turnIndex = modelTurnIndex - 1;
          await emitActivityUpdate(
            transport,
            runId,
            turnIndex,
            activityTracker,
            "completed",
            validated.activityMapper,
            {
              stepName: currentStepName,
              outputType: getOutputType(state),
              hasToolCalls: hasToolCalls(state),
            } as Record<string, any>
          );
        }

        // Emit STATE_SNAPSHOT after state-stabilizing events (not during streaming)
        // Per AG-UI spec and LangGraph implementation: emit only when streaming has completed
        // and state is stable. STATE_DELTA is NOT used in actual LangGraph implementations.
        if (validated.emitStateSnapshots !== "none" && stateTracker.previousState !== undefined) {
          // Only emit STATE_SNAPSHOT after streaming completes (state-stabilizing event)
          // This follows the LangGraph pattern: emit after tool/text streaming ends
          const filteredState = cleanLangChainData(state);
          const snapshot = validated.stateMapper 
            ? validated.stateMapper(filteredState) 
            : filteredState;
          
          // Remove messages from state snapshot (messages are in MESSAGES_SNAPSHOT)
          if (!validated.stateMapper && snapshot && typeof snapshot === "object") {
            delete (snapshot as any).messages;
          }
          
          // Only emit if we have meaningful state to share
          const stateKeys = snapshot ? Object.keys(snapshot).filter(k => snapshot[k] !== undefined && snapshot[k] !== null) : [];
          if (stateKeys.length > 0) {
            transport.emit({
              type: "STATE_SNAPSHOT",
              snapshot,
              timestamp: Date.now(),
            });
          }
        }
        
        // Update state tracker for next computation
        stateTracker.previousState = cleanLangChainData(state);
      } catch {
        // Fail-safe
      }

      currentStepName = undefined;
      return {};
    },

    afterAgent: async (state, _runtime) => {
      try {
        if (
          validated.emitStateSnapshots === "final" ||
          validated.emitStateSnapshots === "all"
        ) {
          const snapshot = validated.stateMapper 
            ? validated.stateMapper(state) 
            : cleanLangChainData(state);
          
          // Remove messages from state snapshot by default to avoid redundancy
          if (!validated.stateMapper && snapshot && typeof snapshot === "object") {
            delete (snapshot as any).messages;
          }

            transport.emit({
              type: "STATE_SNAPSHOT",
              snapshot,
              timestamp: Date.now(),
            });
        }

        const stateAny = state as any;
        if (stateAny.error) {
          const error = stateAny.error;
          const errorMessage = error instanceof Error ? error.message : String(error);
          transport.emit({
            type: "RUN_ERROR",
            message:
              validated.errorDetailLevel === "full" ||
              validated.errorDetailLevel === "message"
                ? errorMessage
                : "",
            code: "AGENT_EXECUTION_ERROR",
            timestamp: Date.now(),
            // REMOVED: threadId, runId, parentRunId
          });
        } else {
          transport.emit({
            type: "RUN_FINISHED",
            threadId: threadId!,
            runId: runId!,
            result: validated.resultMapper ? validated.resultMapper(state) : undefined,
            timestamp: Date.now(),
          });
        }
      } catch {
        // Fail-safe
      }

      return {};
    },
  });
}
