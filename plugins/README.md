# Plugins (`plugins/`)

Deployable Workers that extend or replace parts of the platform. **`apps/`** holds user-facing apps; **`plugins/`** holds **Worker-shaped** packages (their own `wrangler` project).

## Default auth plugin — `webauthn-worker`

- **Role**: WebAuthn / passkey APIs and session cookie issuance for those flows.
- **Binding on dashboard**: `AUTH_PLUGIN` → service binding to this Worker’s script name (see [`apps/dashboard/wrangler.jsonc`](../apps/dashboard/wrangler.jsonc)).
- **Shared implementation**: [`packages/auth-plugin-handlers`](../packages/auth-plugin-handlers/) builds the Hono app used by both the dashboard (in-process fallback) and this Worker.

### Wrangler / local dev

1. Build handlers package: `pnpm --filter @wana/auth-plugin-handlers exec tsc --noEmit` (typecheck from repo root as needed).
2. Run the plugin worker: `pnpm --filter @wana/webauthn-worker dev` (script TBD in package — use `wrangler dev` in `plugins/webauthn-worker`).
3. Run dashboard with binding: configure `services` in dashboard wrangler so `AUTH_PLUGIN` points at the dev worker URL/script.

When **`AUTH_PLUGIN` is unset** (e.g. some preview setups), the dashboard invokes the same handler code **in-process** so passkeys keep working without a second process.

### Relationship to Dynamic Workers

[Cloudflare Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/) spin up isolates **at runtime** for sandboxed, on-demand code. This repo’s MVP uses **two static Workers + service bindings**. Dynamic Workers are reserved for future cases (e.g. untrusted uploaded plugins).

### Protocol

See [`docs/auth-plugin-protocol.md`](../docs/auth-plugin-protocol.md).
