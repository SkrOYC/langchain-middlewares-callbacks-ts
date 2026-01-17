/**
 * Think Tool
 * 
 * Mock implementation of reasoning output functionality.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Thought types
 */
type ThoughtType = "reasoning" | "planning" | "analysis" | "reflection";

/**
 * Thought entry
 */
interface Thought {
  timestamp: Date;
  type: ThoughtType;
  content: string;
  tags?: string[];
}

/**
 * Thought history
 */
const thoughtHistory: Thought[] = [];

/**
 * Add a thought to history
 */
export function addThought(type: ThoughtType, content: string, tags?: string[]): void {
  thoughtHistory.push({
    timestamp: new Date(),
    type,
    content,
    tags,
  });
}

/**
 * Get thought history
 */
export function getThoughtHistory(): Thought[] {
  return [...thoughtHistory];
}

/**
 * Clear thought history
 */
export function clearThoughtHistory(): void {
  thoughtHistory.length = 0;
}

/**
 * Format thoughts for display
 */
function formatThoughts(thoughts: Thought[]): string {
  if (thoughts.length === 0) {
    return "No thoughts recorded";
  }
  
  let output = `Thought History (${thoughts.length} thought(s)):\n\n`;
  
  for (const thought of thoughts) {
    const time = thought.timestamp.toLocaleTimeString();
    output += `[${time}] [${thought.type.toUpperCase()}] ${thought.content}\n`;
    
    if (thought.tags && thought.tags.length > 0) {
      output += `  Tags: ${thought.tags.join(", ")}\n`;
    }
    
    output += "\n";
  }
  
  return output.trim();
}

/**
 * Think Tool
 * 
 * Records thoughts, reasoning, planning, or analysis for debugging and transparency.
 */
export const thinkTool = tool(
  async ({ thought, type = "reasoning", tags }: {
    thought: string;
    type?: ThoughtType;
    tags?: string[];
  }) => {
    try {
      // Record the thought
      addThought(type, thought, tags);
      
      // Return confirmation with the thought
      return `Thought recorded:\n\n[${type.toUpperCase()}] ${thought}${tags ? `\nTags: ${tags.join(", ")}` : ""}`;
    } catch (error) {
      return `Error recording thought: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "think",
    description: "Record thoughts, reasoning, planning, or analysis for debugging and transparency",
    schema: z.object({
      thought: z.string().describe("The thought or reasoning to record"),
      type: z.enum(["reasoning", "planning", "analysis", "reflection"])
        .optional()
        .default("reasoning")
        .describe("The type of thought"),
      tags: z.array(z.string()).optional().describe("Optional tags for the thought"),
    }),
  }
);

/**
 * View Thoughts Tool (bonus - view thought history)
 */
export const viewThoughtsTool = tool(
  async () => {
    try {
      const thoughts = getThoughtHistory();
      return formatThoughts(thoughts);
    } catch (error) {
      return `Error viewing thoughts: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "view_thoughts",
    description: "View the thought history and reasoning log",
    schema: z.object({}),
  }
);

/**
 * Clear Thoughts Tool (bonus - clear thought history)
 */
export const clearThoughtsTool = tool(
  async () => {
    try {
      clearThoughtHistory();
      return "Thought history cleared";
    } catch (error) {
      return `Error clearing thoughts: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "clear_thoughts",
    description: "Clear the thought history and reasoning log",
    schema: z.object({}),
  }
);