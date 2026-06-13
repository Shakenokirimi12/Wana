import type { QueueMessage } from "@wana/types";

/** Cloudflare Workers Rate Limiting binding (optional; enforced when present). */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  SYSTEM_CONFIG: KVNamespace;
  DB_CONTROL: D1Database;
  ERROR_QUEUE: Queue<QueueMessage>;
  /** Per-project ingest rate limiter (configured via `unsafe.bindings`). */
  INGEST_RATE_LIMITER?: RateLimitBinding;
  /** Coarse per-IP limiter applied BEFORE auth (caps invalid-key D1 amplification). */
  INGEST_IP_RATE_LIMITER?: RateLimitBinding;
}

declare module "hono" {
  interface ContextVariableMap {
    doId: string;
    projectId: string;
  }
}
