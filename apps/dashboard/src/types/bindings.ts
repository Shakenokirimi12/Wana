import type { DurableObjectNamespace } from "@cloudflare/workers-types";

import type { ProjectDataStore } from "@wana/worker/project-store";

/** Cloudflare bindings for the dashboard Worker (Pages Functions). */
export type Env = {
  SYSTEM_CONFIG: KVNamespace;
  DB_CONTROL: D1Database;
  PAYLOAD_STORAGE: R2Bucket;
  PROJECT_DO: DurableObjectNamespace<ProjectDataStore>;
  /** Public ingest origin for DSN display (no trailing slash). */
  INGEST_PUBLIC_URL?: string;
  /** Control-plane user id for project listing (local default: seed user_01). */
  DASHBOARD_USER_ID?: string;
  /** Optional footer link to @wana/sentry-playground (e.g. http://127.0.0.1:8790). */
  SENTRY_PLAYGROUND_URL?: string;
};
