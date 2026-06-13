import { createRoute } from "honox/factory";

import {
  getDashboardUserId,
  isOpenSignupEnabled,
  isWebAuthnEmailEnrollmentEnabled,
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
  const enrollment = isWebAuthnEmailEnrollmentEnabled(c.env);
  const nextAttr = next ?? "/";

  return c.render(
    <Shell title="Sign in" auth="hidden">
      <PageHeader
        title="ログイン"
        description="メールアドレスを入力し、パスキーでサインインします。"
      />
      <Card className="max-w-lg space-y-4 p-6 sm:p-8">
        <div
          id="passkey-login-root"
          className="space-y-4"
          data-enrollment={enrollment ? "true" : "false"}
          data-next={nextAttr}
        >
          <div className="space-y-2">
            <label className="block text-xs font-medium uppercase tracking-wider text-kumo-subtle">
              メールアドレス
            </label>
            <input
              name="email"
              type="email"
              autoComplete="username webauthn"
              placeholder="you@example.com"
              className="w-full rounded-lg border border-kumo-hairline bg-kumo-recessed px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
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

        {isOpenSignupEnabled(c.env) ? (
          <div className="border-t border-kumo-hairline pt-4 text-sm text-kumo-subtle">
            アカウントをお持ちでない方は{" "}
            <TextLink href="/signup">新規登録</TextLink>
          </div>
        ) : null}
        <div className="pt-2">
          <TextLink href="/">← トップへ</TextLink>
        </div>
      </Card>
    </Shell>,
    { title: "Sign in — Wana" }
  );
});
