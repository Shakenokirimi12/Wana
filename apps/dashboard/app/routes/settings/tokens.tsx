import { createRoute } from "honox/factory";
import type { Context } from "hono";

import {
  listPersonalAccessTokens,
  createPersonalAccessToken,
  revokePersonalAccessToken,
} from "@/data/control-plane";
import { getDashboardUserId } from "@/lib/dashboard-user";
import { setNewTokenFlash, takeNewTokenFlash } from "@/lib/pat-flash";
import { loadShellSidebar } from "@/lib/shell-data";
import {
  ButtonDestructiveOutline,
  ButtonPrimary,
  Card,
  InputField,
  PageHeader,
  TextLink,
} from "@/ui/components";
import { Shell } from "@/ui/shell";
import type { Env } from "../../types/bindings";

type Token = Awaited<ReturnType<typeof listPersonalAccessTokens>>[number];

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

/**
 * Shared page renderer, used only by the GET route. `opts.newToken` (when
 * present) comes from the one-time flash cookie set by the POST "create"
 * handler — see lib/pat-flash.ts. The POST handler itself always ends in a
 * redirect (PRG): reloading or resubmitting the create form's POST from
 * history can't silently mint a second token, and the plain token never
 * touches a URL / query string, where it would linger in browser history,
 * server access logs, or same-origin Referer headers.
 */
async function renderTokensPage(
  c: Context<{ Bindings: Env }>,
  uid: string,
  opts: { err?: string; newToken?: string }
) {
  const [tokens, sidebar] = await Promise.all([
    listPersonalAccessTokens(c.env.DB_CONTROL, uid),
    loadShellSidebar(c, uid),
  ]);
  // MCP_PUBLIC_URL is the Worker's base origin (matches the INGEST_PUBLIC_URL
  // convention) — the actual MCP endpoint is always POST <base>/mcp.
  const mcpEndpointUrl = c.env.MCP_PUBLIC_URL
    ? `${c.env.MCP_PUBLIC_URL.replace(/\/+$/, "")}/mcp`
    : "<wana-mcp のデプロイ先URL>/mcp";

  // A response embedding a long-lived bearer credential must never be
  // replayed from browser back-forward cache / history — "leave this screen
  // and it's gone forever" only holds if nothing caches this response.
  c.header("Cache-Control", "private, no-store");

  return c.render(
    <Shell
      currentPath="/settings/tokens"
      title="API tokens"
      auth="signed-in"
      {...sidebar}
    >
      <PageHeader
        title="APIトークン"
        description="Wana の remote MCP サーバー（Claude 等の AI エージェント連携）で使う個人アクセストークンを管理します。"
      />

      {opts.err ? (
        <Card className="mb-6 p-4">
          <p className="text-sm text-rose-400">{opts.err}</p>
        </Card>
      ) : null}

      {opts.newToken ? (
        <Card className="mb-6 border-amber-400/40 p-4">
          <p className="mb-2 text-sm font-medium text-kumo-default">
            新しいトークンを発行しました。この画面を離れると二度と表示されません。
          </p>
          <code className="block break-all rounded-md bg-kumo-base px-3 py-2 font-mono text-xs text-kumo-default">
            {opts.newToken}
          </code>
          <p className="mt-2 text-xs text-kumo-subtle">
            MCP サーバー URL: <code className="font-mono">{mcpEndpointUrl}</code>
            {" — "}
            Authorization ヘッダーに <code className="font-mono">Bearer {"<token>"}</code>{" "}
            を付けて接続してください。
          </p>
        </Card>
      ) : null}

      <Card className="mb-6 p-6">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
          新しいトークンを発行
        </h2>
        <form method="post" action="/settings/tokens" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="action" value="create" />
          <div className="min-w-[220px] flex-1">
            <InputField
              label="トークン名"
              name="name"
              required
              placeholder="例: Claude Code MCP"
            />
          </div>
          <ButtonPrimary type="submit">発行</ButtonPrimary>
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
          発行済みトークン（{tokens.length}）
        </h2>
        {tokens.length === 0 ? (
          <p className="text-sm text-kumo-subtle">まだトークンがありません。</p>
        ) : (
          <ul className="divide-y divide-kumo-hairline">
            {tokens.map((t: Token) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-kumo-default">{t.name}</p>
                  <p className="text-[11px] text-kumo-subtle">
                    <code className="font-mono">{t.hint}</code>
                    {" · 発行 "}
                    {fmtDate(t.createdAt)}
                    {" · 最終使用 "}
                    {fmtDate(t.lastUsedAt)}
                    {t.revokedAt ? ` · 失効済み (${fmtDate(t.revokedAt)})` : ""}
                  </p>
                </div>
                {t.revokedAt ? null : (
                  <form method="post" action="/settings/tokens">
                    <input type="hidden" name="action" value="revoke" />
                    <input type="hidden" name="token_id" value={t.id} />
                    <ButtonDestructiveOutline type="submit">失効</ButtonDestructiveOutline>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-8">
        <TextLink href="/settings/account">← Account settings</TextLink>
      </div>
    </Shell>,
    { title: "API tokens — Wana" }
  );
}

export default createRoute(async (c) => {
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");
  return renderTokensPage(c, uid, {
    err: c.req.query("e"),
    newToken: takeNewTokenFlash(c) ?? undefined,
  });
});

export const POST = createRoute(async (c) => {
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");
  const body = await c.req.parseBody();
  const action = String(body.action ?? "");

  if (action === "create") {
    try {
      const { plainToken } = await createPersonalAccessToken(
        c.env.DB_CONTROL,
        uid,
        String(body.name ?? "")
      );
      setNewTokenFlash(c, plainToken);
      return c.redirect("/settings/tokens");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "発行に失敗しました";
      return c.redirect(`/settings/tokens?e=${encodeURIComponent(msg)}`);
    }
  }

  if (action === "revoke") {
    await revokePersonalAccessToken(c.env.DB_CONTROL, uid, String(body.token_id ?? ""));
    return c.redirect("/settings/tokens");
  }

  return c.redirect("/settings/tokens");
});
