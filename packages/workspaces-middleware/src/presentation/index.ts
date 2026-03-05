import type { ZodSchema } from "zod";

import type { AccessScope as DomainAccessScope } from "@/domain/models";
import { createWorkspacesMiddleware as createWorkspacesMiddlewareImpl } from "@/presentation/middleware";

export type AccessScope = DomainAccessScope;

export interface PhysicalStoreConfig {
  type: "physical";
  rootDir: string;
}

export interface VirtualStoreConfig {
  type: "virtual";
  namespace: string[];
}

export type StoreConfig = PhysicalStoreConfig | VirtualStoreConfig;

export interface MountConfig {
  prefix: string;
  scope: AccessScope;
  store: StoreConfig;
}

export interface FileMetadata {
  exists: boolean;
  isDirectory: boolean;
  size?: number;
  modified?: Date;
}

export interface VFSResolution {
  mount: MountConfig;
  normalizedKey: string;
  scope: AccessScope;
}

export interface VFSServices {
  resolve(path: string): VFSResolution;
  read(key: string): Promise<string>;
  write(key: string, content: string): Promise<void>;
  list(key: string): Promise<string[]>;
  stat(key: string): Promise<FileMetadata>;
}

export type OperationType = "read" | "write" | "edit" | "list" | "search";

export interface ToolResult {
  content: string;
  metadata?: {
    operation?: OperationType;
    filesModified?: string[];
    filesRead?: string[];
  };
}

export interface RegisteredTool {
  name: string;
  description: string;
  parameters: ZodSchema;
  operations: OperationType[];
  handler: (params: unknown, services: VFSServices) => Promise<ToolResult>;
}

export interface WorkspacesMiddlewareOptions {
  mounts: MountConfig[];
  tools: RegisteredTool[];
}

export const createWorkspacesMiddleware = createWorkspacesMiddlewareImpl;
