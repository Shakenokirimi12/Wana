import type { QueueMessage } from "@wana/types";

export interface Env {
  SYSTEM_CONFIG: KVNamespace;
  PAYLOAD_STORAGE: R2Bucket;
  PROJECT_DO: DurableObjectNamespace<ProjectDataStore>;
  /** Control-plane D1 — added in P1 notifications so the dispatcher can read rules. */
  DB_CONTROL: D1Database;
  /** Public URL of the dashboard; used to build `dashboard_url` in webhook payloads. */
  DASHBOARD_PUBLIC_URL?: string;
  /**
   * 32-byte base64 secret used as an AES-GCM KEK to encrypt webhook signing
   * secrets at rest. Set with `wrangler secret put WEBHOOK_KEK_V1`.
   */
  WEBHOOK_KEK_V1?: string;
  /** Cloudflare Email Sending binding for email notification deliveries. */
  SEND_MAIL?: {
    send(message: import("cloudflare:email").EmailMessage): Promise<void>;
  };
  /** From: address used by SEND_MAIL (must be on a verified domain). */
  MAIL_FROM?: string;
  /**
   * Shared secret authenticating internal RPC traffic from the dashboard
   * (e.g. the invite email send-mail endpoint). Same value set on both
   * wana-worker and wana-dashboard via `wrangler secret put`.
   */
  INTERNAL_RPC_SECRET?: string;
  /**
   * Workers Container running llvm-symbolizer for dSYM-based symbolication.
   * Bound here, exposed to the dashboard via a fetch RPC endpoint so the
   * dashboard doesn't need its own container binding.
   */
  SYMBOLICATOR: DurableObjectNamespace<Symbolicator>;
}

import type { ProjectDataStore } from "./do/ProjectDataStore";
import type { Symbolicator } from "./do/Symbolicator";
