import type { QueueMessage } from "@wana/types";

export interface Env {
  SYSTEM_CONFIG: KVNamespace;
  DB_CONTROL: D1Database;
  ERROR_QUEUE: Queue<QueueMessage>;
}

declare module "hono" {
  interface ContextVariableMap {
    doId: string;
    projectId: string;
  }
}
