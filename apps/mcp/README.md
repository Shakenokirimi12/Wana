# @wana/mcp

Remote MCP server for Wana. Lets AI agents (Claude Code, claude.ai custom connectors, etc.)
search and act on error issues over the network via the
[MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http).

## Auth

Bearer-token auth using **personal access tokens**, issued from the dashboard at
`/settings/tokens`. A token carries no scopes of its own — a request authenticated with
one can reach exactly the orgs/projects that user can already see in the dashboard
(checked per-tool via `organization_members`).

```
POST /mcp
Authorization: Bearer wana_pat_...
```

There is no OAuth flow — add the server as a custom MCP connector with a static bearer
token header (Claude Code: `claude mcp add --transport http wana <url>/mcp --header
"Authorization: Bearer <token>"`).

## Tools

| Tool | Effect |
|---|---|
| `list_projects` | List every project the caller can access, across all their orgs. |
| `search_issues` | Search a project's issues (Sentry-style query syntax, status filter). |
| `get_issue` | Full detail for one issue: metadata, latest event's exception/stacktrace/tags, recent activity. |
| `update_issue_status` | Resolve / ignore / re-open an issue. |
| `add_issue_comment` | Post a comment on an issue's timeline. |

Frame data in `get_issue` is **not** dSYM-symbolicated (that merge lives in the dashboard
route only) — good enough for JS/TS stacks; native (iOS/Android) frames come back as raw
addresses.

## Dev

```bash
pnpm --filter @wana/mcp dev   # http://127.0.0.1:8791
```

Needs the same `DB_CONTROL` D1 (apply `packages/schema/migrations/*`) and a running
`wana-worker` (for the cross-Worker `PROJECT_DO` binding) as the dashboard — see the repo
root README's local-dev section. Not currently wired into `pnpm preview` /
`scripts/preview-stack.sh`.

## Deploy

```bash
pnpm --filter @wana/mcp deploy
```

Set `vars.MCP_PUBLIC_URL` in `wrangler.jsonc` to the Worker's public URL (custom domain or
`*.workers.dev`) once provisioned — it's only used to echo the endpoint back on the
dashboard's tokens page, not for routing.
