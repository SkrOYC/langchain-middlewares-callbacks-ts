/**
 * Bash Tool
 * 
 * Mock implementation of terminal command execution.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Mock command results for common commands
 */
const mockCommandResults: Map<string, { stdout: string; stderr: string; code: number }> = new Map([
  ["ls -la", {
    stdout: `total 16
drwxr-xr-x  5 user  staff  160 Jan 15 10:30 .
drwxr-xr-x  3 user  staff   96 Jan 15 10:30 src
-rw-r--r--  1 user  staff   45 Jan 15 10:30 README.md
-rw-r--r--  1 user  staff  120 Jan 15 10:30 package.json`,
    stderr: "",
    code: 0,
  }],
  ["ls src", {
    stdout: "index.ts\nutils.ts\n",
    stderr: "",
    code: 0,
  }],
  ["pwd", {
    stdout: "/Users/example/project",
    stderr: "",
    code: 0,
  }],
  ["echo 'Hello, World!'", {
    stdout: "Hello, World!\n",
    stderr: "",
    code: 0,
  }],
  ["cat package.json", {
    stdout: `{
  "name": "example",
  "version": "1.0.0",
  "main": "index.ts"
}`,
    stderr: "",
    code: 0,
  }],
  ["npm install", {
    stdout: `added 127 packages, and audited 128 packages in 2s`,
    stderr: "",
    code: 0,
  }],
  ["npm run build", {
    stdout: `> example@1.0.0 build
> tsc
✨  Done in 1.2s`,
    stderr: "",
    code: 0,
  }],
  ["git status", {
    stdout: `On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean`,
    stderr: "",
    code: 0,
  }],
  ["git log --oneline -5", {
    stdout: `abc1234 Add new feature
def5678 Fix bug in agent
ghi9012 Update documentation
jkl3456 Refactor code structure
mno6789 Initial commit`,
    stderr: "",
    code: 0,
  }],
]);

/**
 * Command history
 */
const commandHistory: Array<{
  timestamp: Date;
  command: string;
  result: { stdout: string; stderr: string; code: number };
}> = [];

/**
 * Execute a mock bash command
 */
async function executeBash(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  // Track the command
  const timestamp = new Date();
  
  // Check for mock result
  if (mockCommandResults.has(command)) {
    const result = mockCommandResults.get(command)!;
    commandHistory.push({ timestamp, command, result });
    return result;
  }
  
  // Generate mock response for unknown commands
  const result = generateMockResponse(command);
  commandHistory.push({ timestamp, command, result });
  return result;
}

/**
 * Generate a mock response for unknown commands
 */
function generateMockResponse(command: string): { stdout: string; stderr: string; code: number } {
  const trimmedCommand = command.trim().toLowerCase();
  
  // Simulate some common patterns
  if (trimmedCommand.startsWith("ls")) {
    return {
      stdout: "file1.ts\nfile2.ts\nfile3.ts\n",
      stderr: "",
      code: 0,
    };
  }
  
  if (trimmedCommand.startsWith("cat ")) {
    return {
      stdout: `Content of ${command.split(" ")[1] || "file"}\n`,
      stderr: "",
      code: 0,
    };
  }
  
  if (trimmedCommand.startsWith("echo ")) {
    return {
      stdout: command.substring(5) + "\n",
      stderr: "",
      code: 0,
    };
  }
  
  if (trimmedCommand.includes("not found") || trimmedCommand.includes("command not found")) {
    return {
      stdout: "",
      stderr: `command not found: ${command}`,
      code: 127,
    };
  }
  
  // Default response
  return {
    stdout: `Executed: ${command}\n`,
    stderr: "",
    code: 0,
  };
}

/**
 * Get command history
 */
export function getCommandHistory(): Array<{
  timestamp: Date;
  command: string;
  result: { stdout: string; stderr: string; code: number };
}> {
  return [...commandHistory];
}

/**
 * Clear command history
 */
export function clearCommandHistory(): void {
  commandHistory.length = 0;
}

/**
 * Add a mock command result
 */
export function addMockCommandResult(
  command: string,
  result: { stdout: string; stderr: string; code: number }
): void {
  mockCommandResults.set(command, result);
}

/**
 * Clear all mock command results
 */
export function clearMockCommandResults(): void {
  mockCommandResults.clear();
}

/**
 * Bash Tool
 * 
 * Executes a bash command in the mock terminal environment.
 */
export const bashTool = tool(
  async ({ command }: { command: string }) => {
    try {
      const result = await executeBash(command);
      
      // Format the output
      let output = "";
      
      if (result.stdout) {
        output += result.stdout;
      }
      
      if (result.stderr) {
        output += `\nError: ${result.stderr}`;
      }
      
      if (result.code !== 0) {
        output += `\nExit code: ${result.code}`;
      }
      
      return output.trim() || `Command executed with exit code: ${result.code}`;
    } catch (error) {
      return `Error executing command: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "bash",
    description: "Execute a bash command in the mock terminal environment",
    schema: z.object({
      command: z.string().describe("The bash command to execute"),
    }),
  }
);