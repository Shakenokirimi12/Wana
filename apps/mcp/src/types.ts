import type { ProjectDataStore } from "@wana/worker/project-store";

export interface Env {
  DB_CONTROL: D1Database;
  PAYLOAD_STORAGE: R2Bucket;
  PROJECT_DO: DurableObjectNamespace<ProjectDataStore>;
  /** Public URL of this Worker, echoed back in tool responses. */
  MCP_PUBLIC_URL?: string;
}

declare module "hono" {
  interface ContextVariableMap {
    /** Control-plane user id resolved from the request's PAT. */
    userId: string;
  }
}
