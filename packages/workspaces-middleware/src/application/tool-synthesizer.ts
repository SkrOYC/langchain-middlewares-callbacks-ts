import { authorizeOperation, isOperationAllowed } from "@/domain/access-guard";
import { AccessDeniedError } from "@/domain/errors";
import type { AccessScope, Workspace } from "@/domain/models";
import { resolveWorkspace } from "@/domain/vfs-router";
import { PhysicalStoreAdapter } from "@/infrastructure/physical-store";
import {
  type BaseStoreLike,
  VirtualStoreAdapter,
} from "@/infrastructure/virtual-store";
import type {
  MountConfig,
  OperationType,
  RegisteredTool,
  VFSResolution,
  VFSServices,
} from "@/presentation/index";

const ALL_OPERATION_TYPES: OperationType[] = [
  "read",
  "write",
  "edit",
  "list",
  "search",
];

interface PreparedWorkspace {
  mount: MountConfig;
  workspace: Workspace;
}

interface CachedResolution {
  mount: MountConfig;
  normalizedKey: string;
  normalizedLogicalPath: string;
  scope: AccessScope;
  workspace: Workspace;
}

export interface VFSServicesBuildOptions {
  virtualStore?: BaseStoreLike;
}

export function synthesizeSafeTools(
  mounts: MountConfig[],
  tools: RegisteredTool[]
): RegisteredTool[] {
  if (mounts.length === 0) {
    return [];
  }

  const allowedOperations = getAggregateAllowedOperations(mounts);
  return tools.filter((tool) =>
    tool.operations.every((operation) => allowedOperations.has(operation))
  );
}

export function buildVFSServices(
  mounts: MountConfig[],
  options: VFSServicesBuildOptions = {}
): VFSServices {
  const prepared = prepareWorkspaces(mounts, options);
  const mountByWorkspace = new Map<Workspace, MountConfig>();

  for (const item of prepared) {
    mountByWorkspace.set(item.workspace, item.mount);
  }

  const workspaceList = prepared.map((item) => item.workspace);
  const resolutionCache = new Map<string, CachedResolution>();

  const resolveFromPath = (path: string): CachedResolution => {
    const resolved = resolveWorkspace(path, workspaceList);
    const mount = mountByWorkspace.get(resolved.workspace);

    if (mount === undefined) {
      throw new AccessDeniedError("Resolved workspace is not registered");
    }

    const cached: CachedResolution = {
      mount,
      normalizedKey: resolved.normalizedKey,
      normalizedLogicalPath: resolved.normalizedLogicalPath,
      scope: resolved.scope,
      workspace: resolved.workspace,
    };

    cacheResolution(resolutionCache, cached);
    return cached;
  };

  const resolveForOperation = (pathOrKey: string): CachedResolution => {
    const cached = resolutionCache.get(pathOrKey);
    if (cached !== undefined) {
      return cached;
    }

    return resolveFromPath(pathOrKey);
  };

  return {
    resolve(path: string): VFSResolution {
      const resolved = resolveFromPath(path);

      return {
        mount: resolved.mount,
        normalizedKey: resolved.normalizedKey,
        scope: resolved.scope,
      };
    },

    async read(key: string): Promise<string> {
      const resolved = resolveForOperation(key);
      authorizeOperation("read", resolved.scope);
      return await resolved.workspace.store.read(resolved.normalizedKey);
    },

    async write(key: string, content: string): Promise<void> {
      const resolved = resolveForOperation(key);
      authorizeOperation("write", resolved.scope);
      await resolved.workspace.store.write(resolved.normalizedKey, content);
    },

    async list(key: string): Promise<string[]> {
      const resolved = resolveForOperation(key);
      authorizeOperation("list", resolved.scope);
      return await resolved.workspace.store.list(resolved.normalizedKey);
    },

    async stat(key: string) {
      const resolved = resolveForOperation(key);
      authorizeOperation("read", resolved.scope);
      return await resolved.workspace.store.stat(resolved.normalizedKey);
    },
  };
}

function getAggregateAllowedOperations(
  mounts: MountConfig[]
): Set<OperationType> {
  const allowed = new Set<OperationType>();

  for (const mount of mounts) {
    for (const operation of ALL_OPERATION_TYPES) {
      if (isOperationAllowed(operation, mount.scope)) {
        allowed.add(operation);
      }
    }
  }

  return allowed;
}

function prepareWorkspaces(
  mounts: MountConfig[],
  options: VFSServicesBuildOptions
): PreparedWorkspace[] {
  const virtualStore = options.virtualStore ?? createInMemoryBaseStore();

  return mounts.map((mount) => {
    const store =
      mount.store.type === "physical"
        ? new PhysicalStoreAdapter(mount.store.rootDir)
        : new VirtualStoreAdapter(virtualStore, mount.store.namespace);

    return {
      mount,
      workspace: {
        prefix: mount.prefix,
        scope: mount.scope,
        store,
      },
    };
  });
}

function cacheResolution(
  cache: Map<string, CachedResolution>,
  resolution: CachedResolution
): void {
  cache.set(resolution.normalizedLogicalPath, resolution);
  cache.set(resolution.normalizedKey, resolution);
}

export function createInMemoryBaseStore(): BaseStoreLike {
  const data = new Map<string, string>();

  return {
    mget(keys: string[]): Promise<(string | undefined)[]> {
      return Promise.resolve(keys.map((key) => data.get(key)));
    },

    mset(keyValuePairs: [string, string][]): Promise<void> {
      for (const [key, value] of keyValuePairs) {
        data.set(key, value);
      }

      return Promise.resolve();
    },

    mdelete(keys: string[]): Promise<void> {
      for (const key of keys) {
        data.delete(key);
      }

      return Promise.resolve();
    },

    async *yieldKeys(prefix?: string): AsyncGenerator<string, void, unknown> {
      await Promise.resolve();

      for (const key of data.keys()) {
        if (prefix === undefined || key.startsWith(prefix)) {
          yield key;
        }
      }
    },
  };
}
