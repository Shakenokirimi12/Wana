import type {
  DurableObjectNamespace,
  SendEmail,
} from "@cloudflare/workers-types";

import type { ProjectDataStore } from "@wana/worker/project-store";

/** Cloudflare bindings for the dashboard Worker (Pages Functions). */
export type Env = {
  SYSTEM_CONFIG: KVNamespace;
  DB_CONTROL: D1Database;
  PAYLOAD_STORAGE: R2Bucket;
  PROJECT_DO: DurableObjectNamespace<ProjectDataStore>;
  /**
   * Workers Container running llvm-symbolizer. Lives in `wana-worker`;
   * we bind to it from Pages via `script_name`. Call it through
   * `env.SYMBOLICATOR.getByName(<uuid>)` so warm instances re-use the same
   * dSYM pages.
   */
  SYMBOLICATOR: DurableObjectNamespace<import("@wana/worker/symbolicator").Symbolicator>;
  /** Cloudflare Email Sending — optional until domain is onboarded. */
  SEND_MAIL?: SendEmail;
  /** Public ingest origin for DSN display (no trailing slash). */
  INGEST_PUBLIC_URL?: string;
  /**
   * When `"true"` or `"1"`, use `DASHBOARD_USER_ID` if no valid session cookie.
   * Omit or set false in production; use real sessions + passkeys only.
   */
  DASHBOARD_DEV_FALLBACK?: string;
  /** Control-plane user id used only when `DASHBOARD_DEV_FALLBACK` is enabled. */
  DASHBOARD_USER_ID?: string;
  /** Default From: address for `SEND_MAIL` (verified domain in Cloudflare Email). */
  MAIL_FROM?: string;
  /** Optional footer link to @wana/sentry-playground (e.g. http://127.0.0.1:8790). */
  SENTRY_PLAYGROUND_URL?: string;
  /**
   * When `"true"`, do not redirect `http://127.0.0.1` → `http://localhost` (for rare debugging only).
   * Default: redirect so WebAuthn uses hostname `localhost`.
   */
  DASHBOARD_DISABLE_LOOPBACK_REDIRECT?: string;

  /** WebAuthn RP ID (defaults to request hostname). Use `localhost` if you browse via http://localhost:* . */
  WEBAUTHN_RP_ID?: string;
  /** Override origin for WebAuthn verification (defaults to request origin). */
  WEBAUTHN_ORIGIN?: string;
  /** Human-readable RP name shown by authenticators. */
  WEBAUTHN_RP_NAME?: string;
  /**
   * When `"true"`, allow registering a passkey using email only (existing user).
   * Disable in production unless combined with stronger account proof.
   */
  WEBAUTHN_ALLOW_EMAIL_ENROLLMENT?: string;

  /** When "true", anyone may self-register an account (open signup). Default off. */
  ALLOW_OPEN_SIGNUP?: string;

  /**
   * Optional service binding to the WebAuthn auth plugin Worker (`plugins/webauthn-worker`).
   * When absent, the dashboard runs the same handlers in-process via `@wana/auth-plugin-handlers`.
   */
  AUTH_PLUGIN?: Fetcher;

  /**
   * KEK (base64 32 bytes) for decrypting webhook secrets when the dashboard
   * fires a TEST send. Production deliveries originate in wana-worker; this
   * is only for operator-initiated tests from the Notifications UI.
   */
  WEBHOOK_KEK_V1?: string;

  // NOTE: SEND_MAIL is intentionally NOT on the dashboard. Pages
  // configuration does not accept `send_email`; the worker handles all
  // mail. See apps/worker/src/notifications/email-sender.ts.

  /**
   * Service binding to wana-worker. Used for invite-email delivery via
   * POST /__internal/send-mail. See `apps/dashboard/app/lib/email.ts`.
   */
  MAIL_SERVICE?: Fetcher;
  /**
   * Shared secret authenticating the dashboard's calls to the worker's
   * /__internal/send-mail endpoint. Must match the same value set on
   * wana-worker via `wrangler secret put INTERNAL_RPC_SECRET`.
   */
  INTERNAL_RPC_SECRET?: string;
};
