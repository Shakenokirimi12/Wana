import { createRoute } from "honox/factory";

import {
  getDashboardUserId,
  isDashboardDevFallback,
  isWebAuthnEmailEnrollmentEnabled,
  playgroundHref,
} from "@/lib/dashboard-user";
import {
  ButtonPrimary,
  ButtonSecondary,
  Card,
  PageHeader,
  TextLink,
} from "@/ui/components";
import { Shell } from "@/ui/shell";

function safeNextPath(raw: string | undefined): string | undefined {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return undefined;
  }
  return raw;
}

export default createRoute(async (c) => {
  const uid = getDashboardUserId(c);
  const next = safeNextPath(c.req.query("next"));
  if (uid) {
    return c.redirect(next ?? "/");
  }
  const pg = playgroundHref(c.env);
  const devFb = isDashboardDevFallback(c.env);
  const enrollment = isWebAuthnEmailEnrollmentEnabled(c.env);
  const nextAttr = next ?? "/";

  return c.render(
    <Shell title="Sign in" playgroundUrl={pg} auth="hidden">
      <PageHeader
        title="ログイン"
        description="メールアドレスを入力し、パスキー（WebAuthn）でサインインします。未登録の場合は「パスキーを登録」で初回登録できます（ローカルでは WEBAUTHN_ALLOW_EMAIL_ENROLLMENT を有効にしています）。"
      />
      <Card className="max-w-lg space-y-4 p-6 sm:p-8">
        <div
          id="passkey-login-root"
          className="space-y-4"
          data-enrollment={enrollment ? "true" : "false"}
          data-next={nextAttr}
        >
          <div className="space-y-2">
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
              メールアドレス
            </label>
            <input
              name="email"
              type="email"
              autoComplete="username webauthn"
              placeholder="you@example.com"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
            />
          </div>
          <p
            data-passkey-status
            className="min-h-[1.25rem] text-sm text-rose-400"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <ButtonPrimary type="button" data-action="passkey-login">
              パスキーでサインイン
            </ButtonPrimary>
            {enrollment ? (
              <ButtonSecondary type="button" data-action="passkey-register">
                パスキーを登録（初回）
              </ButtonSecondary>
            ) : null}
          </div>
        </div>
        <script type="module" src="/static/passkey-login.js" />

        <div className="border-t border-zinc-800/80 pt-4">
          <p className="text-sm leading-relaxed text-zinc-400">
            セッション Cookie がある場合は自動的に認可されます。ローカルでは{" "}
            <code className="rounded bg-zinc-800/80 px-1 font-mono text-zinc-300">
              DASHBOARD_DEV_FALLBACK
            </code>{" "}
            が有効なとき、{" "}
            <code className="rounded bg-zinc-800/80 px-1 font-mono text-zinc-300">
              DASHBOARD_USER_ID
            </code>{" "}
            でユーザーが決まります（本番では無効にしてください）。
          </p>
          {devFb ? (
            <>
              <p className="mt-2 text-xs text-amber-200/90">
                現在: dev fallback 有効 — トップへ進むとシードユーザーとして扱われます（Cookie
                なし）。
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                または、次のボタンで D1 にセッションを作成し本番同等の Cookie パスを試せます。
              </p>
              <form method="post" action="/dev/session" className="mt-3">
                {next ? <input type="hidden" name="next" value={next} /> : null}
                <ButtonPrimary type="submit">Dev: セッションを作成</ButtonPrimary>
              </form>
            </>
          ) : (
            <p className="mt-2 text-xs text-zinc-500">
              dev fallback 無効: パスキーまたは D1 セッションが必要です。
            </p>
          )}
        </div>
        <div className="pt-2">
          <TextLink href="/">← トップへ</TextLink>
        </div>
      </Card>
    </Shell>,
    { title: "Sign in — Wana" }
  );
});
