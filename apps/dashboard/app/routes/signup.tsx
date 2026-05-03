import { createRoute } from "honox/factory";

import { getInviteDetailsForAccept } from "@/data/control-plane";
import {
  getDashboardUserId,
  playgroundHref,
} from "@/lib/dashboard-user";
import { Card, PageHeader, TextLink } from "@/ui/components";
import { Shell } from "@/ui/shell";

export default createRoute(async (c) => {
  const token = c.req.query("invite")?.trim() ?? "";
  if (!token) {
    return c.redirect("/login");
  }

  const uid = getDashboardUserId(c);
  if (uid) {
    return c.redirect(`/invite/${encodeURIComponent(token)}`);
  }

  const details = await getInviteDetailsForAccept(c.env.DB_CONTROL, token);
  if (!details) {
    return c.redirect("/login");
  }

  const now = Date.now();
  const expired = details.expiresAt.getTime() <= now;
  const depleted = details.useCount >= details.maxUses;
  if (expired || depleted) {
    return c.redirect(`/invite/${encodeURIComponent(token)}`);
  }

  const pg = playgroundHref(c.env);
  const lockedEmail = details.invitedEmail?.trim() ?? "";
  const emailLocked = lockedEmail.length > 0;
  const nextPath = `/invite/${encodeURIComponent(token)}`;

  return c.render(
    <Shell title="アカウント作成" playgroundUrl={pg} auth="signed-out">
      <PageHeader
        title={`${details.orgName} — 新規アカウント`}
        description="招待を受け取り、パスキーでアカウントを作成します。既にアカウントがある場合はログインしてください。"
      />
      <Card className="max-w-lg space-y-4 p-6 sm:p-8">
        <div
          id="signup-invite-root"
          className="space-y-4"
          data-token={token}
          data-email-locked={emailLocked ? "true" : "false"}
          data-email={emailLocked ? lockedEmail : ""}
          data-next={nextPath}
        >
          {emailLocked ? (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                登録するメール（招待で指定）
              </p>
              <p className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 font-mono text-sm text-zinc-200">
                {lockedEmail}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
                メールアドレス
              </label>
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
              />
            </div>
          )}
          <p
            data-signup-status
            className="min-h-[1.25rem] text-sm text-rose-400"
          />
          <button
            type="button"
            data-action="signup-passkey"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-amber-500 px-4 text-sm font-semibold text-zinc-950 shadow-sm transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:pointer-events-none disabled:opacity-50"
          >
            パスキーでアカウントを作成
          </button>
        </div>
        <script type="module" src="/static/signup-invite.js" />

        <div className="border-t border-zinc-800/80 pt-4 text-sm text-zinc-500">
          <TextLink href={`/login?next=${encodeURIComponent(nextPath)}`}>
            既にアカウントをお持ちの方はログイン
          </TextLink>
        </div>
      </Card>
    </Shell>,
    { title: "アカウント作成 — Wana" }
  );
});
