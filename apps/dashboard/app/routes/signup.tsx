import { createRoute } from "honox/factory";

import { getInviteDetailsForAccept, countUsers } from "@/data/control-plane";
import {
  getDashboardUserId,
  isOpenSignupEnabled,
  playgroundHref,
} from "@/lib/dashboard-user";
import { Card, PageHeader, TextLink } from "@/ui/components";
import { Shell } from "@/ui/shell";

export default createRoute(async (c) => {
  const token = c.req.query("invite")?.trim() ?? "";
  const uid = getDashboardUserId(c);

  let details: Awaited<ReturnType<typeof getInviteDetailsForAccept>> = null;
  let isFirstUser = false;
  let isOpenSignup = false;

  if (!token) {
    // 招待トークンがない場合: ユーザーが0人なら初回管理者登録、
    // それ以外でセルフ登録が有効ならオープンサインアップ、どちらでもなければログインへ。
    const userCount = await countUsers(c.env.DB_CONTROL);
    const synthetic = {
      orgName: "",
      invitedEmail: "",
      orgSlug: "",
      inviteId: "bootstrap",
      orgId: "bootstrap",
      role: "admin" as const,
      expiresAt: new Date(Date.now() + 3600000),
      maxUses: 1,
      useCount: 0,
      invitedUsername: null,
    };
    if (userCount === 0) {
      isFirstUser = true;
      details = { ...synthetic, orgName: "First Team", orgSlug: "first-team" };
    } else if (isOpenSignupEnabled(c.env)) {
      isOpenSignup = true;
      details = { ...synthetic, role: "member" as const };
    } else {
      return c.redirect("/login");
    }
  } else {
    if (uid) {
      return c.redirect(`/invite/${encodeURIComponent(token)}`);
    }
    details = await getInviteDetailsForAccept(c.env.DB_CONTROL, token);
  }

  if (!details) {
    return c.redirect("/login");
  }

  const now = Date.now();
  const expired = details.expiresAt.getTime() <= now;
  const depleted = details.useCount >= details.maxUses;
  if (!isFirstUser && !isOpenSignup && (expired || depleted)) {
    return c.redirect(`/invite/${encodeURIComponent(token)}`);
  }

  const pg = playgroundHref(c.env);
  const lockedEmail = details.invitedEmail?.trim() ?? "";
  const emailLocked = lockedEmail.length > 0;
  // JS 側に渡すトークン: 初回は bootstrap-token、オープンは open-signup、招待は token。
  const effectiveToken = isFirstUser
    ? "bootstrap-token"
    : isOpenSignup
      ? "open-signup"
      : token;
  // 登録後の遷移先: 初回はトップ、オープンは最初のチーム作成、招待は受諾ページ。
  const nextPath = isFirstUser
    ? "/"
    : isOpenSignup
      ? "/onboarding/create-team"
      : `/invite/${encodeURIComponent(token)}`;

  const headerTitle = isFirstUser
    ? "Wana へようこそ"
    : isOpenSignup
      ? "アカウントを作成"
      : `${details.orgName} — 新規アカウント`;
  const headerDesc = isFirstUser
    ? "最初の管理者アカウントを作成します。メールアドレスを入力してパスキーを登録してください。"
    : isOpenSignup
      ? "メールアドレスを入力してパスキーでアカウントを作成します。作成後、最初のチームを作ります。"
      : "招待を受け取り、パスキーでアカウントを作成します。既にアカウントがある場合はログインしてください。";

  return c.render(
    <Shell title={isFirstUser ? "管理者登録" : "アカウント作成"} playgroundUrl={pg} auth="signed-out">
      <PageHeader title={headerTitle} description={headerDesc} />
      <Card className="max-w-lg space-y-4 p-6 sm:p-8">
        <div
          id="signup-invite-root"
          className="space-y-4"
          data-token={effectiveToken}
          data-email-locked={emailLocked ? "true" : "false"}
          data-email={emailLocked ? lockedEmail : ""}
          data-next={nextPath}
        >
          {emailLocked ? (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-kumo-subtle">
                登録するメール（招待で指定）
              </p>
              <p className="rounded-lg border border-kumo-hairline bg-kumo-recessed px-3 py-2 font-mono text-sm text-kumo-default">
                {lockedEmail}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs font-medium uppercase tracking-wider text-kumo-subtle">
                メールアドレス
              </label>
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full rounded-lg border border-kumo-hairline bg-kumo-recessed px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
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

        <div className="border-t border-kumo-hairline pt-4 text-sm text-kumo-subtle">
          <TextLink href={`/login?next=${encodeURIComponent(nextPath)}`}>
            既にアカウントをお持ちの方はログイン
          </TextLink>
        </div>
      </Card>
    </Shell>,
    { title: "アカウント作成 — Wana" }
  );
});
