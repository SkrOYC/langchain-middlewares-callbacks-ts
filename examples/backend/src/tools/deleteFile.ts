/**
 * Delete File Tool
 * 
 * Mock implementation of file deletion functionality.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { mockFileSystem, listMockFiles } from "./readFile.js";

/**
 * Deleted files history
 */
const deletedFiles: Map<string, { 
  content: string; 
  deletedAt: Date;
}> = new Map();

/**
 * Delete a file from the simulated file system
 */
async function deleteFile(path: string): Promise<string> {
  // Normalize path
  const normalizedPath = path.replace(/^\.\//, "");
  
  // Check if file exists
  if (!mockFileSystem.has(normalizedPath)) {
    throw new Error(`File not found: ${path}`);
  }
  
  // Get file content before deletion
  const content = mockFileSystem.get(normalizedPath)!;
  
  // Delete the file
  mockFileSystem.delete(normalizedPath);
  
  // Track the deletion
  deletedFiles.set(normalizedPath, {
    content,
    deletedAt: new Date(),
  });
  
  return `File deleted: ${path}`;
}

/**
 * Get list of deleted files
 */
export function getDeletedFiles(): Map<string, { content: string; deletedAt: Date }> {
  return new Map(deletedFiles);
}

/**
 * Restore a deleted file
 */
export function restoreFile(path: string): boolean {
  const deletedFile = deletedFiles.get(path);
  if (!deletedFile) {
    return false;
  }
  
  // Restore the file
  mockFileSystem.set(path, deletedFile.content);
  deletedFiles.delete(path);
  
  return true;
}

/**
 * Clear deleted files history
 */
export function clearDeletedFiles(): void {
  deletedFiles.clear();
}

/**
 * Undelete Tool (bonus - restore deleted files)
 */
export const undeleteTool = tool(
  async ({ path }: { path: string }) => {
    try {
      const normalizedPath = path.replace(/^\.\//, "");
      
      const restored = restoreFile(normalizedPath);
      
      if (restored) {
        return `File restored: ${path}`;
      } else {
        return `File not found in deleted files: ${path}`;
      }
    } catch (error) {
      return `Error restoring file: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "undelete",
    description: "Restore a previously deleted file",
    schema: z.object({
      path: z.string().describe("The path to the file to restore"),
    }),
  }
);

/**
 * List Deleted Files Tool (bonus)
 */
export const listDeletedFilesTool = tool(
  async () => {
    try {
      if (deletedFiles.size === 0) {
        return "No deleted files";
      }
      
      let output = `Deleted Files (${deletedFiles.size}):\n\n`;
      
      for (const [path, info] of deletedFiles) {
        output += `${path} (deleted at ${info.deletedAt.toLocaleString()})\n`;
      }
      
      return output.trim();
    } catch (error) {
      return `Error listing deleted files: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "list_deleted",
    description: "List all deleted files",
    schema: z.object({}),
  }
);

/**
 * Delete File Tool
 * 
 * Deletes a file from the simulated file system.
 */
export const deleteFileTool = tool(
  async ({ path, recursive = false }: { 
    path: string;
    recursive?: boolean;
  }) => {
    try {
      const normalizedPath = path.replace(/^\.\//, "");
      
      // Check if it's a directory (ends with /)
      if (normalizedPath.endsWith("/")) {
        if (recursive) {
          // Delete all files in directory
          const files = listMockFiles().filter((file) => file.startsWith(normalizedPath));
          
          if (files.length === 0) {
            return `Directory not found: ${path}`;
          }
          
          let deleted = 0;
          for (const file of files) {
            await deleteFile(file);
            deleted++;
          }
          
          return `Deleted ${deleted} file(s) in ${path}`;
        } else {
          return `Cannot delete directory without recursive flag: ${path}`;
        }
      }
      
      // Delete single file
      const result = await deleteFile(normalizedPath);
      return result;
    } catch (error) {
      return `Error deleting file: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "delete_file",
    description: "Delete a file from the simulated file system",
    schema: z.object({
      path: z.string().describe("The path to the file to delete"),
      recursive: z.boolean().optional().default(false).describe("Whether to recursively delete a directory"),
    }),
  }
);