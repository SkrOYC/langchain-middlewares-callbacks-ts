/**
 * Edit File Tool
 * 
 * Mock implementation of a file editing tool with change tracking.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { mockFileSystem, setMockFileContent } from "./readFile.js";

/**
 * Track all file changes
 */
const fileChanges: Array<{
  timestamp: Date;
  path: string;
  oldContent: string;
  newContent: string;
}> = [];

/**
 * Edit file content in the simulated file system
 */
async function editFile(
  path: string,
  oldText: string,
  newText: string
): Promise<string> {
  // Normalize path
  const normalizedPath = path.replace(/^\.\//, "");
  
  // Check if file exists
  if (!mockFileSystem.has(normalizedPath)) {
    throw new Error(`File not found: ${path}`);
  }
  
  const oldContent = mockFileSystem.get(normalizedPath)!;
  
  // Check if oldText exists in the file
  if (!oldContent.includes(oldText)) {
    throw new Error(`Text not found in file: ${oldText}`);
  }
  
  // Apply the edit
  const newContent = oldContent.replace(oldText, newText);
  setMockFileContent(normalizedPath, newContent);
  
  // Track the change
  fileChanges.push({
    timestamp: new Date(),
    path: normalizedPath,
    oldContent,
    newContent,
  });
  
  return newContent;
}

/**
 * Get all file changes
 */
export function getFileChanges(): Array<{
  timestamp: Date;
  path: string;
  oldContent: string;
  newContent: string;
}> {
  return [...fileChanges];
}

/**
 * Clear file change history
 */
export function clearFileChanges(): void {
  fileChanges.length = 0;
}

/**
 * Edit File Tool
 * 
 * Edits content in a file within the simulated file system.
 */
export const editFileTool = tool(
  async ({ path, oldText, newText }: { 
    path: string;
    oldText: string;
    newText: string;
  }) => {
    try {
      const result = await editFile(path, oldText, newText);
      return `File edited successfully: ${path}\n\nChanged text: "${oldText}" → "${newText}"`;
    } catch (error) {
      return `Error editing file: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "edit_file",
    description: "Edit the contents of a file in the simulated file system",
    schema: z.object({
      path: z.string().describe("The path to the file to edit"),
      oldText: z.string().describe("The text to replace"),
      newText: z.string().describe("The text to replace it with"),
    }),
  }
);

/**
 * Create File Tool (bonus - creates new files)
 */
export const createFileTool = tool(
  async ({ path, content }: { 
    path: string;
    content: string;
  }) => {
    try {
      // Normalize path
      const normalizedPath = path.replace(/^\.\//, "");
      
      // Check if file already exists
      if (mockFileSystem.has(normalizedPath)) {
        return `File already exists: ${path}. Use edit_file to modify it.`;
      }
      
      // Create the file
      setMockFileContent(normalizedPath, content);
      
      // Track the change
      fileChanges.push({
        timestamp: new Date(),
        path: normalizedPath,
        oldContent: "",
        newContent: content,
      });
      
      return `File created successfully: ${path}`;
    } catch (error) {
      return `Error creating file: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "create_file",
    description: "Create a new file in the simulated file system",
    schema: z.object({
      path: z.string().describe("The path for the new file"),
      content: z.string().describe("The content to write to the file"),
    }),
  }
);