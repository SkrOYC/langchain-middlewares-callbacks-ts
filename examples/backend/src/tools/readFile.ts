/**
 * Read File Tool
 * 
 * Mock implementation of a file reading tool with configurable content.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Simulated file system content
 */
export const mockFileSystem: Map<string, string> = new Map([
  ["src/index.ts", `/**
 * Main entry point
 */
export function main() {
  console.log("Hello, World!");
}`],
  ["src/utils.ts", `/**
 * Utility functions
 */
export function formatDate(date: Date): string {
  return date.toISOString();
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}`],
  ["README.md", `# Zed Backend Example

This is an example backend for Zed editor using ACP protocol.

## Features

- File operations
- Terminal commands
- Search functionality
- And more...
`],
  ["package.json", `{
  "name": "example",
  "version": "1.0.0",
  "main": "index.ts"
}`],
]);

/**
 * Read file content from the simulated file system
 */
export async function readFile(path: string): Promise<string> {
  // Normalize path
  const normalizedPath = path.replace(/^\.\//, "");
  
  // Check if file exists
  if (!mockFileSystem.has(normalizedPath)) {
    throw new Error(`File not found: ${path}`);
  }
  
  return mockFileSystem.get(normalizedPath)!;
}

/**
 * Add or update a file in the simulated file system
 */
export function setMockFileContent(path: string, content: string): void {
  mockFileSystem.set(path, content);
}

/**
 * Clear the simulated file system
 */
export function clearMockFileSystem(): void {
  mockFileSystem.clear();
}

/**
 * List all files in the simulated file system
 */
export function listMockFiles(): string[] {
  return Array.from(mockFileSystem.keys());
}

/**
 * Read File Tool
 * 
 * Reads content from a file in the simulated file system.
 */
export const readFileTool = tool(
  async ({ path }: { path: string }) => {
    try {
      const content = await readFile(path);
      return `File: ${path}\n\n${content}`;
    } catch (error) {
      return `Error reading file: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "read_file",
    description: "Read the contents of a file from the simulated file system",
    schema: z.object({
      path: z.string().describe("The path to the file to read"),
    }),
  }
);