# Auth plugin protocol (v1)

This document defines how the dashboard **core** Worker communicates with a **swappable auth plugin** Worker (default implementation: WebAuthn / passkeys + session cookies).

Scope is **v1** only; bump the path prefix (`/__plugin/auth/v2/…`) when breaking behavior changes.

## Deployment model (MVP)

- Core and plugin are **two Workers** deployed separately.
- Binding name on core: **`AUTH_PLUGIN`** (Cloudflare **service binding** / `Fetcher`).
- This is **not** [Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/) (runtime-spun isolates). Those remain an optional future pattern for untrusted or dynamically loaded code.

## Cookie and header forwarding

Core forwards the incoming **`Request`** to the plugin (`AUTH_PLUGIN.fetch(request)`).

The plugin:

- **May** set `Set-Cookie` for session / dev-fallback cookies on the **returned** `Response`. Core **returns that `Response` to the client** as-is (so cookies propagate).
- **Must** treat `Cookie` and other headers on the forwarded request as authoritative for login flows.

## HTTP surface (current implementation)

The default plugin serves existing dashboard JSON endpoints under **`/api/webauthn/*`**:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/webauthn/login/options` | Begin login (challenge + `challengeKey`) |
| POST | `/api/webauthn/login/verify` | Finish login; issues session cookie |
| POST | `/api/webauthn/register/options` | Begin registration |
| POST | `/api/webauthn/register/verify` | Finish registration; issues session cookie |

Request/response bodies remain JSON as implemented (see handlers). Replacements **must** preserve status codes and JSON keys consumed by the dashboard client bundles (`passkey-login.js`, `signup-invite.js`).

## Internal resolution API (future)

Optional reserved prefix for **non-browser** subrequests from core when we split session verification into the plugin:

- Example: `POST /__plugin/auth/v1/session/resolve`
- Request: subset of headers or `{ sessionToken: string }` (TBD).
- Response JSON (success): `{ user_id: string, expires_at?: string }`
- Response JSON (failure): `{ error_code: string }`

Until implemented, session resolution stays in core middleware reading D1 directly.

## Compatibility rules for alternative plugins

A replacement Worker **must**:

1. Implement the same **`/api/webauthn/*`** routes and JSON contracts **or** core must be updated to proxy a new contract version.
2. Use the same **`wana_session`** cookie semantics if sessions remain D1-backed (name, path, `httpOnly`, `SameSite`).
3. Share **`DB_CONTROL`**, **`SYSTEM_CONFIG`**, and WebAuthn-related **`vars`** when deployed (bindings mirrored on both Workers as needed).

## Versioning

- Document breaking changes in this file and in release notes.
- Prefer additive JSON fields over renaming keys.
