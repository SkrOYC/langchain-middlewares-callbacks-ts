/**
 * Search Tool
 * 
 * Mock implementation of grep/search operations.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { mockFileSystem, listMockFiles } from "./readFile.js";

/**
 * Search result type
 */
interface SearchResult {
  file: string;
  lineNumber: number;
  line: string;
  match: string;
}

/**
 * Mock search results for common queries
 */
const mockSearchResults: Map<string, SearchResult[]> = new Map([
  ["main", [
    { file: "src/index.ts", lineNumber: 3, line: "export function main() {", match: "main" },
    { file: "src/utils.ts", lineNumber: 5, line: "export function capitalize(str: string): string {", match: "main" },
  ]],
  ["function", [
    { file: "src/index.ts", lineNumber: 3, line: "export function main() {", match: "function" },
    { file: "src/utils.ts", lineNumber: 3, line: "export function formatDate(date: Date): string {", match: "function" },
    { file: "src/utils.ts", lineNumber: 8, line: "export function capitalize(str: string): string {", match: "function" },
  ]],
  ["Hello", [
    { file: "src/index.ts", lineNumber: 5, line: "console.log('Hello, World!');", match: "Hello" },
  ]],
]);

/**
 * Perform a mock grep/search operation
 */
async function searchFiles(query: string, options?: {
  caseSensitive?: boolean;
  useRegex?: boolean;
  filePattern?: string;
}): Promise<SearchResult[]> {
  const { caseSensitive = false, useRegex = false, filePattern = "*" } = options || {};
  
  // Check for mock results first
  const searchKey = `${query}:${caseSensitive}:${useRegex}:${filePattern}`;
  if (mockSearchResults.has(searchKey)) {
    return mockSearchResults.get(searchKey)!;
  }
  
  // If query is in our mock results without options, return that
  if (mockSearchResults.has(query)) {
    return mockSearchResults.get(query)!;
  }
  
  // Perform actual search on mock file system
  const results: SearchResult[] = [];
  const files = listMockFiles();
  
  // Filter files by pattern
  const filteredFiles = files.filter((file) => {
    if (filePattern === "*") return true;
    return file.includes(filePattern.replace("*", ""));
  });
  
  for (const file of filteredFiles) {
    const content = mockFileSystem.get(file) || "";
    const lines = content.split("\n");
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let matches = false;
      
      if (useRegex) {
        try {
          const regex = caseSensitive 
            ? new RegExp(query) 
            : new RegExp(query, "i");
          matches = regex.test(line);
        } catch {
          matches = line.includes(query);
        }
      } else {
        matches = caseSensitive 
          ? line.includes(query) 
          : line.toLowerCase().includes(query.toLowerCase());
      }
      
      if (matches) {
        // Extract the matching part
        let match = query;
        if (useRegex) {
          try {
            const regex = caseSensitive 
              ? new RegExp(query) 
              : new RegExp(query, "i");
            const matchResult = line.match(regex);
            match = matchResult ? matchResult[0] : query;
          } catch {
            match = query;
          }
        }
        
        results.push({
          file,
          lineNumber: i + 1,
          line: line.trim(),
          match,
        });
      }
    }
  }
  
  return results;
}

/**
 * Get mock search results
 */
export function getMockSearchResults(): Map<string, SearchResult[]> {
  return new Map(mockSearchResults);
}

/**
 * Set mock search results
 */
export function setMockSearchResults(query: string, results: SearchResult[]): void {
  mockSearchResults.set(query, results);
}

/**
 * Clear mock search results
 */
export function clearMockSearchResults(): void {
  mockSearchResults.clear();
}

/**
 * Search Tool
 * 
 * Searches for text in files within the simulated file system.
 */
export const searchTool = tool(
  async ({ query, caseSensitive = false, useRegex = false, filePattern = "*" }: {
    query: string;
    caseSensitive?: boolean;
    useRegex?: boolean;
    filePattern?: string;
  }) => {
    try {
      const results = await searchFiles(query, {
        caseSensitive,
        useRegex,
        filePattern,
      });
      
      if (results.length === 0) {
        return `No matches found for "${query}"`;
      }
      
      // Format results
      let output = `Found ${results.length} match(es) for "${query}":\n\n`;
      
      for (const result of results) {
        output += `${result.file}:${result.lineNumber}: ${result.line}\n`;
      }
      
      return output.trim();
    } catch (error) {
      return `Error searching: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "search",
    description: "Search for text in files within the simulated file system",
    schema: z.object({
      query: z.string().describe("The search query or pattern"),
      caseSensitive: z.boolean().optional().default(false).describe("Whether the search is case sensitive"),
      useRegex: z.boolean().optional().default(false).describe("Whether the query is a regular expression"),
      filePattern: z.string().optional().default("*").describe("File pattern to search in"),
    }),
  }
);

/**
 * List Files Tool (bonus)
 */
export const listFilesTool = tool(
  async ({ path = ".", pattern = "*" }: {
    path?: string;
    pattern?: string;
  }) => {
    try {
      const files = listMockFiles();
      const filteredFiles = files.filter((file) => {
        if (path !== "." && !file.startsWith(path)) return false;
        if (pattern !== "*" && !file.includes(pattern.replace("*", ""))) return false;
        return true;
      });
      
      if (filteredFiles.length === 0) {
        return `No files found in ${path}`;
      }
      
      return `Files in ${path}:\n${filteredFiles.join("\n")}`;
    } catch (error) {
      return `Error listing files: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "list_files",
    description: "List files in the simulated file system",
    schema: z.object({
      path: z.string().optional().default(".").describe("The directory path to list"),
      pattern: z.string().optional().default("*").describe("File name pattern to match"),
    }),
  }
);