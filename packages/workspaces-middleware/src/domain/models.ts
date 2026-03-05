import type { StorePort } from "@/domain/store-port";

export type AccessScope = "READ_ONLY" | "READ_WRITE" | "WRITE_ONLY";

export interface Mount {
  prefix: string;
  scope: AccessScope;
}

export interface Workspace extends Mount {
  store: StorePort;
}
