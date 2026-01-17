/**
 * Mock Tools Index
 * 
 * This file exports all mock tools for the Zed backend example.
 */

import { StructuredTool } from "@langchain/core/tools";
import { readFileTool } from "./readFile.js";
import { editFileTool } from "./editFile.js";
import { bashTool } from "./bash.js";
import { searchTool } from "./search.js";
import { thinkTool } from "./think.js";
import { deleteFileTool } from "./deleteFile.js";

/**
 * Create all mock tools for the agent
 */
export function createTools(): StructuredTool[] {
  return [
    readFileTool,
    editFileTool,
    bashTool,
    searchTool,
    thinkTool,
    deleteFileTool,
  ];
}

// Export individual tools for direct use
export { readFileTool } from "./readFile.js";
export { editFileTool } from "./editFile.js";
export { bashTool } from "./bash.js";
export { searchTool } from "./search.js";
export { thinkTool } from "./think.js";
export { deleteFileTool } from "./deleteFile.js";